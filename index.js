require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const qs = require('qs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let sessionMap = {}; // Stores user-specific session and sequence

// Get Salesforce token
async function getSFToken() {
  const response = await axios.post(process.env.SF_TOKEN_URL, null, {
    params: {
      grant_type: 'client_credentials',
      client_id: process.env.SF_CLIENT_ID,
      client_secret: process.env.SF_CLIENT_SECRET
    }
  });
  return response.data.access_token;
}

// Start Agent session
async function startAgentSession(token) {
  const res = await axios.post(
    `${process.env.SF_API_HOST}/einstein/ai-agent/v1/agents/${process.env.AGENT_ID}/sessions`,
    {
    externalSessionKey: "session-" + uuidv4(),
    instanceConfig: {
      endpoint: process.env.SF_INSTANCE
    },
    tz: "America/Los_Angeles",
    variables: [
      {
        name: "$Context.EndUserLanguage",
        type: "Text",
        value: "en_US"
      }
    ],
    featureSupport: "Streaming",
    streamingCapabilities: {
      chunkTypes: ["Text"]
    },
    bypassUser: true
  },
  {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  }
  );
  return res.data.sessionId;
}

// Send message to agent
async function sendMessageToAgent(token, sessionId, message, sequenceId) {
  const res = await axios.post(
    `${process.env.SF_API_HOST}/einstein/ai-agent/v1/sessions/${sessionId}/messages`,
    {message: {
        sequenceId: sequenceId,
        type: "Text",
        text: message
      },
      variables: []
    },
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  return res.data.messages[0].message;
}

// ElevenLabs TTS
async function textToSpeech(text) {
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE_ID}`,
    {
      text,
      model_id: "eleven_monolingual_v1"
    },
    {
      headers: {
        'xi-api-key': process.env.ELEVEN_API_KEY
      },
      responseType: 'arraybuffer'
    }
  );
  return response.data;
}

// Main Endpoint
app.post('/chat', async (req, res) => {
  const userId = req.body.userId;
  const userText = req.body.text;

  try {
    const token = await getSFToken();

    // Start session if not present
    if (!sessionMap[userId]) {
      const sessionId = await startAgentSession(token);
      sessionMap[userId] = {
        sessionId,
        sequenceId: 1
      };
    }

    const { sessionId, sequenceId } = sessionMap[userId];
    const agentReply = await sendMessageToAgent(token, sessionId, userText, sequenceId);
    sessionMap[userId].sequenceId += 1;

    res.json({
      userId,
      sessionId,
      agentReply
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});


// Lead Agent SDO
// Get Salesforce token
async function getLeadSFToken() {
  const response = await axios.post(process.env.SF_LEAD_TOKEN_URL, null, {
    params: {
      grant_type: 'client_credentials',
      client_id: process.env.SF_LEAD_CLIENT_ID,
      client_secret: process.env.SF_LEAD_CLIENT_SECRET
    }
  });
  return response.data.access_token;
}

// Start Agent session
async function startLeadAgentSession(token) {
  const res = await axios.post(
    `${process.env.SF_LEAD_API_HOST}/einstein/ai-agent/v1/agents/${process.env.LEAD_AGENT_ID}/sessions`,
    {
    externalSessionKey: "session-" + uuidv4(),
    instanceConfig: {
      endpoint: process.env.SF_LEAD_INSTANCE
    },
    tz: "America/Los_Angeles",
    variables: [
      {
        name: "$Context.EndUserLanguage",
        type: "Text",
        value: "en_US"
      }
    ],
    featureSupport: "Streaming",
    streamingCapabilities: {
      chunkTypes: ["Text"]
    },
    bypassUser: true
  },
  {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  }
  );
  return res.data.sessionId;
}

// Send message to agent
async function sendMessageToLeadAgent(token, sessionId, message, sequenceId) {
  const res = await axios.post(
    `${process.env.SF_LEAD_API_HOST}/einstein/ai-agent/v1/sessions/${sessionId}/messages`,
    {message: {
        sequenceId: sequenceId,
        type: "Text",
        text: message
      },
      variables: []
    },
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  return res.data.messages[0].message;
}

// Main Endpoint
app.post('/lead', async (req, res) => {
  const userId = req.body.userId;
  const userText = req.body.text;

  try {
    const token = await getLeadSFToken();

    // Start session if not present
    if (!sessionMap[userId]) {
      const sessionId = await startLeadAgentSession(token);
      sessionMap[userId] = {
        sessionId,
        sequenceId: 1
      };
    }

    const { sessionId, sequenceId } = sessionMap[userId];
    const agentReply = await sendMessageToLeadAgent(token, sessionId, userText, sequenceId);
    sessionMap[userId].sequenceId += 1;

    res.json({
      userId,
      sessionId,
      agentReply
    });
  } catch (err) {
  const errorDetails = err.response?.data || err.message;
  console.error("Full error:", JSON.stringify(errorDetails, null, 2));
  console.error("Status:", err.response?.status);
  console.error("URL:", err.config?.url);
  res.status(500).json({ 
    error: 'Something went wrong',
    details: errorDetails  // Remove this in production!
  });
}
});




// Get Unison OAuth token
async function getUnisonToken() {
  const data = qs.stringify({
    username: process.env.UNISON_USERNAME,
    password: process.env.UNISON_PASSWORD,
    grant_type: 'password'
  });

  const response = await axios.post(
    'https://unison-presales1.avanzasolutions.com:3000/oauth/token',
    data,
    {
      headers: {
        Authorization: `Basic ${process.env.UNISON_BASIC_AUTH}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      timeout: 10000
    }
  );

  return response.data;
}

app.post('/unison/token', async (req, res) => {
  try {
    const tokenResponse = await getUnisonToken();

    res.json({
      success: true,
      token: tokenResponse
    });
  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      success: false,
      error: 'Failed to fetch Unison OAuth token'
    });
  }
});

const casePayload = {
  COMPLAINT_TYPE: "280624182821211",
  COMPLAINT_TICKET_NUMBER: "",
  CUST_RELATION_NUM: "619",
  PRODUCT_CODE: "CA",
  PRODUCT_ENTITY_ID: "0000000004",
  DOC_MEDIUM: "001",
  PRODUCT_NUMBER: "",
  COMPLAINT_MEASURE: "",
  COMPLAINT_NATURE: "",
  INVOLVE: "",
  DOC_PRIORITY: "P2",
  NOTES: "",
  REF_COMP_NUM: "",
  INVALID_COMPLAINT: "",
  CURRENT_STATE: "",
  CUST_CALLBACK_PHONE: "",
  CUST_CALLBACK_EMAIL: "",
  ALTERNATE_ADDRESS: "DUBAI",
  ACK_EMAIL: "",
  CUST_EMAIL: "brandon.tim@bestbank.com",
  ACK_SMS: "",
  CUST_MOBILE_NUM: "032025550141",
  RESPONSE_LANGUAGE: "0000000077"
};


async function createUnisonCase(accessToken, casePayload) {
  const response = await axios.post(
    'https://unison-presales1.avanzasolutions.com:3000/unison/data/0000000075',
    casePayload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 10000
    }
  );

  return response.data;
}

app.post('/unison/create-case', async (req, res) => {
  try {
    const unisonTokenResponse = await getUnisonToken();
    const accessToken = unisonTokenResponse.access_token;

    // HARD-CODED CASE PAYLOAD
    const casePayload = {
      COMPLAINT_TYPE: "2021-04-05-134652",
      COMPLAINT_TICKET_NUMBER: "",
      CUST_RELATION_NUM: "619",
      PRODUCT_CODE: "CA",
      PRODUCT_ENTITY_ID: "0000000004",
      DOC_MEDIUM: "001",
      PRODUCT_NUMBER: "",
      COMPLAINT_MEASURE: "",
      COMPLAINT_NATURE: "",
      INVOLVE: "",
      DOC_PRIORITY: "P2",
      NOTES: "",
      REF_COMP_NUM: "",
      INVALID_COMPLAINT: "",
      CURRENT_STATE: "",
      CUST_CALLBACK_PHONE: "",
      CUST_CALLBACK_EMAIL: "",
      ALTERNATE_ADDRESS: "DUBAI",
      ACK_EMAIL: "",
      CUST_EMAIL: "brandon.tim@bestbank.com",
      ACK_SMS: "",
      CUST_MOBILE_NUM: "032025550141",
      RESPONSE_LANGUAGE: "0000000077"
    };

    const caseResponse = await createUnisonCase(
      accessToken,
      casePayload
    );

    res.json({
      success: true,
      data: caseResponse
    });

  } catch (err) {
    console.error(err.response?.data || err.message);

    res.status(500).json({
      success: false,
      error: 'Failed to create Unison case'
    });
  }
});

// Add near top of server.js, after existing requires:
const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Separate map for DTMF sessions (don't mix with sessionMap)
const dtmfSessions = {};
const pendingResults = {};
// ─────────────────────────────────────────────────
// CARD UNBLOCK — DTMF Collection via Twilio
// ─────────────────────────────────────────────────

// Step 1: ElevenLabs fires this tool when card unblock detected
app.post('/tool/collect-card-dtmf', async (req, res) => {
  const { call_sid } = req.body;
  console.log('[DTMF] Tool called. call_sid:', call_sid);

  // Add these logs
  console.log('[DTMF] TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID);
  console.log('[DTMF] TWILIO_AUTH_TOKEN length:', process.env.TWILIO_AUTH_TOKEN?.length);
  console.log('[DTMF] BASE_URL:', process.env.BASE_URL);

  if (!call_sid) {
    return res.status(400).json({ error: 'call_sid is required' });
  }

  dtmfSessions[call_sid] = {
    cardNumber: null,
    pin: null,
    startedAt: Date.now()
  };

  try {
    console.log('[DTMF] Attempting Twilio redirect...');
    console.log('[DTMF] Redirect URL:', `${process.env.BASE_URL}/gather/card?call_sid=${call_sid}`);
    
    await twilioClient.calls(call_sid).update({
      url: `${process.env.BASE_URL}/gather/card?call_sid=${call_sid}`,
      method: 'POST'
    });

    console.log('[DTMF] Call redirected to /gather/card');
    res.json({ success: true });
  } catch (err) {
    console.error('[DTMF] Twilio redirect failed:', err.message);
    console.error('[DTMF] Twilio error code:', err.code);
    console.error('[DTMF] Twilio error status:', err.status);
    console.error('[DTMF] Twilio error details:', JSON.stringify(err));
    res.status(500).json({ error: 'Failed to redirect call' });
  }
});

// Step 2: TwiML — collect 16-digit card number
app.all('/gather/card', (req, res) => {
  const call_sid = req.query.call_sid || req.body.call_sid;
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: 'dtmf',
    numDigits: 16,
    timeout: 15,
    finishOnKey: '#',
    action: `${process.env.BASE_URL}/gather/pin?call_sid=${call_sid}`,
    method: 'POST'
  });

  gather.say({
    voice: 'Polly.Joanna',
    language: 'en-US'
  }, 'Please enter your 16 digit card number on your keypad, ' +
     'followed by the hash key.');

  twiml.say('We did not receive your card number. Please call back and try again.');
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
});

// Step 3: TwiML — store card number, collect 4-digit PIN
app.post('/gather/pin', (req, res) => {
  const call_sid = req.query.call_sid || req.body.call_sid;
  const cardNumber = req.body.Digits;

  console.log('[DTMF] Card received for', call_sid, '— last4:', cardNumber?.slice(-4));

  if (dtmfSessions[call_sid]) {
    dtmfSessions[call_sid].cardNumber = cardNumber;
  }

  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    input: 'dtmf',
    numDigits: 4,
    timeout: 10,
    finishOnKey: '#',
    action: `${process.env.BASE_URL}/verify-card?call_sid=${call_sid}`,
    method: 'POST'
  });

  gather.say({
    voice: 'Polly.Joanna',
    language: 'en-US'
  }, 'Thank you. Now please enter your 4 digit PIN followed by the hash key.');

  twiml.say('We did not receive your PIN. Please call back and try again.');
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
});

// Step 4: Receive PIN, verify with Salesforce, reconnect ElevenLabs
app.post('/verify-card', async (req, res) => {
  console.log('[VERIFY] Endpoint hit');
  console.log('[VERIFY] Body:', req.body);
  console.log('[VERIFY] Query:', req.query);

  const call_sid = req.query.call_sid || req.body.call_sid;
  const pin      = req.body.Digits;
  const session  = dtmfSessions[call_sid];

  console.log('[VERIFY] call_sid:', call_sid);
  console.log('[VERIFY] PIN entered:', pin);
  console.log('[VERIFY] Session:', session);

  if (!session || !session.cardNumber) {
    console.log('[VERIFY] Session not found or no card number');
    const twiml = new VoiceResponse();
    twiml.say('Session expired. Please call back.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  session.pin = pin;

  let verified  = false;
  let cardLast4 = session.cardNumber.slice(-4);
  let statusMsg = '';

  const TEST_CARD = '1234567890123456';
  const TEST_PIN  = '1234';

  console.log('[VERIFY] Card match:', session.cardNumber === TEST_CARD);
  console.log('[VERIFY] PIN match:', pin === TEST_PIN);

  if (session.cardNumber === TEST_CARD && pin === TEST_PIN) {
    verified  = true;
    statusMsg = 'Card unblocked successfully';
  } else {
    verified  = false;
    statusMsg = 'PIN mismatch';
  }

  console.log('[VERIFY] Result:', verified, statusMsg);


// In /verify-card, after verification logic, BEFORE delete dtmfSessions:
pendingResults[call_sid] = {
  verified,
  cardLast4,
  statusMsg,
  timestamp: Date.now()
};
console.log('[VERIFY] Result stored for later retrieval:', call_sid);

delete dtmfSessions[call_sid];

const resumeUrl = `${process.env.BASE_URL}/resume-agent?` +
  `verified=${verified}` +
  `&last4=${cardLast4}` +
  `&status=${encodeURIComponent(statusMsg)}`;

console.log('[VERIFY] Resume URL:', resumeUrl);

const twiml = new VoiceResponse();
twiml.redirect(resumeUrl);

console.log('[VERIFY] TwiML output:', twiml.toString());
res.type('text/xml').send(twiml.toString());
});

// Step 5: Reconnect ElevenLabs with verification result injected
app.all('/resume-agent', async (req, res) => {
  console.log('[RESUME] Endpoint hit');
  console.log('[RESUME] Query:', req.query);
  console.log('[RESUME] Body:', req.body);

  const agentId = process.env.ELEVENLABS_AGENT_ID;

  try {
    const twilioParams = new URLSearchParams(req.body).toString();

    const elResponse = await axios.post(
      `https://api.us.elevenlabs.io/twilio/inbound_call`,
      twilioParams,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('[RESUME] ElevenLabs raw TwiML:', elResponse.data);

    const modifiedTwiml = elResponse.data.replace(
      '</Stream>',
      `<Parameter name="pending_call_sid" value="${req.body.CallSid}" />
    </Stream>`
    );

    console.log('[RESUME] Modified TwiML:', modifiedTwiml);
    res.type('text/xml').send(modifiedTwiml);

  } catch (err) {
    console.error('[RESUME] ElevenLabs call failed:', err.response?.status);
    const twiml = new VoiceResponse();
    twiml.redirect(
      `https://api.us.elevenlabs.io/twilio/inbound_call?agent_id=${agentId}`
    );
    res.type('text/xml').send(twiml.toString());
  }
});

app.post('/tool/get-card-result', (req, res) => {
  const { call_sid } = req.body;
  console.log('[RESULT] Checking pending result for:', call_sid);

  // Handle empty or default value
  if (!call_sid || call_sid === 'none') {
    console.log('[RESULT] No valid call_sid provided');
    return res.json({ has_result: false });
  }

  const result = pendingResults[call_sid];

  if (result) {
    delete pendingResults[call_sid];
    console.log('[RESULT] Found result:', result);
    return res.json({
      has_result: true,
      verified: result.verified,
      card_last4: result.cardLast4,
      status: result.statusMsg
    });
  }

  console.log('[RESULT] No pending result found');
  res.json({ has_result: false });
});

app.listen(3000, () => {
  console.log('Node server running on port 3000');
});
