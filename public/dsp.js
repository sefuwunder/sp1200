// SP-1200 DSP core: drum synthesis + the SP-1200 signal path + swing timing.
// Pure functions, no DOM — runs in the browser and in node for tests.
//
// The SP-1200 sound in three ingredients:
//   1. 26.04 kHz sample rate  -> everything above ~13 kHz folds back as grit
//   2. 12-bit quantization     -> crunchy, forward mids
//   3. Varispeed pitch         -> tuning a pad replays the sample faster or
//                                slower, exactly like the original hardware

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSP = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // The SP-1200's converters ran at 26.04 kHz, 12 bits.
  const SP_RATE = 26040;
  const SP_BITS = 12;
  const SYNTH_RATE = 44100; // drums are synthesized clean, then "sampled" by the SP path

  // ---------- tiny DSP utilities ----------

  function makeNoise(n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
    return out;
  }

  function lowpass(x, sr, cutoff) {
    const rc = 1 / (2 * Math.PI * cutoff), dt = 1 / sr, a = dt / (rc + dt);
    const y = new Float32Array(x.length);
    let prev = 0;
    for (let i = 0; i < x.length; i++) { prev += a * (x[i] - prev); y[i] = prev; }
    return y;
  }

  function highpass(x, sr, cutoff) {
    const rc = 1 / (2 * Math.PI * cutoff), dt = 1 / sr, a = rc / (rc + dt);
    const y = new Float32Array(x.length);
    let prevY = 0, prevX = 0;
    for (let i = 0; i < x.length; i++) {
      const v = a * (prevY + x[i] - prevX);
      y[i] = v; prevY = v; prevX = x[i];
    }
    return y;
  }

  function normalize(x, peak) {
    let m = 0;
    for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
    if (m > 0) { const g = peak / m; for (let i = 0; i < x.length; i++) x[i] *= g; }
    return x;
  }

  // ---------- the SP-1200 signal path ----------

  function resampleLinear(input, fromRate, toRate) {
    if (fromRate === toRate) return Float32Array.from(input);
    const ratio = fromRate / toRate;
    const n = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos), i1 = Math.min(i0 + 1, input.length - 1);
      const f = pos - i0;
      out[i] = input[i0] * (1 - f) + input[i1] * f;
    }
    return out;
  }

  // 12-bit quantization, the SP's crunch.
  function quantize12(input) {
    const scale = Math.pow(2, SP_BITS - 1) - 1; // 2047
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const v = Math.max(-1, Math.min(1, input[i]));
      out[i] = Math.round(v * scale) / scale;
    }
    return out;
  }

  // Run clean audio through the SP-1200's converters: 26.04 kHz, 12-bit.
  function sp1200ize(input, fromRate) {
    return quantize12(resampleLinear(input, fromRate, SP_RATE));
  }

  // ---------- drum synthesis (clean, then sampled by the SP path) ----------

  function synthKickRaw() {
    const sr = SYNTH_RATE, dur = 0.5, n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 46 + 150 * Math.exp(-t * 42);
      phase += (2 * Math.PI * f) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 9.5);
      if (t < 0.008) out[i] += (Math.random() * 2 - 1) * Math.exp(-t * 500) * 0.5;
    }
    return normalize(out, 0.92);
  }
  function synthKick() { return sp1200ize(synthKickRaw(), SYNTH_RATE); }

  function synthSnareRaw() {
    const sr = SYNTH_RATE, dur = 0.28, n = Math.floor(sr * dur);
    const noise = highpass(lowpass(makeNoise(n), sr, 7000), sr, 900);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 28) * 0.55;
      out[i] = body + noise[i] * Math.exp(-t * 32) * 0.5;
    }
    return normalize(out, 0.9);
  }
  function synthSnare() { return sp1200ize(synthSnareRaw(), SYNTH_RATE); }

  function synthClapRaw() {
    const sr = SYNTH_RATE, dur = 0.32, n = Math.floor(sr * dur);
    const noise = highpass(lowpass(makeNoise(n), sr, 4500), sr, 700);
    const out = new Float32Array(n);
    const bursts = [0, 0.018, 0.034, 0.052];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (const b of bursts) {
        if (t >= b) v += Math.exp(-(t - b) * 160) * 0.5;
      }
      v += Math.exp(-t * 22) * 0.35; // tail
      out[i] = noise[i] * Math.min(1, v);
    }
    return normalize(out, 0.9);
  }
  function synthClap() { return sp1200ize(synthClapRaw(), SYNTH_RATE); }

  function synthRimRaw() {
    const sr = SYNTH_RATE, dur = 0.07, n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const sq = Math.sign(Math.sin(2 * Math.PI * 1720 * t)) * 0.35
        + Math.sin(2 * Math.PI * 5160 * t) * 0.12;
      out[i] = (sq + (Math.random() * 2 - 1) * 0.25) * Math.exp(-t * 130);
    }
    return normalize(out, 0.85);
  }
  function synthRim() { return sp1200ize(synthRimRaw(), SYNTH_RATE); }

  function hatNoise(sr, dur, decay) {
    const n = Math.floor(sr * dur);
    let noise = makeNoise(n);
    noise = highpass(noise, sr, 7800);
    noise = highpass(noise, sr, 7800); // steeper, like the analog path
    for (let i = 0; i < n; i++) noise[i] *= Math.exp(-(i / sr) * decay);
    return noise;
  }

  function synthClosedHatRaw() { return normalize(hatNoise(SYNTH_RATE, 0.07, 95), 0.8); }
  function synthClosedHat() { return sp1200ize(synthClosedHatRaw(), SYNTH_RATE); }

  function synthOpenHatRaw() { return normalize(hatNoise(SYNTH_RATE, 0.4, 11), 0.8); }
  function synthOpenHat() { return sp1200ize(synthOpenHatRaw(), SYNTH_RATE); }

  function synthTomRaw() {
    const sr = SYNTH_RATE, dur = 0.42, n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 88 + 110 * Math.exp(-t * 18);
      phase += (2 * Math.PI * f) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 8.5);
      if (t < 0.006) out[i] += (Math.random() * 2 - 1) * Math.exp(-t * 600) * 0.3;
    }
    return normalize(out, 0.9);
  }
  function synthTom() { return sp1200ize(synthTomRaw(), SYNTH_RATE); }

  function synthShakerRaw() {
    const sr = SYNTH_RATE, dur = 0.2, n = Math.floor(sr * dur);
    let noise = highpass(makeNoise(n), sr, 5200);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      noise[i] *= Math.exp(-t * 26) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t / dur)));
    }
    return normalize(noise, 0.75);
  }
  function synthShaker() { return sp1200ize(synthShakerRaw(), SYNTH_RATE); }

  const SYNTHS_RAW = {
    kick: synthKickRaw, snare: synthSnareRaw, clap: synthClapRaw, rim: synthRimRaw,
    chat: synthClosedHatRaw, ohat: synthOpenHatRaw, tom: synthTomRaw, shaker: synthShakerRaw,
  };

  const SYNTHS = {
    kick: synthKick, snare: synthSnare, clap: synthClap, rim: synthRim,
    chat: synthClosedHat, ohat: synthOpenHat, tom: synthTom, shaker: synthShaker,
  };

  // ---------- swing ----------

  // Duration of one 16th note in seconds.
  function sixteenthDur(bpm) { return 60 / bpm / 4; }

  // Roger Linn-style swing: even 16ths stay on the grid, odd 16ths slide
  // late. swingPct 50 = straight, 75 = full triplet-style lope.
  function stepTime16(step, bpm, swingPct) {
    const s = Math.min(75, Math.max(50, swingPct)) / 100;
    const d = sixteenthDur(bpm);
    const pairStart = Math.floor(step / 2) * 2 * d;
    return step % 2 === 0 ? pairStart : pairStart + s * 2 * d;
  }

  return {
    SP_RATE, SP_BITS, SYNTH_RATE, SYNTHS, SYNTHS_RAW,
    resampleLinear, quantize12, sp1200ize,
    lowpass, highpass, normalize,
    sixteenthDur, stepTime16,
  };
});
