require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const qs = require('qs');

const app = express();
app.use(express.json());

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

// ─────────────────────────────────────────────────
// CARD UNBLOCK — DTMF Collection via Twilio
// ─────────────────────────────────────────────────

// Step 1: ElevenLabs fires this tool when card unblock detected
app.post('/tool/collect-card-dtmf', async (req, res) => {
  const { call_sid } = req.body;
  console.log('[DTMF] Tool called. call_sid:', call_sid);

  if (!call_sid) {
    return res.status(400).json({ error: 'call_sid is required' });
  }

  // Store session keyed by callSid
  dtmfSessions[call_sid] = {
    cardNumber: null,
    pin: null,
    startedAt: Date.now()
  };

  try {
    await twilioClient.calls(call_sid).update({
      url: `${process.env.BASE_URL}/gather/card?call_sid=${call_sid}`,
      method: 'POST'
    });

    console.log('[DTMF] Call redirected to /gather/card');
    res.json({ success: true });
  } catch (err) {
    console.error('[DTMF] Twilio redirect failed:', err.message);
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
  const call_sid = req.query.call_sid || req.body.call_sid;
  const pin = req.body.Digits;
  const session = dtmfSessions[call_sid];

  if (!session || !session.cardNumber) {
    const twiml = new VoiceResponse();
    twiml.say('Session expired. Please call back.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  session.pin = pin;
  console.log('[DTMF] Verifying card for call:', call_sid);

  let verified = false;
  let cardLast4 = session.cardNumber.slice(-4);
  let statusMsg = '';

  try {
    const token = await getSFToken(); // reuse your existing function

    // SOQL query — adapt object/field names to your SF schema
    const soql = `SELECT Id, Card_Number__c, PIN__c, Status__c 
                  FROM Bank_Card__c 
                  WHERE Card_Number__c = '${session.cardNumber}' 
                  LIMIT 1`;

    const sfRes = await axios.get(
      `${process.env.SF_INSTANCE}/services/data/v59.0/query`,
      {
        params: { q: soql },
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    const records = sfRes.data.records;
    if (records.length === 0) {
      statusMsg = 'Card not found';
    } else {
      const card = records[0];
      if (card.PIN__c === pin) {
        verified = true;
        // Update card status to unblocked
        await axios.patch(
          `${process.env.SF_INSTANCE}/services/data/v59.0/sobjects/Bank_Card__c/${card.Id}`,
          { Status__c: 'Active' },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        statusMsg = 'Card unblocked successfully';
      } else {
        statusMsg = 'PIN mismatch';
      }
    }
  } catch (err) {
    console.error('[DTMF] SF verification error:', err.response?.data || err.message);
    statusMsg = 'Verification service error';
  }

  // Clean up DTMF session
  delete dtmfSessions[call_sid];

  // Redirect call back to ElevenLabs with result as Stream Parameters
  await twilioClient.calls(call_sid).update({
    url: `${process.env.BASE_URL}/resume-agent?` +
         `call_sid=${call_sid}` +
         `&verified=${verified}` +
         `&last4=${cardLast4}` +
         `&status=${encodeURIComponent(statusMsg)}`,
    method: 'POST'
  });

  // Brief pause while redirect takes effect
  const twiml = new VoiceResponse();
  twiml.pause({ length: 1 });
  res.type('text/xml').send(twiml.toString());
});

// Step 5: Reconnect ElevenLabs with verification result injected
app.all('/resume-agent', (req, res) => {
  const { verified, last4, status } = req.query;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  // These Stream Parameters map to ElevenLabs Variables
  // card_verified, card_last4, unblock_status must be defined
  // in your ElevenLabs agent Variables panel
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.elevenlabs.io/v1/convai/twilio?agent_id=${agentId}">
      <Parameter name="card_verified" value="${verified}" />
      <Parameter name="card_last4"   value="${last4 || ''}" />
      <Parameter name="unblock_status" value="${decodeURIComponent(status || '')}" />
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});

app.listen(3000, () => {
  console.log('Node server running on port 3000');
});
