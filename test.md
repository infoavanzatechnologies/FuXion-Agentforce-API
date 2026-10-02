# Testing Checklist — Steps 3 & 4

Follow these steps **in order** once your supervisor whitelists your number in the Twilio account.

---

## Pre-flight checks (do these before calling)

- [ ] `npm start` is running in terminal 1
- [ ] `ngrok http 3000` is running in terminal 2
- [ ] ngrok shows a `Forwarding` line like `https://xxx.ngrok-free.app -> http://localhost:3000`
- [ ] `PUBLIC_HOST` in your `.env` matches the current ngrok hostname (no `https://`)
- [ ] `http://localhost:3000/health` shows `ok` in the browser
- [ ] `https://<your-ngrok-host>/health` shows `ok` in the browser

> ⚠️ **Important:** ngrok gives a new URL every time it restarts (unless you have a paid fixed domain).
> If you restarted ngrok, update `PUBLIC_HOST` in `.env`, restart the server, and update the webhook URL in Twilio Console too.

---

## Twilio Console setup (one-time, done by supervisor)

- [ ] Go to: **Twilio Console → Phone Numbers → Manage → Active Numbers → click the number**
- [ ] Under **Voice Configuration**:
  - "A call comes in" → **Webhook**
  - URL → `https://<your-ngrok-host>/voice`
  - Method → **HTTP POST**
- [ ] Click **Save configuration**
- [ ] Your phone number is added as a **Verified Caller ID**:
  - Twilio Console → **Phone Numbers → Verified Caller IDs → Add a new number**
  - Enter your number, receive the verification code, confirm it

---

## Step 3 Test — Twilio webhook + TwiML

**Call the Twilio number from your whitelisted phone.**

### What you should hear on the phone
1. A short Twilio trial message (e.g. "This call is made from a Twilio trial account…")
2. Then your greeting: **"Connected. Please start speaking."**
3. The call stays open (silence) — this is the `<Pause>` holding the line

### What you should see in the server terminal
```
─────────────────────────────────────────────────────────
📞  Webhook hit!
    CallSid : CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    From    : +92xxxxxxxxxx
─────────────────────────────────────────────────────────
⏱️   Call will stay open for up to 3600s (or until caller hangs up).
📡  Sending TwiML:
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://xxx.ngrok-free.app/media" track="inbound_track"/>
  </Start>
  <Say>Connected. Please start speaking.</Say>
  <Pause length="3600"/>
</Response>
─────────────────────────────────────────────────────────
```

### Extra verification (optional but useful)
- Open the **ngrok inspector** at `http://127.0.0.1:4040`
- You should see a `POST /voice` request with status `200`
- Click it to inspect the request body (has `CallSid`, `From`, etc.) and the TwiML response

### If Step 3 fails
| Symptom | Likely cause |
|---|---|
| Phone rings but you hear a Twilio error | Wrong webhook URL, or server returned a non-200 response |
| Nothing in the server terminal | ngrok URL changed, or Twilio webhook method is not POST |
| "Your call cannot be completed" | Your number is not a Verified Caller ID yet |
| Call connects but you hear nothing | Trial country restriction — call your supervisor |

---

## Step 4 Test — WebSocket audio packets

**While still on the call (don't hang up yet), watch the server terminal.**

### What you should see immediately after the call connects
```
🔌  WebSocket connected  (path: /media)
📨  [connected] event received
📨  [start] event received:
{
  "event": "start",
  "sequenceNumber": "1",
  "start": {
    "streamSid": "MZxxxxxxxxxx",
    "callSid": "CAxxxxxxxxxx",
    "tracks": ["inbound"],
    "mediaFormat": {
      "encoding": "audio/x-mulaw",
      "sampleRate": 8000,
      "channels": 1
    }
  }
}
    ✅  callSid  = CAxxxxxxxxxx
    ✅  streamSid= MZxxxxxxxxxx
```

### What you should see while you speak (once per second)
```
🎙️  track=inbound  packets=12   lastBytes=160  timestamp=...
🎙️  track=inbound  packets=37   lastBytes=160  timestamp=...
🎙️  track=inbound  packets=62   lastBytes=160  timestamp=...
```

### What you should see when you hang up
```
🛑  [stop] event received. Total packets: 312
🔌  WebSocket closed.
```

### Things to verify from the `start` message
- [ ] `mediaFormat.encoding` = `audio/x-mulaw` (mulaw confirmed ✅)
- [ ] `mediaFormat.sampleRate` = `8000` (8 kHz confirmed ✅)
- [ ] `mediaFormat.channels` = `1` (mono confirmed ✅)
- [ ] `tracks` contains `inbound`
- [ ] Each packet is approximately **160 bytes** (= 20 ms of audio at 8 kHz mulaw)

### If Step 4 fails
| Symptom | Likely cause |
|---|---|
| Webhook hit, but no `WebSocket connected` | The `wss://` URL in TwiML is wrong, or `PUBLIC_HOST` has `https://` in it |
| WebSocket connects but no `start` event | Twilio did not start the stream — check the TwiML `<Start><Stream>` tag |
| Packets stop early | The `<Pause>` ended or the Twilio trial 10-minute limit was reached |
| `lastBytes` is not ~160 | This is fine to note — just verify and report |

---

## After both steps pass ✅

Come back and say **"Step 3 and 4 tests passed"** and we will move on to the two-person call feature.

---

## Two-Person Call Test — Customer + Agent (both_tracks)

### Before you start

- [ ] Add `SECOND_NUMBER=+92xxxxxxxxxx` to your `.env` (the agent's phone, in international format)
- [ ] The agent's number must be a **Verified Caller ID** in Twilio Console (trial limit)
- [ ] Both `npm start` and `ngrok http 3000` are running
- [ ] Twilio webhook is set to `https://<ngrok-host>/voice` with method **POST**

### How it works

```
Customer phone → calls Twilio number
                     ↓ POST /voice (webhook)
               Server sends TwiML:
               <Start><Stream track="both_tracks"/></Start>
               <Dial>SECOND_NUMBER</Dial>
                     ↓
               Twilio rings the agent phone
                     ↓
               Agent answers → both are connected
                     ↓
               Twilio opens wss:///media (WebSocket)
               Streams inbound  = customer's voice  (cyan)
               Streams outbound = agent's voice      (yellow)
                     ↓
               Server saves both tracks to recordings/
```

### What you should see in the server terminal

**When customer calls:**
```
═════════════════════════════════════════════════════════
📞  Incoming call
    CallSid : CAxxxxxxxxxx
    From    : +92xxxxxxxxxx (customer)
    Dialling: +92xxxxxxxxxx (agent)
═════════════════════════════════════════════════════════
```

**When agent answers and audio flows:**
```
📨  [connected] Twilio WebSocket is open

📨  [start] Stream info:
{
  "streamSid": "MZxxxxxxxxxx",
  "callSid":   "CAxxxxxxxxxx",
  "tracks":    ["inbound", "outbound"],
  "mediaFormat": { "encoding": "audio/x-mulaw", "sampleRate": 8000 }
}

    Inbound  → customer's voice
    Outbound → agent's voice

🎙️  [Customer / inbound ]  packets=   12  lastBytes=160  ts=...
🎙️  [Agent    / outbound]  packets=   11  lastBytes=160  ts=...
🎙️  [Customer / inbound ]  packets=   62  lastBytes=160  ts=...
🎙️  [Agent    / outbound]  packets=   58  lastBytes=160  ts=...
```

**When either party hangs up:**
```
🛑  [stop] Stream ended. Saving recordings…
    inbound  packets : 312
    outbound packets : 298
    💾  Saved raw  : recordings/CAxxxx_inbound.ulaw  (49920 bytes)
    💾  Saved WAV  : recordings/CAxxxx_inbound.wav
    💾  Saved raw  : recordings/CAxxxx_outbound.ulaw (47680 bytes)
    💾  Saved WAV  : recordings/CAxxxx_outbound.wav
```

### Verify the recordings

Open the `.wav` files in VLC or any audio player:
- `recordings/<callSid>_inbound.wav`  → should contain **only the customer's voice**
- `recordings/<callSid>_outbound.wav` → should contain **only the agent's voice**

Or play raw μ-law with ffplay (if ffmpeg is installed):
```bash
ffplay -f mulaw -ar 8000 -ac 1 recordings/<callSid>_inbound.ulaw
ffplay -f mulaw -ar 8000 -ac 1 recordings/<callSid>_outbound.ulaw
```

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Agent phone never rings | `SECOND_NUMBER` not set, or not a Verified Caller ID |
| Only one track in `start` message | Check TwiML — must use `track="both_tracks"`, not `inbound_track` |
| `outbound` packets = 0 | Agent did not answer, or answered after stream was already stopped |
| Recording sounds like noise | Bytes converted incorrectly — they must be saved exactly as decoded from base64 |
| Call drops after ~10 minutes | Twilio trial account 10-minute hard limit |

