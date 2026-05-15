require('dotenv').config();
const WebSocket  = require('ws');
const axios      = require('axios');
const dtmf       = require('./dtmf');
const sessions   = require('./sessions');

const CARD_LENGTH      = 16;
const PIN_LENGTH       = 4;
const DTMF_DEBOUNCE_MS = 150;

function silencePayload(length) {
  return Buffer.alloc(length, 0xFF).toString('base64');
}

// ─── Connect to ElevenLabs ─────────────────────────────────────────────────

async function getElevenLabsConnection(callParams) {
  const params = new URLSearchParams({
    CallSid:    callParams.callSid,
    From:       callParams.from,
    To:         callParams.to,
    AccountSid: process.env.TWILIO_ACCOUNT_SID,
    CallStatus: 'in-progress',
    Direction:  'inbound'
  });

  const res = await axios.post(
    'https://api.us.elevenlabs.io/twilio/inbound_call',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const wsUrl  = res.data.match(/url="([^"]+)"/)?.[1];
  const convId = res.data.match(/name="conversation_id"\s+value="([^"]+)"/)?.[1];

  console.log(`[PROXY] ElevenLabs wsUrl: ${wsUrl}`);
  console.log(`[PROXY] ElevenLabs convId: ${convId}`);

  return { wsUrl, convId };
}

function openElevenLabsSocket(wsUrl, convId, session) {
  const elWs = new WebSocket(wsUrl, {
    headers: { 'xi-api-key': process.env.ELEVEN_API_KEY }
  });

  session.elevenLabsWs          = elWs;
  session.convId                = convId;
  session.firstAudioFromElevenLabs = false;

  elWs.on('open', () => {
    console.log(`[PROXY] ✅ ElevenLabs connected for ${session.callSid}`);

    elWs.send(JSON.stringify({
      event:    'connected',
      protocol: 'Call',
      version:  '1.0.0'
    }));

    elWs.send(JSON.stringify({
      event:          'start',
      sequenceNumber: '1',
      streamSid:      session.streamSid,
      start: {
        streamSid:        session.streamSid,
        callSid:           session.callSid,
        accountSid:        process.env.TWILIO_ACCOUNT_SID,
        tracks:           ['inbound'],
        customParameters: { conversation_id: convId }
      }
    }));

    // If reconnected after DTMF, inject the pending result immediately
    if (session.pendingInjection) {
      const text = session.pendingInjection;
      session.pendingInjection = null;
      console.log(`[PROXY] Injecting pending result after reconnect: "${text.substring(0, 80)}..."`);
      setTimeout(() => injectMessage(session, text), 300);
    }
  });

  elWs.on('message', (data) => {
    const raw = data.toString();
    if (!session.firstAudioFromElevenLabs) {
      session.firstAudioFromElevenLabs = true;
      console.log(`[PROXY] ← EL first message (${raw.length} bytes)`);
    }
    if (session.twilioWs?.readyState === WebSocket.OPEN) {
      session.twilioWs.send(typeof data === 'string' ? data : data.toString());
    }
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

  if (
    digit === session.lastDtmfDigit &&
    now - session.lastDtmfTime < DTMF_DEBOUNCE_MS
  ) return;

  session.lastDtmfDigit = digit;
  session.lastDtmfTime  = now;

  if (session.mode === 'collecting_card') {
    session.cardDigits += digit;
    console.log(`[DTMF] Card digit ${session.cardDigits.length}/${CARD_LENGTH}`);

    if (session.cardDigits.length >= CARD_LENGTH) {
      console.log(`[DTMF] Card number complete — switching to PIN collection`);
      session.mode = 'collecting_pin';
      // ElevenLabs is likely disconnected here; injection is best-effort
      injectMessage(
        session,
        'The customer has finished entering their 16 digit card number on the keypad. ' +
        'Now please ask them to enter their 4 digit PIN on the keypad.'
      );
    }

  } else if (session.mode === 'collecting_pin') {
    session.pinDigits += digit;
    console.log(`[DTMF] PIN digit ${session.pinDigits.length}/${PIN_LENGTH}`);

    if (session.pinDigits.length >= PIN_LENGTH) {
      console.log(`[DTMF] PIN complete — verifying`);
      session.mode = 'verifying';
      verifyAndInject(session);
    }
  }
}

async function verifyAndInject(session) {
  const TEST_CARD = '1234567890123456';
  const TEST_PIN  = '1234';

  const verified = session.cardDigits === TEST_CARD &&
                   session.pinDigits  === TEST_PIN;
  const last4    = session.cardDigits.slice(-4);

  console.log(`[PROXY] Verification: ${verified ? '✅ PASS' : '❌ FAIL'} for ${session.callSid}`);

  session.mode       = 'conversation';
  session.cardDigits = '';
  session.pinDigits  = '';

  const text = verified
    ? `Card verification was successful. The customer's card ending in ${last4} ` +
      `has been verified and unblocked in our system. ` +
      `Please inform the customer warmly that their card has been successfully unblocked ` +
      `and they can now use it for transactions.`
    : `Card verification failed. The card number or PIN entered does not match our records. ` +
      `Please inform the customer that you were unable to verify their details ` +
      `and advise them to visit their nearest branch.`;

  if (session.elevenLabsWs?.readyState === WebSocket.OPEN) {
    injectMessage(session, text);
  } else {
    // ElevenLabs closed during DTMF — reconnect and inject result
    console.log(`[PROXY] ElevenLabs disconnected — reconnecting to deliver verification result`);
    session.pendingInjection = text;
    try {
      const { wsUrl, convId } = await getElevenLabsConnection({
        callSid: session.callSid,
        from:    session.from || '',
        to:      session.to   || ''
      });
      openElevenLabsSocket(wsUrl, convId, session);
    } catch (err) {
      console.error(`[PROXY] Failed to reconnect to ElevenLabs for injection:`, err.message);
    }
  }
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

      // ── start ──────────────────────────────────────────────────────────
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

        try {
          const { wsUrl, convId } = await getElevenLabsConnection({
            callSid,
            from: session.from,
            to:   session.to
          });
          openElevenLabsSocket(wsUrl, convId, session);
        } catch (err) {
          console.error('[PROXY] Failed to connect to ElevenLabs:', err.message);
        }
      }

      // ── media ──────────────────────────────────────────────────────────
      else if (msg.event === 'media') {
        if (!session) return;

        const payload = msg.media?.payload;
        if (!payload) return;

        const inDtmfMode =
          session.mode === 'collecting_card' ||
          session.mode === 'collecting_pin';

        if (inDtmfMode) {
          const digit = dtmf.processTwilioChunk(payload);
          if (digit) handleDtmfDigit(digit, session);

          if (session.elevenLabsWs?.readyState === WebSocket.OPEN) {
            const chunkLen = Buffer.from(payload, 'base64').length;
            session.elevenLabsWs.send(JSON.stringify({
              event:          'media',
              sequenceNumber: String(session.seqNumber++),
              media: {
                track:     'inbound',
                chunk:     String(session.seqNumber),
                timestamp: String(Date.now()),
                payload:   silencePayload(chunkLen)
              }
            }));
          }
        } else {
          if (session.elevenLabsWs?.readyState === WebSocket.OPEN) {
            if (!session.firstAudioFromTwilio) {
              session.firstAudioFromTwilio = true;
              console.log(`[PROXY] ✅ First audio from Twilio → forwarding to ElevenLabs (${session.callSid})`);
            }
            session.elevenLabsWs.send(typeof data === 'string' ? data : data.toString());
          }
        }
      }

      // ── stop ───────────────────────────────────────────────────────────
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
