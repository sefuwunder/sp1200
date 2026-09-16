// SP-1200 UI tests: DOM-stubbed end-to-end render of app.js in node.
// Stubs document/localStorage/AudioContext, evals dsp.js + app.js,
// and asserts the view renders and the pad/filter/editor logic works.
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

// ---- DOM stub ----
function makeClassList() {
  const s = new Set();
  return {
    add: function (c) { s.add(c); },
    remove: function (c) { s.delete(c); },
    toggle: function (c, force) {
      if (force === undefined) { if (s.has(c)) s.delete(c); else s.add(c); }
      else if (force) s.add(c); else s.delete(c);
    },
    contains: function (c) { return s.has(c); },
  };
}
function makeEl(tag) {
  const e = {
    tagName: (tag || "div").toUpperCase(),
    children: [],
    classList: makeClassList(),
    style: {},
    textContent: "",
    innerHTML: "",
    value: "",
    width: 0,
    height: 0,
    _handlers: {},
    appendChild: function (c) { this.children.push(c); return c; },
    addEventListener: function (t, f) { (this._handlers[t] = this._handlers[t] || []).push(f); },
    removeEventListener: function () {},
    setAttribute: function (k, v) { this["attr_" + k] = v; },
    getAttribute: function (k) { return this["attr_" + k]; },
    click: function () {
      (this._handlers.click || []).forEach(function (f) { f({ preventDefault: function () {} }); });
    },
    querySelector: function () { return null; },
  };
  return e;
}
const listeners = {};
const documentStub = {
  createElement: function (t) { return makeEl(t); },
  querySelector: function () { return null; },
  addEventListener: function (t, f) { listeners[t] = f; },
  body: makeEl("body"),
  readyState: "complete",
};

// ---- AudioContext stub ----
function makeNode() {
  return { connect: function () {}, disconnect: function () {} };
}
function FakeAC() {
  FakeAC.instances.push(this);
  this.state = "running";
  this.currentTime = 0;
  this.destination = {};
  this.lastSource = null;
  this.lastFilter = null;
}
FakeAC.instances = [];
FakeAC.prototype.createBuffer = function (ch, len, rate) {
  const b = {
    sampleRate: rate,
    _data: new Float32Array(len),
    copyToChannel: function (d) { this._data = Float32Array.from(d); },
    getChannelData: function () { return this._data; },
  };
  return b;
};
FakeAC.prototype.createBufferSource = function () {
  const s = makeNode();
  s.buffer = null;
  s.playbackRate = { value: 1 };
  s.start = function () {};
  this.lastSource = s;
  return s;
};
FakeAC.prototype.createGain = function () {
  const g = makeNode();
  g.gain = { value: 1 };
  return g;
};
FakeAC.prototype.createBiquadFilter = function () {
  const f = makeNode();
  f.type = "";
  f.frequency = { value: 0 };
  f.Q = { value: 0 };
  this.lastFilter = f;
  return f;
};
FakeAC.prototype.createDynamicsCompressor = function () {
  const c = makeNode();
  c.threshold = { value: 0 };
  c.ratio = { value: 0 };
  return c;
};
FakeAC.prototype.resume = function () {};

// ---- sandbox ----
const sandbox = {
  console: console,
  document: documentStub,
  window: { AudioContext: FakeAC },
  localStorage: {
    _d: {},
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem: function (k, v) { this._d[k] = String(v); },
    removeItem: function (k) { delete this._d[k]; },
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: function () { return 0; },
  clearInterval: function () {},
  fetch: function () { return Promise.reject(new Error("no network in tests")); },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(pub, "dsp.js"), "utf8"), sandbox, { filename: "dsp.js" });
vm.runInContext(fs.readFileSync(path.join(pub, "app.js"), "utf8"), sandbox, { filename: "app.js" });

const SP = sandbox.window.SP1200;
const ui = SP.ui;
function ac() { return FakeAC.instances[FakeAC.instances.length - 1]; }

ok(SP.PAD_DEFS.length === 8, "8 pads defined");
ok(ui.padBtns.length === 8, "8 pad strips rendered");
ok(ui.stepBtns.length === 8 && ui.stepBtns[0].length === 16, "8x16 step grid rendered");
ok(ui["padEdit0"] && ui["padFlt0"], "EDIT + FLT buttons on every strip");

// ---- transport + triggering ----
SP._playPad(0);
ok(ac().lastSource.buffer.sampleRate === 26040, "SP mode plays through the 26.04 kHz buffer");
ok(ac().lastSource.playbackRate.value === 1, "default tune is varispeed 1.0x");
ui.spBtn.click();
SP._playPad(0);
ok(ac().lastSource.buffer.sampleRate === 44100, "toggling SP off plays the clean buffer");
ui.spBtn.click();

// ---- per-pad filters ----
SP._playPad(1);
ok(!ac().lastFilter, "no filter node is created when the filter is off");
SP._setFilterType(1, "lowpass");
ok(ui.padFlt1.textContent === "FLT LP", "FLT button shows the LP type");
ok(ui.padFlt1.classList.contains("on"), "FLT button lights when the filter is active");
SP._playPad(1);
let f = ac().lastFilter;
ok(f && f.type === "lowpass", "lowpass filter inserted in the voice chain");
ok(f.frequency.value === 12000 && f.Q.value === 0.8, "filter uses the pad cutoff + resonance");
SP._cycleFilter(1);
ok(SP.state.pads[1].filterType === "bandpass", "FLT cycles LP -> BP");
ok(ui.padFlt1.textContent === "FLT BP", "FLT label follows the cycle");
SP._cycleFilter(1);
SP._cycleFilter(1);
ok(SP.state.pads[1].filterType === "off", "FLT cycles HP -> OFF");
ok(!ui.padFlt1.classList.contains("on"), "FLT button dark when the filter is off");
const saved = JSON.parse(sandbox.localStorage.getItem("sp1200"));
ok(saved.pads[1].filterType === "off", "filter type persists to localStorage");

// ---- mute still works ----
ui.padMute0.click();
ok(SP.state.pads[0].muted === true, "strip MUTE toggles the pad");
ui.padMute0.click();
ok(SP.state.pads[0].muted === false, "MUTE toggles back");

// ---- sample editor ----
SP._openEditor(2);
ok(ui.edOpenFor === 2, "editor opens for the tapped pad");
SP._closeEditor();
ok(ui.edOpenFor === -1, "editor closes");

// ---- edit round-trip through the SP path ----
const p = SP.state.pads[3];
p.dataClean = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7].map(function (v) { return v / 7; }));
p.dataClean = sandbox.DSP.trimSample(p.dataClean, 0.25, 0.75);
SP._refreshSample(3);
ok(p.dataClean.length === 4, "trimmed clean sample is kept");
ok(p.dataSP.length > 0 && p.dataSP.length < 8, "12-bit SP buffer re-derived from the edited sample");
ok(Object.prototype.toString.call(p.dataSP) === "[object Float32Array]", "re-derived SP buffer is a Float32Array");

// ---- sequencer still schedules ----
SP._scheduleStep(0, 0);
ok(true, "scheduleStep runs without throwing");



// ---- tape slicer ----
ok(ui.sliceBtn && ui.sliceBtn.textContent === "SLICE", "SLICE button in the transport bar");
SP._openSlicer();
let sl = SP._slicer();
ok(sl && sl.root.style.display === "flex", "slicer overlay opens");

function burstTape(sr, hits) {
  const x = new Float32Array(sr * 2);
  hits.forEach(function (at) {
    const start = Math.floor(at * sr);
    for (let i = 0; i < 3000 && start + i < x.length; i++) {
      x[start + i] += (Math.random() * 2 - 1) * 0.9 * Math.exp(-i / 800);
    }
  });
  return x;
}
const SR = 44100;
SP._slicerSetTape(burstTape(SR, [0.25, 0.75, 1.25, 1.75]), "testtape");
sl = SP._slicer();
ok(sl.tape.length === SR * 2, "synthetic tape installed at 44.1 kHz");
ok(sl.title.textContent.indexOf("TESTTAPE") >= 0, "slicer title names the tape");

sl.nInput.value = 4;
SP._slicerEqual();
let segs = SP._slicerSegments();
ok(segs.length === 4, "EQUAL chops the tape into 4 segments");
ok(Math.abs(segs[1].start - SR * 0.5) < 2 && Math.abs(segs[3].end - SR * 2) < 2, "equal segments tile the tape edge to edge");
ok(sl.chipBtns.length === 4, "one audition chip per segment");

SP._slicerAuto();
ok(sl.markers.length === 4, "AUTO detects the 4 drum hits (got " + sl.markers.length + ")");
segs = SP._slicerSegments();
ok(segs.length === 5, "4 transient markers make 5 segments");
ok(Math.abs(segs[2].start / SR - 0.75) < 0.05, "transient segment starts at the second hit");

SP._slicerSetTape(burstTape(SR, [0.5]), "clicktest");
sl = SP._slicer();
sl.canvas._handlers.pointerdown[0]({ clientX: 320, preventDefault: function () {} });
ok(sl.markers.length === 1 && Math.abs(sl.markers[0] - 0.5) < 0.01, "clicking the waveform drops a marker");
segs = SP._slicerSegments();
ok(segs.length === 2 && segs[0].end === segs[1].start, "one marker splits the tape in two");
sl.canvas._handlers.dblclick[0]({ clientX: 320 });
ok(sl.markers.length === 0, "double-clicking a marker removes it");

// unsorted markers still tile correctly
sl.markers = [0.75, 0.25];
segs = SP._slicerSegments();
ok(segs.length === 3 && segs[0].start === 0 && segs[2].end === SR * 2, "segments sort markers and span the tape");

// audition a segment
SP._slicerEqual();
SP._auditionSegment(1);
ok(ac().lastSource.buffer.sampleRate === 44100, "segment audition plays the clean 44.1 kHz buffer");
ok(ac().lastSource.buffer._data.length === SP._slicerSegments()[1].end - SP._slicerSegments()[1].start, "auditioned buffer matches the segment");

// load a segment onto a pad
const before = SP.state.pads[2].dataClean.length;
SP._sliceToPad(2);
const p2 = SP.state.pads[2];
ok(p2.customName === "SLC 2", "loaded chop is named after the selected segment");
ok(ui.padNames[2].textContent === "SLC 2", "pad strip label follows the chop");
ok(p2.dataClean.length !== before, "pad sample replaced by the segment");
ok(Object.prototype.toString.call(p2.dataSP) === "[object Float32Array]" && p2.dataSP.length > 0, "12-bit SP buffer re-derived for the chop");
ok(p2._undo && p2._undo.length === 1, "chop load is undoable in the editor");

SP._closeSlicer();
ok(SP._slicer().root.style.display === "none", "slicer closes");
SP._openSlicer();
listeners.keydown({ code: "Escape", target: {} });
ok(SP._slicer().root.style.display === "none", "Escape closes the slicer");


console.log("\nui: " + n + " passed");
