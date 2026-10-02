# Live Call Transcription with Twilio Media Streams (Node.js + ngrok)

A small learning project. I call a Twilio number from my phone and speak. Twilio sends the call audio to my Node server in real time, and the server prints it as text in the terminal. There is no web page or GUI. Later, a second person joins the call and both voices are transcribed separately.

---

## 0. Instructions for the AI coding agent (read first)

1. Read this whole file before writing any code.
2. Work on **one step at a time**. When I say "Do Step N", do only Step N.
3. After each step, tell me: files created or changed, the exact command to run, what I should see on success, and what to check if it fails. Then **stop and wait**.
4. Keep it simple: Node.js (ES modules), `express`, `ws`, `dotenv`. No TypeScript, no database, no web page or GUI. The transcript is shown **only in the terminal**. Small files.
5. Add clear `console.log` lines everywhere so I can watch what happens. Never print full audio payloads (they are huge); print counts and sizes instead.
6. Secrets go in `.env`. Create `.env.example` with placeholders. Add `.env` to `.gitignore`.
7. If something here conflicts with what you see in a library's real docs, tell me before changing the plan.

---

## 1. Goal and scope

**Phase 1 (Steps 1 to 6):** one speaker. I call the Twilio number and talk. The server receives live audio packets and prints the live transcript in the terminal.

**Phase 2 (Step 7):** two people. I call the Twilio number, Twilio connects me to a second phone, and the server transcribes each person separately and labels them.

**Out of scope for now:** web page or any GUI, AI analysis, CRM, databases, login, production security.

---

## 2. How it works

```
My phone --> Twilio number --> (call connected)
                  |
                  | Twilio makes a copy of the call audio
                  v
        wss://<ngrok-host>/media   (Twilio's WebSocket to my server)
                  |
                  v
          Node server (/media)
                  |
                  v
        Deepgram live transcription (WebSocket)
                  |
                  v
   Terminal: live transcript lines
```

**Twilio side**
- When the call comes in, Twilio calls my server at `POST /voice`.
- My server replies with TwiML (Twilio's XML instructions) that starts a **unidirectional Media Stream**: `<Start><Stream>`. One-way means Twilio sends audio to me, and I cannot send audio back. That is exactly what a silent listener needs.
- Twilio then opens a WebSocket to my `/media` endpoint and sends JSON text messages.

**Messages Twilio sends on the WebSocket** (all are JSON text; audio is base64 text inside the JSON)
- `connected`: the connection opened.
- `start`: sent once; includes call and stream identifiers and the list of tracks.
- `media`: sent continuously; `media.payload` is base64 audio, `media.track` is `inbound` or `outbound`.
- `stop`: the stream ended.

**Audio format:** 8 kHz, mono, μ-law (also called mulaw), 8 bits per sample. Twilio's docs and the Deepgram/Twilio guides agree on this. Deepgram accepts this format directly, so **no audio conversion is needed**.

**Tracks:** `inbound` = audio Twilio receives from the caller (me). `outbound` = audio Twilio sends to the caller (the other person, in Phase 2).

> Items marked "verify" are things to confirm by looking at real messages in Step 4, not to assume.

---

## 3. Tools

| Need | Tool | Notes |
|---|---|---|
| Phone call + audio stream | Twilio (trial account) | Free trial, with limits (see section 4) |
| Server | Node.js 20 or newer, `express`, `ws`, `dotenv` | |
| Public URL for my laptop | ngrok | Twilio cannot reach `localhost` |
| Live transcription | Deepgram | Free signup credit (Deepgram's docs say $200); not unlimited |

Deepgram is connected with a plain WebSocket (no SDK) to keep it simple and avoid SDK version changes.

---

## 4. Known limits to expect (Twilio trial)

From Twilio's own pages:
- Calls to and from a trial number play a **short trial message first**, before my TwiML runs. So the stream starts a few seconds after I answer.
- A trial account can only **receive inbound calls from verified phone numbers**, so my phone must be added as a Verified Caller ID.
- Trial calls are limited to **10 minutes** (from Twilio's help center; the page is older, so verify).
- Twilio's trial page says trial voice calls are **restricted to your sign-up country**. If I signed up from Pakistan and the call to a US number does not connect, this is the likely cause. The documented fix is to upgrade the account, which removes trial limits. Check this in Step 0 before building anything.
- In Phase 2, the second person's phone must also be a Verified Caller ID, because trial accounts can only call verified numbers.
- Calling a foreign Twilio number from my phone is an international call and my carrier may charge for it.

Other known behaviour:
- The free ngrok URL usually changes each time ngrok restarts. When it changes, the Twilio webhook must be updated. If my ngrok account offers a free fixed domain, use it (verify in the ngrok dashboard).

---

## 5. Step 0: Accounts and setup (done by me, not the agent)

**Checkpoint rule:** do not start Step 1 until every box is ticked.

### 5.1 Install tools
- [ ] Node.js 20 or newer (`node -v` shows a version).
- [ ] ngrok installed (`ngrok version`).

### 5.2 ngrok
- [ ] Create an ngrok account, copy the authtoken from the dashboard.
- [ ] Run `ngrok config add-authtoken <TOKEN>` once.

### 5.3 Twilio
- [ ] Sign up for a Twilio trial account (no credit card needed per Twilio's trial page).
- [ ] Verify my own phone: Console, Phone Numbers, Verified Caller IDs, add my number, enter the code. (Menu names can change slightly.)
- [ ] Get a Twilio voice phone number from the Console (trial accounts are allowed one number).
- [ ] Note down: the Twilio number, and the Account SID (not strictly needed yet).
- [ ] Check that a call from my phone to this number is allowed in my country (see section 4). If I hear a Twilio error message or the call cannot connect, stop here and fix it first.

### 5.4 Deepgram
- [ ] Sign up at Deepgram, create an API key, copy it.

### 5.5 Project folder
- [ ] Create an empty folder, open it in Antigravity, and save this file as `PLAN.md` in the folder root.

---

## 6. The steps

Each step has: **goal**, **what to ask the agent**, **how I check it**, and **if it fails**.

---

### Step 1: Basic server

**Goal:** a Node server that runs and answers a health check.

**Ask the agent:**
> Do Step 1 of PLAN.md. Create a Node.js ES module project with `express`, `ws` and `dotenv`. Create `server.js` with an Express app on port 3000 (from `.env` `PORT`, default 3000) and a `GET /health` route returning `ok`. Add `npm start` and `.env.example`, `.gitignore`. Print a clear message when the server starts. Then stop.

**Check:**
1. `npm install` then `npm start`.
2. Open `http://localhost:3000/health` in a browser. It shows `ok`.

**If it fails:** port already in use (change `PORT`), or Node version too old.

---

### Step 2: Make the server reachable from the internet (ngrok)

**Goal:** a public HTTPS address that reaches my laptop.

**Do (by me):**
1. Keep the server running.
2. In a second terminal: `ngrok http 3000`.
3. Copy the forwarding address, for example `https://abc123.ngrok-free.app`.
4. Open `https://abc123.ngrok-free.app/health` in a browser. It must show `ok`. (ngrok may show a one-time warning page first; click through.)

**Ask the agent:**
> Do Step 2 of PLAN.md. Add a `PUBLIC_HOST` variable to `.env.example` (hostname only, without `https://`). Add startup logging that prints the full webhook URL I must paste into Twilio (`https://<PUBLIC_HOST>/voice`) and the WebSocket URL (`wss://<PUBLIC_HOST>/media`). Then stop.

**Check:** the logged URLs use my real ngrok host.

**If it fails:** ngrok not authenticated, or I typed `https://` inside `PUBLIC_HOST`.

---

### Step 3: Twilio webhook and the TwiML that starts the stream

**Goal:** when I call, Twilio contacts my server, and my server tells Twilio to start streaming my voice.

**Ask the agent:**
> Do Step 3 of PLAN.md. Add `POST /voice` (parse `application/x-www-form-urlencoded` bodies). Log "Webhook hit" with the `CallSid` and `From` fields. Respond with `Content-Type: text/xml` and this TwiML, with the host taken from `PUBLIC_HOST`:
>
> ```xml
> <Response>
>   <Start><Stream url="wss://PUBLIC_HOST/media" track="inbound_track"/></Start>
>   <Say>Connected. Please start speaking.</Say>
>   <Pause length="300"/>
> </Response>
> ```
>
> The `Pause` keeps the call open (without it the call would end immediately). Do not build `/media` yet. Then stop.

**Do (by me), Twilio setup:**
1. Twilio Console, Phone Numbers, Manage, Active numbers, click my number.
2. In Voice Configuration, set "A call comes in" to **Webhook**, URL = `https://<ngrok-host>/voice`, method = **HTTP POST**. Save.

**Check:**
1. Server and ngrok both running.
2. Call the Twilio number from my verified phone.
3. I hear the trial message, then "Connected. Please start speaking."
4. The server log shows "Webhook hit" with my number.
5. The ngrok web interface (`http://127.0.0.1:4040`) shows the `POST /voice` request.

**If it fails:**
- No "Webhook hit": wrong webhook URL, ngrok URL changed, or method is not POST.
- Call rejected: my phone is not a Verified Caller ID, or the sign-up country restriction applies.
- Twilio says an application error: check the Twilio Console debugger and the response body.

---

### Step 4: Catch the audio packets (the main milestone)

**Goal:** see Twilio's WebSocket messages arriving live.

**Ask the agent:**
> Do Step 4 of PLAN.md. Attach a WebSocket server (`ws`) to the same HTTP server at path `/media`. For each connection, parse every message as JSON and switch on `event`:
> - `connected`: log it.
> - `start`: log the full message once (pretty-printed). Remember `callSid` and `streamSid` if present.
> - `media`: do NOT log the payload. Count messages, decode `media.payload` from base64 and log, once per second at most, a line like: `track=inbound packets=250 lastBytes=160 timestamp=...`.
> - `stop`: log it and the total packet count.
> Also log when the WebSocket closes. Then stop.

**Check:**
1. Restart the server (ngrok URL unchanged), call the number, and speak.
2. The log shows `connected`, then `start`, then the packet counter rising once per second while I talk, then `stop` when I hang up.
3. Look at the `start` message: confirm it lists the track(s) and shows the audio format (expected 8000 Hz mulaw). **(verify)**
4. Each packet should be about 160 bytes, which is 20 ms of audio. **(verify)**

**If it fails:**
- Webhook hit but no `connected`: the `wss://` URL is wrong, the host has `https://` in it, or the server is not on `/media`.
- Packets stop early: the `Pause` ended or the trial 10-minute limit was reached.

---

### Step 5: Prove the audio is real (save a recording)

**Goal:** save what the server heard and play it back.

**Ask the agent:**
> Do Step 5 of PLAN.md. For each call, append every decoded `media` payload (raw mulaw bytes) to `recordings/<callSid>_<track>.ulaw`, and when the stream stops, also write a playable `.wav` next to it (WAV header with format code 7 = mulaw, 8000 Hz, mono, 8 bits). Create the folder if missing. Add `recordings/` to `.gitignore`. Log the saved file paths. Then stop.

**Check:** call, speak for 10 seconds, hang up, then open the `.wav` in VLC. I should hear my own voice. (If a player cannot play it, `ffplay -f mulaw -ar 8000 -ac 1 file.ulaw` works if ffmpeg is installed.)

**If it fails:** the audio sounds like loud noise: bytes were saved after a wrong conversion; save them exactly as decoded from base64.

---

### Step 6: Live transcription with Deepgram

**Goal:** speak on the phone, see the text in the terminal almost immediately.

**Ask the agent:**
> Do Step 6 of PLAN.md. Create `transcriber.js` that opens a WebSocket from the server to Deepgram for each call:
> - URL: `wss://api.deepgram.com/v1/listen?model=nova-3&encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&punctuate=true`
> - Header: `Authorization: Token <DEEPGRAM_API_KEY>` (from `.env`).
> - Send each decoded `media` payload to Deepgram as a binary message, exactly as received (no conversion).
> - Every 5 seconds send the text message `{"type":"KeepAlive"}`. When the call stops, send `{"type":"CloseStream"}` and close.
> - Parse Deepgram's JSON. For messages with `type` equal to `Results`, read `channel.alternatives[0].transcript` and `is_final`. Print to the terminal only: show interim text on one updating line (use `\r` and clear the line), and print each final result as a new line, e.g. `[Caller] hello how are you`. Ignore empty transcripts.
> - Log Deepgram connection open, close and error events clearly (including the HTTP status if the connection is rejected).
> If a query parameter is rejected by Deepgram, remove the optional ones first (`punctuate`, then `interim_results`) and tell me which one failed. Then stop.

**Check:** call, say a few full sentences. Words appear in the terminal while or just after I speak, and finalized lines appear after short pauses. Note roughly how long after speaking the text appears.

**Phase 1 is complete after this step.**

**If it fails:**
- Deepgram connection rejected (401 or 403): wrong API key or missing `Token` prefix.
- Empty or garbled text: `encoding` and `sample_rate` do not match the audio. They must be `mulaw` and `8000`.
- Nothing printed but packets arrive: check that bytes are sent as binary, not as text.

---

### Step 7 (Phase 2): Two people on the call

**Goal:** me plus a second person, each transcribed and labelled separately.

**Do (by me) first:**
- The second person's phone must be a Verified Caller ID in my Twilio account (trial limit).
- Put their number in `.env` as `SECOND_NUMBER` (international format, for example `+92...`).

**Ask the agent:**
> Do Step 7 of PLAN.md. Change the `/voice` TwiML to:
>
> ```xml
> <Response>
>   <Start><Stream url="wss://PUBLIC_HOST/media" track="both_tracks"/></Start>
>   <Dial>SECOND_NUMBER</Dial>
> </Response>
> ```
>
> In `/media`, read `media.track` on every packet. Create **one Deepgram connection per track** (so `inbound` and `outbound` are transcribed separately). Label inbound as "Caller" and outbound as "Callee". Save each track to its own recording file. In the terminal, print only **final** results (skip interim lines, because two speakers would overwrite each other's updating line), each prefixed with the speaker label, with the two speakers in different ANSI colours, e.g. `[Caller] hello` and `[Callee] hi there`. Log the first few packets of each track so I can see both arriving. Then stop.

**Check:**
1. Call the Twilio number from my phone. Twilio rings the second phone. Both answer.
2. I speak: terminal lines appear labelled `[Caller]`. The other person speaks: lines appear labelled `[Callee]`.
3. Open the two saved recordings. One should contain only my voice, the other only theirs. **(verify the track-to-person mapping here; swap the labels if reversed)**
4. Test one person using speakerphone: the other track may pick up a faint echo of the first person.

**If it fails:**
- Second phone never rings: the number is not a Verified Caller ID, or the trial country restriction applies.
- Only one track arrives: the stream used `inbound_track`; confirm `track="both_tracks"` in the TwiML and in the logged `start` message.

---

### Step 8: Tidy up

**Ask the agent:**
> Do Step 8 of PLAN.md. Handle Deepgram disconnects gracefully (log and, if the call is still active, reconnect once). Make sure all sockets close when a call ends. Add a short `README.md` with the setup and run instructions from this plan. Do not add new features. Then stop.

---

## 7. Quick test checklist

Run through this whenever something seems broken:

1. `http://localhost:3000/health` shows `ok`.
2. `https://<ngrok-host>/health` shows `ok`.
3. The Twilio number's webhook URL matches the **current** ngrok host and uses POST.
4. Calling the number plays the trial message, then my greeting.
5. Server log shows "Webhook hit", then `connected`, `start`, and packets.
6. Terminal shows transcript text (this is the final check).

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Call fails or gets an error message | Phone not verified, trial country restriction, or webhook URL wrong |
| "Webhook hit" never logs | ngrok URL changed or webhook not set to POST |
| Webhook hits, but no WebSocket `connected` | Bad `wss://` URL in the TwiML, or `https://` typed into `PUBLIC_HOST` |
| Packets arrive, no text | Deepgram key wrong, or `encoding`/`sample_rate` mismatch |
| Text is garbled | Audio was converted or saved incorrectly; send raw mulaw bytes |
| Call cuts after 10 minutes | Twilio trial call limit |
| Worked yesterday, not today | ngrok restarted and gave a new URL |

## 9. Later (after this works)

- Replace Deepgram with a different transcription engine behind the same small `transcriber` interface.
- Test Urdu and English mixed speech, which this plan has not tested.
- Add analysis on the final text (intent, sentiment, tool calls).
- Validate Twilio's request signature on `/voice` before any non-demo use.
- Keep API keys out of the repository and rotate any key that was ever pasted into a chat.