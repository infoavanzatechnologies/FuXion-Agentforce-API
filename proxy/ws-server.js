require('dotenv').config();
const WebSocket  = require('ws');
const dtmf       = require('./dtmf');
const sessions   = require('./sessions');

const CARD_LENGTH      = 16;
const PIN_LENGTH       = 4;
const DTMF_DEBOUNCE_MS = 150;

// ─── Audio Conversion ─────────────────────────────────────────────────────────

function mulawToLinear(mulaw) {
  mulaw = ~mulaw;
  const sign      = mulaw & 0x80;
  const exponent  = (mulaw >> 4) & 0x07;
  const mantissa  = mulaw & 0x0F;
  let   sample    = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign !== 0 ? -sample : sample;
}

// Twilio µ-law 8kHz base64 → PCM 16-bit 16kHz base64 (for ElevenLabs input)
function twilioPayloadToEL(base64Mulaw) {
  const src = Buffer.from(base64Mulaw, 'base64');
  const dst = Buffer.alloc(src.length * 4); // upsample 8k→16k = ×2, 2 bytes/sample = ×4
  for (let i = 0; i < src.length; i++) {
    const s = mulawToLinear(src[i]);
    dst.writeInt16LE(s, i * 4);
    dst.writeInt16LE(s, i * 4 + 2);
  }
  return dst.toString('base64');
}

// Silent PCM chunk matching the size of a Twilio µ-law payload
function silentELChunk(base64Mulaw) {
  const len = Buffer.from(base64Mulaw, 'base64').length;
  return Buffer.alloc(len * 4).toString('base64'); // zeros = silence
}

// ─── ElevenLabs Direct Connection ─────────────────────────────────────────────

function openElevenLabsSocket(session) {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const wsUrl   = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}&output_format=ulaw_8000`;

  const elWs = new WebSocket(wsUrl, {
    headers: { 'xi-api-key': process.env.ELEVEN_API_KEY }
  });

  session.elevenLabsWs          = elWs;
  session.firstAudioFromElevenLabs = false;

  elWs.on('open', () => {
    console.log(`[PROXY] ✅ ElevenLabs direct WS connected for ${session.callSid}`);
  });

  elWs.on('message', (data) => {
    let parsed = null;
    try { parsed = JSON.parse(data.toString()); } catch { return; }
    if (!parsed) return;

    const evType = parsed.type;

    // ── Conversation ID ───────────────────────────────────────────────────────
    if (evType === 'conversation_initiation_metadata') {
      session.convId = parsed.conversation_initiation_metadata_event?.conversation_id;
      console.log(`[PROXY] ElevenLabs convId: ${session.convId}`);
      return;
    }

    // ── Audio → Twilio ────────────────────────────────────────────────────────
    if (evType === 'audio') {
      if (!session.firstAudioFromElevenLabs) {
        session.firstAudioFromElevenLabs = true;
        console.log(`[PROXY] ← EL first audio for ${session.callSid}`);
      }
      const audioBase64 = parsed.audio_event?.audio_base_64;
      if (!audioBase64 || session.twilioWs?.readyState !== WebSocket.OPEN) return;

      // output_format=ulaw_8000 → forward directly to Twilio
      session.twilioWs.send(JSON.stringify({
        event:     'media',
        streamSid: session.streamSid,
        media:     { payload: audioBase64 }
      }));
      return;
    }

    // ── Interruption → clear Twilio buffer ───────────────────────────────────
    if (evType === 'interruption') {
      if (session.twilioWs?.readyState === WebSocket.OPEN) {
        session.twilioWs.send(JSON.stringify({
          event:     'clear',
          streamSid: session.streamSid
        }));
      }
      return;
    }

    // ── Client tool call ──────────────────────────────────────────────────────
    if (evType === 'client_tool_call') {
      const { tool_name, tool_call_id } = parsed.client_tool_call || {};
      console.log(`[PROXY] ← EL client_tool_call: ${tool_name} (${tool_call_id})`);

      if (tool_name === 'collect_card_dtmf') {
        sessions.setMode(session.callSid, 'collecting_card');
        try {
          elWs.send(JSON.stringify({
            type:         'client_tool_result',
            tool_call_id,
            result:       'DTMF collection started',
            is_error:     false
          }));
          console.log(`[PROXY] ✅ client_tool_result sent`);
        } catch (err) {
          console.error(`[PROXY] ❌ Failed to send client_tool_result:`, err.message);
        }
      }
      return;
    }

    // ── All other events ──────────────────────────────────────────────────────
    console.log(`[PROXY] ← EL [${evType}] ${JSON.stringify(parsed).substring(0, 300)}`);
  });

  elWs.on('error', (err) =>
    console.error(`[PROXY] ElevenLabs WS error (${session.callSid}):`, err.message)
  );

  elWs.on('close', (code, reason) =>
    console.log(`[PROXY] ElevenLabs WS closed (${session.callSid}): ${code} | Reason: ${reason?.toString()}`)
  );
}

// ─── DTMF Handling ─────────────────────────────────────────────────────────

function handleDtmfDigit(digit, session) {
  const now = Date.now();
  if (digit === session.lastDtmfDigit && now - session.lastDtmfTime < DTMF_DEBOUNCE_MS) return;
  session.lastDtmfDigit = digit;
  session.lastDtmfTime  = now;

  if (session.mode === 'collecting_card') {
    session.cardDigits += digit;
    console.log(`[DTMF] Card digit ${session.cardDigits.length}/${CARD_LENGTH}: "${digit}" — so far: "${session.cardDigits}"`);

    if (session.cardDigits.length >= CARD_LENGTH) {
      console.log(`[DTMF] Card complete: "${session.cardDigits}" — switching to PIN`);
      session.mode = 'collecting_pin';
      injectMessage(
        session,
        'The customer has finished entering their 16 digit card number on the keypad. ' +
        'Now please ask them to enter their 4 digit PIN on the keypad.'
      );
    }

  } else if (session.mode === 'collecting_pin') {
    session.pinDigits += digit;
    console.log(`[DTMF] PIN digit ${session.pinDigits.length}/${PIN_LENGTH}: "${digit}" — so far: "${session.pinDigits}"`);

    if (session.pinDigits.length >= PIN_LENGTH) {
      console.log(`[DTMF] PIN complete: "${session.pinDigits}" — verifying`);
      session.mode = 'verifying';
      verifyAndInject(session);
    }
  }
}

async function verifyAndInject(session) {
  const TEST_CARD = '1234567890123456';
  const TEST_PIN  = '1234';
  const verified  = session.cardDigits === TEST_CARD && session.pinDigits === TEST_PIN;
  const last4     = session.cardDigits.slice(-4);

  console.log(`[PROXY] Verification: ${verified ? '✅ PASS' : '❌ FAIL'} — card="${session.cardDigits}" pin="${session.pinDigits}" for ${session.callSid}`);

  session.mode       = 'conversation';
  session.cardDigits = '';
  session.pinDigits  = '';

  const text = verified
    ? `Card verification was successful. The customer's card ending in ${last4} has been verified and unblocked in our system. Please inform the customer warmly that their card has been successfully unblocked and they can now use it for transactions.`
    : `Card verification failed. The card number or PIN entered does not match our records. Please inform the customer that you were unable to verify their details and advise them to visit their nearest branch.`;

  injectMessage(session, text);
}

function injectMessage(session, text) {
  if (session.elevenLabsWs?.readyState === WebSocket.OPEN) {
    console.log(`[PROXY] Injecting → ElevenLabs: "${text.substring(0, 80)}..."`);
    session.elevenLabsWs.send(JSON.stringify({ type: 'user_message', text }));
  } else {
    console.warn(`[PROXY] Cannot inject — ElevenLabs WS not open`);
  }
}

// ─── Main WebSocket Server ─────────────────────────────────────────────────

function createProxyServer(httpServer, callParamsStore) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/proxy/stream' });

  wss.on('connection', (twilioWs) => {
    console.log('[PROXY] Twilio WebSocket connected');
    let session = null;

    twilioWs.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // ── start ──────────────────────────────────────────────────────────────
      if (msg.event === 'start') {
        const callSid   = msg.start?.callSid;
        const streamSid = msg.start?.streamSid;
        if (!callSid) return;

        console.log(`[PROXY] Call started: ${callSid} streamSid: ${streamSid}`);
        session           = sessions.create(callSid);
        session.twilioWs  = twilioWs;
        session.streamSid = streamSid;

        const callParams  = callParamsStore[callSid] || {};
        session.from      = callParams.from || '';
        session.to        = callParams.to   || '';

        openElevenLabsSocket(session);
      }

      // ── media ──────────────────────────────────────────────────────────────
      else if (msg.event === 'media') {
        if (!session) return;
        const payload = msg.media?.payload;
        if (!payload) return;

        const inDtmfMode = session.mode === 'collecting_card' || session.mode === 'collecting_pin';

        if (inDtmfMode) {
          const digit = dtmf.processTwilioChunk(payload);
          if (digit) handleDtmfDigit(digit, session);

          if (session.elevenLabsWs?.readyState === WebSocket.OPEN) {
            session.elevenLabsWs.send(JSON.stringify({
              user_audio_chunk: silentELChunk(payload)
            }));
          }
        } else {
          if (session.elevenLabsWs?.readyState === WebSocket.OPEN) {
            if (!session.firstAudioFromTwilio) {
              session.firstAudioFromTwilio = true;
              console.log(`[PROXY] ✅ First audio from Twilio → ElevenLabs (${session.callSid})`);
            }
            session.elevenLabsWs.send(JSON.stringify({
              user_audio_chunk: twilioPayloadToEL(payload)
            }));
          }
        }
      }

      // ── stop ───────────────────────────────────────────────────────────────
      else if (msg.event === 'stop') {
        console.log(`[PROXY] Call ended: ${session?.callSid}`);
        session?.elevenLabsWs?.close();
        if (session) sessions.remove(session.callSid);
      }
    });

    twilioWs.on('close', () => {
      console.log('[PROXY] Twilio WS closed');
      session?.elevenLabsWs?.close();
      if (session) sessions.remove(session.callSid);
    });

    twilioWs.on('error', (err) =>
      console.error('[PROXY] Twilio WS error:', err.message)
    );
  });

  console.log('[PROXY] ✅ WebSocket proxy server ready at /proxy/stream');
  return wss;
}

module.exports = { createProxyServer, setDTMFMode: sessions.setMode };
