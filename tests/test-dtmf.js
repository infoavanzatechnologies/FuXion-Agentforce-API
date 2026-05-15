// DTMF Detection using Goertzel Algorithm
// Tests if we can detect keypad digits from raw audio

// DTMF frequency pairs for each digit
const DTMF_FREQS = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
};

const ALL_ROW_FREQS = [697, 770, 852, 941];
const ALL_COL_FREQS = [1209, 1336, 1477];
const ALL_FREQS     = [...ALL_ROW_FREQS, ...ALL_COL_FREQS];
const SAMPLE_RATE   = 8000; // Twilio uses 8kHz

// Goertzel Algorithm — detects energy at a specific frequency
function goertzel(samples, targetFreq, sampleRate) {
  const k       = Math.round((samples.length * targetFreq) / sampleRate);
  const omega   = (2 * Math.PI * k) / samples.length;
  const coeff   = 2 * Math.cos(omega);
  let s0 = 0, s1 = 0, s2 = 0;

  for (const sample of samples) {
    s0 = sample + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  return (s2 * s2) + (s1 * s1) - (coeff * s1 * s2);
}

// Decode µ-law to linear PCM (Twilio sends µ-law audio)
function mulawToLinear(mulaw) {
  mulaw = ~mulaw;
  const sign = mulaw & 0x80;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0F;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign !== 0 ? -sample : sample;
}

function decodeMultilaw(buffer) {
  const samples = new Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    samples[i] = mulawToLinear(buffer[i]) / 32768.0; // normalize
  }
  return samples;
}

// Detect DTMF digit from audio samples
function detectDTMF(samples) {
  const energies = {};
  for (const freq of ALL_FREQS) {
    energies[freq] = goertzel(samples, freq, SAMPLE_RATE);
  }

  const threshold = 500;

  // Find dominant row frequency
  const activeRows = ALL_ROW_FREQS.filter(f => energies[f] > threshold);
  const activeCols = ALL_COL_FREQS.filter(f => energies[f] > threshold);

  if (activeRows.length !== 1 || activeCols.length !== 1) return null;

  const rowFreq = activeRows[0];
  const colFreq = activeCols[0];

  // Match to digit
  for (const [digit, [row, col]] of Object.entries(DTMF_FREQS)) {
    if (row === rowFreq && col === colFreq) return digit;
  }
  return null;
}

// Generate a DTMF tone as µ-law audio (simulates what Twilio sends)
function generateDTMFTone(digit, durationMs = 100) {
  const [f1, f2] = DTMF_FREQS[digit];
  const numSamples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const buffer = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t      = i / SAMPLE_RATE;
    const sample = 0.4 * Math.sin(2 * Math.PI * f1 * t) +
                   0.4 * Math.sin(2 * Math.PI * f2 * t);
    // Convert to µ-law
    const linear = Math.max(-1, Math.min(1, sample));
    const abs    = Math.abs(linear);
    const sign   = linear >= 0 ? 0 : 0x80;
    let exp      = 0;
    let absI     = Math.floor(abs * 32767);
    absI         = Math.min(absI + 132, 32767);
    for (let e = 7; e >= 0; e--) {
      if (absI >= (1 << (e + 3))) { exp = e; break; }
    }
    const mantissa  = (absI >> (exp + 3)) & 0x0F;
    buffer[i] = ~(sign | (exp << 4) | mantissa) & 0xFF;
  }

  return buffer;
}

// Run the test
function runTest() {
  console.log('\n========================================');
  console.log('TEST 2: DTMF Detection from µ-law Audio');
  console.log('========================================\n');

  const testDigits  = ['1','2','3','4','5','6','7','8','9','0','#','*'];
  let   passed      = 0;
  let   failed      = 0;
  const FRAME_SIZE  = 160; // 20ms at 8kHz — standard Twilio packet size

  console.log('Testing each DTMF digit...\n');

  for (const digit of testDigits) {
    const audioBuffer = generateDTMFTone(digit, 200); // 200ms tone
    const samples = decodeMultilaw(audioBuffer);
    let   detected = null;

    for (let i = 0; i + FRAME_SIZE <= samples.length; i += FRAME_SIZE) {
      const frame  = samples.slice(i, i + FRAME_SIZE);
      const result = detectDTMF(frame);
      if (result) { detected = result; break; }
    }

    const pass = detected === digit;
    pass ? passed++ : failed++;
    console.log(`Digit "${digit}": Generated → Detected "${detected || 'none'}" ${pass ? '✅' : '❌'}`);
  }

  console.log('\n========================================');
  console.log(`TEST 2 RESULTS: ${passed}/${testDigits.length} digits detected correctly`);
  console.log('========================================');

  if (passed === testDigits.length) {
    console.log('✅ DTMF detection works perfectly on µ-law audio');
    console.log('✅ Proxy can detect keypad digits from Twilio stream');
  } else if (passed >= 10) {
    console.log('⚠️  Most digits work — threshold tuning needed');
  } else {
    console.log('❌ Detection unreliable — need different approach');
  }

  // Bonus: Test card number sequence
  console.log('\n--- Bonus: Full card number simulation ---');
  const cardNumber = '1234567890123456';
  let   detected   = '';

  for (const digit of cardNumber) {
    const buf     = generateDTMFTone(digit, 200);
    const samples = decodeMultilaw(buf);
    let   result  = null;

    for (let i = 0; i + FRAME_SIZE <= samples.length; i += FRAME_SIZE) {
      const r = detectDTMF(samples.slice(i, i + FRAME_SIZE));
      if (r) { result = r; break; }
    }
    detected += result || '?';
  }

  console.log('Original:  ', cardNumber);
  console.log('Detected:  ', detected);
  console.log('Match:', cardNumber === detected ? '✅ Perfect' : '❌ Mismatch');
}

runTest();
