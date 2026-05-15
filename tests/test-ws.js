require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const WebSocket = require('ws');
const axios = require('axios');

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const API_KEY  = process.env.ELEVEN_API_KEY;

async function getElevenLabsWsUrl() {
  const params = new URLSearchParams({
    CallSid:    'CAtest000000000000000000000000001',
    From:       '+923000631990',
    To:         '+14153603527',
    AccountSid: process.env.TWILIO_ACCOUNT_SID,
    CallStatus: 'in-progress',
    Direction:  'inbound'
  });

  const res = await axios.post(
    'https://api.us.elevenlabs.io/twilio/inbound_call',
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  console.log('\n[TEST1] Raw TwiML from ElevenLabs:');
  console.log(res.data);

  const wsUrl  = res.data.match(/url="([^"]+)"/)?.[1];
  const convId = res.data.match(/name="conversation_id"\s+value="([^"]+)"/)?.[1];

  return { wsUrl, convId };
}

async function runTest() {
  console.log('\n========================================');
  console.log('TEST 1: ElevenLabs WebSocket Text Injection');
  console.log('========================================\n');

  // Step 1: Get WebSocket URL
  console.log('[STEP 1] Calling ElevenLabs inbound_call...');
  const { wsUrl, convId } = await getElevenLabsWsUrl();
  console.log('[STEP 1] WebSocket URL:', wsUrl);
  console.log('[STEP 1] Conversation ID:', convId);

  if (!wsUrl) {
    console.error('[FAIL] Could not extract WebSocket URL');
    return;
  }

  // Step 2: Connect to WebSocket
  console.log('\n[STEP 2] Connecting to ElevenLabs WebSocket...');

  const ws = new WebSocket(wsUrl, {
    headers: { 'xi-api-key': API_KEY }
  });

  ws.on('open', () => {
    console.log('[STEP 2] ✅ Connected to ElevenLabs WebSocket\n');

    // Step 3: Send Twilio-style connected event
    console.log('[STEP 3] Sending Twilio connected event...');
    ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));

    // Step 4: Send Twilio-style start event
    setTimeout(() => {
      console.log('[STEP 4] Sending Twilio start event...');
      ws.send(JSON.stringify({
        event: 'start',
        sequenceNumber: '1',
        start: {
          streamSid:  'MZ_test_stream_001',
          callSid:    'CAtest000000000000000000000000001',
          accountSid: process.env.TWILIO_ACCOUNT_SID,
          tracks:     ['inbound'],
          customParameters: {
          conversation_id: convId   // ← THIS was missing
        }
        }
      }));
    }, 500);

    // Step 5: Try text injection — Format A (ElevenLabs native)
    setTimeout(() => {
      console.log('\n[STEP 5A] Trying text injection — Format A (user_message)...');
      ws.send(JSON.stringify({
        type: 'user_message',
        text: 'Card verified successfully. Card number ends in 3456.'
      }));
    }, 2000);

    // Step 6: Try text injection — Format B (conversation inject)
    setTimeout(() => {
      console.log('[STEP 5B] Trying text injection — Format B (inject)...');
      ws.send(JSON.stringify({
        event: 'inject',
        text:  'Card verified successfully. Card number ends in 3456.'
      }));
    }, 4000);

    // Step 7: Try text injection — Format C (custom)
    setTimeout(() => {
      console.log('[STEP 5C] Trying text injection — Format C (contextual_update)...');
      ws.send(JSON.stringify({
        type:    'contextual_update',
        content: 'Card verified. Last 4 digits: 3456.'
      }));
    }, 6000);

    // Close after 10 seconds
    setTimeout(() => {
      console.log('\n[TEST1] Closing connection...');
      ws.close();
    }, 10000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.event === 'media' || msg.type === 'audio') {
        console.log('[RECEIVE] Audio chunk received ✅ (ElevenLabs is sending audio)');
      } else {
        console.log('[RECEIVE] Non-audio message:', JSON.stringify(msg));
      }
    } catch {
      console.log('[RECEIVE] Raw data (non-JSON)');
    }
  });

  ws.on('error', (err) => {
    console.error('[FAIL] WebSocket error:', err.message);
    console.log('\nThis might mean ElevenLabs rejects connections without a real CallSid.');
    console.log('→ Action: We will test this during a live call instead.');
  });

  ws.on('close', (code, reason) => {
    console.log('\n[TEST1] Connection closed. Code:', code, '| Reason:', reason.toString());
    analyzeResults(code);
  });
}

function analyzeResults(code) {
  console.log('\n========================================');
  console.log('TEST 1 RESULTS');
  console.log('========================================');
  if (code === 1000) {
    console.log('✅ Connection opened and closed cleanly');
    console.log('✅ Check logs above for which injection format ElevenLabs responded to');
  } else if (code === 1008 || code === 4000) {
    console.log('❌ ElevenLabs rejected connection — needs real CallSid');
    console.log('→ Next step: Test during live call');
  } else {
    console.log('⚠️  Closed with code:', code, '— check logs above');
  }
}

runTest().catch(console.error);
