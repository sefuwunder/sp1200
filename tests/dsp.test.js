// SP-1200 DSP tests: synthesis, the 12-bit/26.04kHz signal path,
// swing timing, and the sample-editor ops. Runs in node, no DOM.
const assert = require("assert");
const DSP = require("../public/dsp.js");

let n = 0;
function ok(cond, msg) {
  n++;
  assert(cond, msg);
  console.log("ok " + n + " - " + msg);
}

// ---- constants ----
ok(DSP.SP_RATE === 26040, "SP sample rate is 26.04 kHz");
ok(DSP.SP_BITS === 12, "12-bit converter path");
ok(DSP.SYNTH_RATE === 44100, "synth render rate is 44.1 kHz");

// ---- drum voices ----
const ids = ["kick", "snare", "clap", "rim", "chat", "ohat", "tom", "shaker"];
ids.forEach(function (id) {
  const raw = DSP.SYNTHS_RAW[id]();
  ok(raw instanceof Float32Array && raw.length > 0, id + " raw voice renders audio");
  let peak = 0;
  for (const v of raw) peak = Math.max(peak, Math.abs(v));
  ok(peak > 0.1, id + " raw voice has real level");
  const sp = DSP.SYNTHS[id]();
  ok(sp instanceof Float32Array && sp.length > 0, id + " SP voice renders");
  ok(sp.length < raw.length, id + " SP voice is downsampled vs raw");
});

// ---- 12-bit quantization: every sample sits on the 2047-step grid ----
{
  const x = DSP.SYNTHS.kick();
  let grid = true;
  for (let i = 0; i < x.length; i += 7) {
    if (Math.abs(x[i] * 2047 - Math.round(x[i] * 2047)) > 1e-3) { grid = false; break; }
  }
  ok(grid, "SP voices are quantized to the 12-bit grid");
  ok(DSP.quantize12(new Float32Array([2, -2]))[0] === 1, "quantize12 clamps to [-1, 1]");
}

// ---- resampling ----
{
  const x = new Float32Array(44100).fill(0.5);
  const y = DSP.resampleLinear(x, 44100, 26040);
  ok(Math.abs(y.length - 26040) < 2, "resample 44.1k -> 26.04k length");
  const z = DSP.resampleLinear(x, 44100, 44100);
  ok(z.length === 44100 && z[100] === 0.5, "resample to same rate copies");
}

// ---- normalize ----
{
  const x = new Float32Array([0.1, -0.5, 0.25]);
  DSP.normalize(x, 0.92);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  ok(Math.abs(peak - 0.92) < 1e-6, "normalize hits the target peak");
}

// ---- swing ----
{
  const d = DSP.sixteenthDur(120);
  ok(Math.abs(d - 0.125) < 1e-9, "16th at 120bpm = 125ms");
  ok(Math.abs(DSP.stepTime16(1, 120, 50) - d) < 1e-9, "50% swing is straight");
  ok(Math.abs(DSP.stepTime16(1, 120, 75) - 1.5 * d) < 1e-9, "75% swing is a full triplet lope");
  ok(DSP.stepTime16(0, 120, 62) === 0, "even 16ths stay on the grid");
  ok(DSP.stepTime16(3, 120, 62) > DSP.stepTime16(1, 120, 62), "later odd 16ths stay ordered");
}

// ---- sample editor ops ----
{
  const x = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const t = DSP.trimSample(x, 0.25, 0.75);
  ok(t.length === 4 && t[0] === 2 && t[3] === 5, "trim keeps the selected region");
  const tf = DSP.trimSample(x, 0, 1);
  ok(tf.length === 8, "trim of the full range is a no-op");
  ok(x.length === 8 && x[0] === 0, "trim does not mutate the input");
  const te = DSP.trimSample(x, 0.9, 1.2);
  ok(te.length >= 1 && te[te.length - 1] === 7, "trim clamps fractions to the buffer");
}
{
  const r = DSP.reverseSample(new Float32Array([1, 2, 3]));
  ok(r[0] === 3 && r[2] === 1, "reverse flips the sample");
}
{
  const f = DSP.fadeSample(new Float32Array(100).fill(1), 0.1, 0.1);
  ok(f[0] === 0 && f[99] === 0, "fades start and end at zero");
  ok(f[50] === 1, "fade leaves the middle untouched");
  let mono = true;
  for (let i = 1; i < 10; i++) if (!(f[i] >= f[i - 1])) mono = false;
  ok(mono, "fade-in ramps monotonically");
  const g = DSP.fadeSample(new Float32Array(100).fill(1), 0, 0);
  ok(g[0] === 1 && g[99] === 1, "zero-length fades are a no-op");
}

console.log("\ndsp: " + n + " passed");
