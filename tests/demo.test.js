// SP-1200 demo-scene UI tests: DOM-stubbed end-to-end run of demo.js in node.
// Stubs canvas/document/AudioContext, captures the keydown handler, and
// drives the lookahead scheduler with a fake clock.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const pub = path.join(__dirname, "..", "public");

let n = 0;
function ok(cond, msg) {
  n++;
  assert(cond, msg);
  console.log("ok " + n + " - " + msg);
}

// ---- canvas stub ----
function makeCtx() {
  return {
    textCalls: 0,
    fillRect: function () {}, strokeRect: function () {},
    fillText: function () { this.textCalls++; },
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    stroke: function () {}, fill: function () {},
    createLinearGradient: function () { return { addColorStop: function () {} }; },
    fillStyle: "", strokeStyle: "", font: "", textAlign: "",
    lineWidth: 1, globalAlpha: 1, imageSmoothingEnabled: true,
  };
}

// ---- AudioContext stub with a fake clock ----
function FakeAC() {
  FakeAC.instances.push(this);
  this.state = "running";
  this.currentTime = 0;
  this.destination = {};
  this.buffers = [];
  this.starts = []; // {pad, when}
}
FakeAC.instances = [];
FakeAC.prototype.createBuffer = function (ch, len, rate) {
  const b = { sampleRate: rate, _pad: this.buffers.length, getChannelData: function () { return new Float32Array(len); } };
  this.buffers.push(b);
  return b;
};
FakeAC.prototype.createBufferSource = function () {
  const ac = this;
  const s = { buffer: null, connect: function () {}, disconnect: function () {} };
  s.start = function (when) { ac.starts.push({ pad: s.buffer ? s.buffer._pad : -1, when: when == null ? 0 : when }); };
  return s;
};
FakeAC.prototype.createGain = function () {
  return { gain: { value: 0 }, connect: function () {}, disconnect: function () {} };
};
FakeAC.prototype.resume = function () {};

function boot() {
  const listeners = {};
  const ctx = makeCtx();
  const canvas = { width: 480, height: 270, getContext: function () { return ctx; } };
  const store = {};
  const st = {
    raf: null, tick: null, keydown: null, ac: null, ctx: ctx, store: store,
  };
  const sandbox = {
    console: console,
    document: {
      getElementById: function (id) { return id === "screen" ? canvas : null; },
      addEventListener: function (t, f) { listeners[t] = f; },
    },
    window: null, // set below
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
    },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function (cb) { st.tick = cb; return 1; },
    clearInterval: function () { st.tick = null; },
    requestAnimationFrame: function (cb) { st.raf = cb; },
  };
  sandbox.window = {
    AudioContext: FakeAC,
    matchMedia: function () { return { matches: false }; },
    DSP: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(pub, "dsp.js"), "utf8"), sandbox, { filename: "dsp.js" });
  sandbox.window.DSP = sandbox.DSP;
  vm.runInContext(fs.readFileSync(path.join(pub, "demo.js"), "utf8"), sandbox, { filename: "demo.js" });
  st.keydown = listeners.keydown;
  st.ac = function () { return FakeAC.instances[FakeAC.instances.length - 1]; };
  st.key = function (k) { st.keydown({ key: k, preventDefault: function () {} }); };
  st.frame = function (ts) { st.raf(ts); };
  return st;
}

// ---- boot + splash ----
let st = boot();
ok(typeof st.keydown === "function", "keydown handler registered");
st.frame(1000);
ok(st.ctx.textCalls > 10, "renderer draws text on the first frame (no-throw gate)");
ok(FakeAC.instances.length === 0, "no AudioContext before the first keypress");
st.key("x"); // dismiss splash -> boots audio
ok(st.ac().buffers.length === 8, "first keypress builds the 8 pad buffers");
ok(st.ac().buffers.every(function (b) { return b.sampleRate === 26040; }), "pads render through the 26.04 kHz SP path");

// ---- live pad triggering ----
st.key("a"); st.key(";"); 
ok(st.ac().starts.length === 2, "pad keys fire live hits");
ok(st.ac().starts[0].pad === 0 && st.ac().starts[1].pad === 7, "A -> kick, ; -> shaker");

// ---- preset + transport: a full bar of BOOM BAP ----
st = boot();
st.key("x");
st.key("1");
st.ac().currentTime = 1.0;
st.key(" "); // play; barStart = 1.08
ok(typeof st.tick === "function", "space starts the lookahead scheduler");
const d = 60 / 96 / 4;
for (let t = 1.0; t < 1.08 + 16 * d + 0.3; t += 0.04) { st.ac().currentTime = t; st.tick(); }
const barEnd = 1.08 + 16 * d;
const counts = [0, 0, 0, 0, 0, 0, 0, 0];
st.ac().starts.forEach(function (s) { if (s.when < barEnd) counts[s.pad]++; });
ok(counts[0] === 3, "kick fires 3x per bar (got " + counts[0] + ")");
ok(counts[1] === 2, "snare fires 2x per bar (got " + counts[1] + ")");
ok(counts[2] === 1 && counts[3] === 2, "clap 1x, rim 2x per bar");
ok(counts[4] === 9, "hat fires 9x per bar (got " + counts[4] + ")");
ok(counts[5] === 1 && counts[6] === 0 && counts[7] === 5, "ohat 1x, tom 0x, shaker 5x per bar");

// ---- swing is wired through the scheduler ----
const shakerTimes = st.ac().starts.filter(function (s) { return s.pad === 7 && s.when < barEnd; }).map(function (s) { return s.when; }).sort(function (a, b) { return a - b; });
const gaps = [];
for (let i = 1; i < shakerTimes.length; i++) gaps.push(shakerTimes[i] - shakerTimes[i - 1]);
const exp = [3.12 * d, 2.88 * d, 3.12 * d, 2.88 * d]; // 56% swing: odd steps late
const swingOk = gaps.length === 4 && gaps.every(function (g, i) { return Math.abs(g - exp[i]) < 0.02; });
ok(swingOk, "shaker gaps follow 56% swing (got " + gaps.map(function (g) { return g.toFixed(3); }).join(",") + ")");

// ---- mute ----
st = boot();
st.key("x");
st.key("1");
st.key("m"); // cursor sits on pad 0 -> kick muted (after preset, which resets mutes)
st.ac().currentTime = 1.0;
st.key(" ");
for (let t = 1.0; t < 1.08 + 16 * d + 0.3; t += 0.04) { st.ac().currentTime = t; st.tick(); }
const c2 = [0, 0, 0, 0, 0, 0, 0, 0];
st.ac().starts.forEach(function (s) { if (s.when < barEnd) c2[s.pad]++; });
ok(c2[0] === 0 && c2[1] === 2, "M mutes the kick row, snare still fires");

// ---- step toggle + persistence ----
st = boot();
st.key("x");
st.key("Enter"); // toggle (0,0)
ok(Object.prototype.hasOwnProperty.call(st.store, "sp1200-demo"), "edits persist to localStorage");
st.ac().currentTime = 1.0;
st.key(" ");
for (let t = 1.0; t < 1.08 + 16 * d + 0.3; t += 0.04) { st.ac().currentTime = t; st.tick(); }
ok(st.ac().starts.filter(function (s) { return s.pad === 0 && s.when < barEnd; }).length === 1, "toggled step fires once per bar");

// ---- help overlay renders without throwing ----
st = boot();
st.key("x");
st.key("h");
st.frame(2000);
ok(true, "help overlay frame renders");
st.key("Escape");
st.frame(2100);
ok(true, "help overlay closes");

console.log("# " + n + " demo tests passed");
