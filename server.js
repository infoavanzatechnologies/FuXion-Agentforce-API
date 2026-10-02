import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';

// ── Config ────────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_HOST = process.env.PUBLIC_HOST || '';
const SECOND_NUMBER = process.env.SECOND_NUMBER || '';   // agent's phone number

// ── Recordings directory ──────────────────────────────────────────────────────
const RECORDINGS_DIR = path.resolve('./recordings');
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// ── ANSI colours for two-track terminal output ────────────────────────────────
const CLR = {
  cyan: '\x1b[36m',   // inbound  = customer's voice
  yellow: '\x1b[33m',   // outbound = agent's voice
  red: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

// ── WAV helper ────────────────────────────────────────────────────────────────
// Writes a valid WAV header for raw μ-law audio (8000 Hz, mono, 8-bit).
// Spec: https://www.mmsp.ece.mcgill.ca/Documents/AudioFormats/WAVE/WAVE.html
function buildWavHeader(dataByteLength) {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);                          // ChunkID
  buf.writeUInt32LE(36 + dataByteLength, 4);     // ChunkSize
  buf.write('WAVE', 8);                          // Format
  buf.write('fmt ', 12);                         // Subchunk1ID
  buf.writeUInt32LE(16, 16);                   // Subchunk1Size (16 = PCM / mulaw)
  buf.writeUInt16LE(7, 20);                   // AudioFormat: 7 = μ-law
  buf.writeUInt16LE(1, 22);                   // NumChannels: 1 (mono)
  buf.writeUInt32LE(8000, 24);                   // SampleRate: 8000 Hz
  buf.writeUInt32LE(8000, 28);                   // ByteRate: 8000 * 1 * 1
  buf.writeUInt16LE(1, 32);                   // BlockAlign: 1
  buf.writeUInt16LE(8, 34);                   // BitsPerSample: 8
  buf.write('data', 36);                         // Subchunk2ID
  buf.writeUInt32LE(dataByteLength, 40);         // Subchunk2Size
  return buf;
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: false }));

// ── GET /health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.send('ok'));

// ── POST /voice ────────────────────────────────────────────────────────────────
// Twilio hits this when the customer calls the Twilio number.
//
// ─────────────────────────────────────────────────────────────────────────────
// TEST MODE (single-caller): comment the Dial block below and use <Say>+<Pause>
// so only ONE phone call is needed to observe audio packets in the terminal.
//
// PRODUCTION MODE (two-party): uncomment the Dial block and comment test block.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/voice', (req, res) => {
  const callSid = req.body.CallSid || 'unknown';
  const from = req.body.From || 'unknown';

  console.log('\n' + CLR.bold + '═'.repeat(57) + CLR.reset);
  console.log(`${CLR.bold}  Incoming call${CLR.reset}`);
  console.log(`    CallSid : ${callSid}`);
  console.log(`    From    : ${from}`);

  // ── TEST MODE ── single caller, no Dial needed ────────────────────────────
  // <Say> keeps the call alive and gives audio data on the inbound track.
  // <Pause> holds the line open for 60 s so you can see packets arrive.
  // Both tracks are streamed to /media WebSocket.
  console.log(`    Mode    : TEST (single-caller — <Say>+<Pause>)`);
  console.log('═'.repeat(57));

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://${PUBLIC_HOST}/media" track="both_tracks"/>
  </Start>
  <Say>Connected. Please start speaking.</Say>
  <Pause length="60"/>
</Response>`;

  console.log(' TwiML sent to Twilio (TEST MODE):');
  console.log(twiml);
  console.log('═'.repeat(57) + '\n');

  res.setHeader('Content-Type', 'text/xml');
  res.send(twiml);
});

// ── PRODUCTION /voice (two-party Dial) — COMMENTED OUT for test mode ──────────
// Uncomment the block below and comment the TEST MODE block above when you
// want to re-enable the agent call forwarding via <Dial>.
//
// app.post('/voice', (req, res) => {
//   const callSid = req.body.CallSid || 'unknown';
//   const from = req.body.From || 'unknown';
//
//   console.log('\n' + CLR.bold + '═'.repeat(57) + CLR.reset);
//   console.log(`${CLR.bold}  Incoming call${CLR.reset}`);
//   console.log(`    CallSid : ${callSid}`);
//   console.log(`    From    : ${from}`);
//
//   if (!SECOND_NUMBER) {
//     console.error(`${CLR.red}   SECOND_NUMBER is not set in .env — cannot dial agent!${CLR.reset}`);
//   } else {
//     console.log(`    Dialling: ${SECOND_NUMBER}`);
//   }
//   console.log('═'.repeat(57));
//
//   // track="both_tracks" → Twilio streams BOTH inbound (customer) and
//   // outbound (agent) audio to our /media WebSocket endpoint.
//   // <Dial> connects the customer to the agent; the call stays open until
//   // either party hangs up — no <Pause> needed.
//   const twiml = `<?xml version="1.0" encoding="UTF-8"?>
// <Response>
//   <Start>
//     <Stream url="wss://${PUBLIC_HOST}/media" track="both_tracks"/>
//   </Start>
//   <Dial>${SECOND_NUMBER}</Dial>
// </Response>`;
//
//   console.log(' TwiML sent to Twilio:');
//   console.log(twiml);
//   console.log('═'.repeat(57) + '\n');
//
//   res.setHeader('Content-Type', 'text/xml');
//   res.send(twiml);
// });

// ── HTTP server ────────────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── WebSocket server at /media ─────────────────────────────────────────────────
// Twilio opens this connection after the <Start><Stream> TwiML runs.
// All messages are JSON text frames. Audio payloads are base64-encoded μ-law.
const wss = new WebSocketServer({ server, path: '/media' });

wss.on('connection', (ws, req) => {
  console.log(CLR.bold + '═'.repeat(57) + CLR.reset);
  console.log(`  WebSocket connected  (path: ${req.url})`);

  // ── Per-connection state ──────────────────────────────────────────────────
  let callSid = null;
  let streamSid = null;

  // One slot per track: inbound = customer, outbound = agent
  const tracks = {
    inbound: {
      label: `${CLR.cyan}[Customer / inbound ]${CLR.reset}`,
      packets: 0,
      chunks: [],   // raw μ-law Buffer chunks — written to file on stop
      lastLog: 0,
    },
    outbound: {
      label: `${CLR.yellow}[Agent    / outbound]${CLR.reset}`,
      packets: 0,
      chunks: [],
      lastLog: 0,
    },
  };

  // ── Message handler ───────────────────────────────────────────────────────
  ws.on('message', (rawMsg) => {
    let msg;
    try {
      msg = JSON.parse(rawMsg.toString());
    } catch (err) {
      console.error('   Bad JSON on WebSocket:', err.message);
      return;
    }

    switch (msg.event) {

      // ── connected ──────────────────────────────────────────────────────────
      case 'connected':
        console.log('  [connected] Twilio WebSocket is open');
        break;

      // ── start ──────────────────────────────────────────────────────────────
      case 'start':
        callSid = msg.start?.callSid || null;
        streamSid = msg.start?.streamSid || null;

        console.log('\n📨  [start] Stream info:');
        console.log(JSON.stringify(msg.start, null, 2));
        console.log(`\n    callSid   = ${callSid}`);
        console.log(`    streamSid = ${streamSid}`);
        console.log(`    tracks    = ${JSON.stringify(msg.start?.tracks)}`);
        console.log('─'.repeat(57));
        console.log(`    ${CLR.cyan}Inbound  → customer's voice${CLR.reset}`);
        console.log(`    ${CLR.yellow}Outbound → agent's voice${CLR.reset}`);
        console.log('─'.repeat(57) + '\n');
        break;

      // ── media ──────────────────────────────────────────────────────────────
      // Sent ~50 times/second. DO NOT log the raw payload — just count & size.
      case 'media': {
        const trackName = msg.media?.track || 'unknown';
        const payload = msg.media?.payload || '';
        const timestamp = msg.media?.timestamp || '-';

        // Decode base64 → raw μ-law bytes
        const raw = Buffer.from(payload, 'base64');

        // Accumulate for file save on stop
        const t = tracks[trackName];
        if (t) {
          t.packets++;
          t.chunks.push(raw);

          // Throttle terminal log to once per second per track
          const now = Date.now();
          if (now - t.lastLog >= 1000) {
            t.lastLog = now;
            console.log(
              `🎙️  ${t.label}  ` +
              `packets=${String(t.packets).padStart(5)}  ` +
              `lastBytes=${raw.length}  ` +
              `ts=${timestamp}`
            );
          }
        } else {
          // Unknown track name — log it so we can investigate
          console.log(`  Unknown track: "${trackName}"  bytes=${raw.length}`);
        }
        break;
      }

      // ── stop ───────────────────────────────────────────────────────────────
      case 'stop':
        console.log('\n' + '─'.repeat(57));
        console.log('  [stop] Stream ended. Saving recordings…');
        console.log(`  ${CLR.cyan}inbound  packets : ${tracks.inbound.packets}${CLR.reset}`);
        console.log(`  ${CLR.yellow}outbound packets : ${tracks.outbound.packets}${CLR.reset}`);
        saveRecordings(callSid);
        console.log('─'.repeat(57) + '\n');
        break;

      default:
        console.log(`  Unknown event: "${msg.event}"`);
    }
  });

  // ── Save both tracks to disk ──────────────────────────────────────────────
  function saveRecordings(sid) {
    const id = sid || 'unknown_call';

    for (const [trackName, t] of Object.entries(tracks)) {
      if (t.chunks.length === 0) {
        console.log(`       No audio captured for ${trackName} — skipping.`);
        continue;
      }

      const rawData = Buffer.concat(t.chunks);
      const baseName = `${id}_${trackName}`;
      const ulawPath = path.join(RECORDINGS_DIR, `${baseName}.ulaw`);
      const wavPath = path.join(RECORDINGS_DIR, `${baseName}.wav`);

      // Raw μ-law bytes
      fs.writeFileSync(ulawPath, rawData);
      console.log(`    💾  Saved raw  : ${ulawPath}  (${rawData.length} bytes)`);

      // WAV with proper header so media players can open it directly
      const wavHeader = buildWavHeader(rawData.length);
      fs.writeFileSync(wavPath, Buffer.concat([wavHeader, rawData]));
      console.log(`    💾  Saved WAV  : ${wavPath}`);
    }
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────────
  ws.on('close', () => {
    const totalPackets = tracks.inbound.packets + tracks.outbound.packets;
    console.log('─'.repeat(57));
    console.log('  WebSocket closed');
    console.log(`  callSid            : ${callSid}`);
    console.log(`  streamSid          : ${streamSid}`);
    console.log(`  total packets      : ${totalPackets}`);
    console.log(`  ${CLR.cyan}inbound  (customer) : ${tracks.inbound.packets}${CLR.reset}`);
    console.log(`  ${CLR.yellow}outbound (agent)    : ${tracks.outbound.packets}${CLR.reset}`);
    console.log('─'.repeat(57) + '\n');
  });

  ws.on('error', (err) => {
    console.error(`${CLR.red}  WebSocket error: ${err.message}${CLR.reset}`);
  });
});

// ── Start server ───────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('\n' + CLR.bold + '═'.repeat(57) + CLR.reset);
  console.log(`${CLR.bold}  Server running on port ${PORT}${CLR.reset}`);
  console.log(`🩺  Local  : http://localhost:${PORT}/health`);

  if (PUBLIC_HOST) {
    console.log('\n  Public URLs → paste into Twilio:');
    console.log(`    Webhook URL   : https://${PUBLIC_HOST}/voice`);
    console.log(`    WebSocket URL : wss://${PUBLIC_HOST}/media`);
    console.log(`\n  Public : https://${PUBLIC_HOST}/health`);
  } else {
    console.log('\n   PUBLIC_HOST not set in .env');
    console.log(`   Run: ngrok http ${PORT}`);
    console.log('   Then set PUBLIC_HOST=<ngrok-hostname> in .env');
  }

  if (!SECOND_NUMBER) {
    console.log(`\n${CLR.red}   SECOND_NUMBER not set in .env${CLR.reset}`);
    console.log('   Set it to the agent phone number in international format.');
    console.log('   Example: SECOND_NUMBER=+923001234567');
  } else {
    console.log(`\n  Agent number  : ${SECOND_NUMBER}`);
  }

  console.log(CLR.bold + '═'.repeat(57) + CLR.reset + '\n');
});
