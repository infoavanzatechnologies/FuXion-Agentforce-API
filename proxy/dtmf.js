// DTMF Detection — Goertzel Algorithm
// Threshold 500 calibrated for normalized µ-law samples

const DTMF_FREQS = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
};

const ALL_ROW_FREQS = [697, 770, 852, 941];
const ALL_COL_FREQS = [1209, 1336, 1477];
const ALL_FREQS     = [...ALL_ROW_FREQS, ...ALL_COL_FREQS];
const SAMPLE_RATE   = 8000;
const THRESHOLD     = 50;

function goertzel(samples, targetFreq, sampleRate) {
  const k     = Math.round((samples.length * targetFreq) / sampleRate);
  const omega = (2 * Math.PI * k) / samples.length;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0, s1 = 0, s2 = 0;
  for (const sample of samples) {
    s0 = sample + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s2 * s2 + s1 * s1 - coeff * s1 * s2;
}

function mulawToLinear(mulaw) {
  mulaw = ~mulaw;
  const sign     = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0F;
  let   sample   = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign !== 0 ? -sample : sample;
}

function decodeBuffer(buffer) {
  const samples = new Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    samples[i] = mulawToLinear(buffer[i]) / 32768.0;
  }
  return samples;
}

function detectDTMF(samples) {
  const energies  = {};
  for (const freq of ALL_FREQS) {
    energies[freq] = goertzel(samples, freq, SAMPLE_RATE);
  }
  const activeRows = ALL_ROW_FREQS.filter(f => energies[f] > THRESHOLD);
  const activeCols = ALL_COL_FREQS.filter(f => energies[f] > THRESHOLD);
  if (activeRows.length !== 1 || activeCols.length !== 1) return null;
  for (const [digit, [row, col]] of Object.entries(DTMF_FREQS)) {
    if (row === activeRows[0] && col === activeCols[0]) return digit;
  }
  return null;
}

function processTwilioChunk(base64Payload) {
  const buffer  = Buffer.from(base64Payload, 'base64');
  const samples = decodeBuffer(buffer);
  return detectDTMF(samples);
}

module.exports = { processTwilioChunk };
