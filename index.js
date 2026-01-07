require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

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

// Get Unison OAuth token
async function getUnisonToken() {
  const response = await axios.post(
    "https://unison-presales1.avanzasolutions.com:3000/oauth/token",
    {
      username: process.env.UNISON_USERNAME,
      password: process.env.UNISON_PASSWORD,
      grant_type: "password"
    },
    {
      headers: {
        Authorization: `Basic ${process.env.UNISON_BASIC_AUTH}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    }
  );

  return response.data; // usually contains access_token, token_type, expires_in
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


app.listen(3000, () => {
  console.log('Node server running on port 3000');
});
