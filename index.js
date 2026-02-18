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
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Something went wrong' });
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


app.listen(3000, () => {
  console.log('Node server running on port 3000');
});
