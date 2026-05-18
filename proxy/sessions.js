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
    mode:            'conversation', // conversation | collecting_card | waiting_for_pin_prompt | collecting_pin | verifying
    cardDigits:      '',
    pinDigits:       '',
    seqNumber:       1,
    pendingInjection: null,
    // Populated by Salesforce lookup when collect_card_dtmf fires
    cardId:          null,
    maskedNumber:    '',
    rejectionReason: ''
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
