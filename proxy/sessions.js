// Per-call session state for the WebSocket proxy

const sessions = new Map();

function create(callSid) {
  sessions.set(callSid, {
    callSid,
    twilioWs:        null,
    elevenLabsWs:    null,
    convId:          null,
    streamSid:       null,
    from:            '',
    to:              '',
    mode:            'conversation', // conversation | collecting_card | collecting_pin | verifying
    cardDigits:      '',
    pinDigits:       '',
    dtmfInTone:      false,
    dtmfSilentCount: 0,
    seqNumber:       1,
    pendingInjection: null
  });
  return sessions.get(callSid);
}

function get(callSid)           { return sessions.get(callSid); }
function remove(callSid)        { sessions.delete(callSid);     }
function setMode(callSid, mode) {
  const s = sessions.get(callSid);
  if (s) {
    console.log(`[SESSION] ${callSid} mode: ${s.mode} → ${mode}`);
    s.mode = mode;
  }
}

module.exports = { create, get, remove, setMode };
