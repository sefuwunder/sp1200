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
function makeParam() {
  return {
    value: 0,
    setTargetAtTime: function (v) { this.value = v; },
    setValueAtTime: function (v) { this.value = v; },
    cancelScheduledValues: function () {},
  };
}
FakeAC.prototype.createBufferSource = function () {
  const s = makeNode();
  s.buffer = null;
  s.playbackRate = { value: 1 };
  s.start = function () {};
  s.stop = function (t) { this.stopped = true; this.stopAt = t; };
  s.stopped = false;
  s.onended = null;
  this.lastSource = s;
  return s;
};
FakeAC.prototype.createGain = function () {
  const g = makeNode();
  g.gain = makeParam();
  return g;
};
FakeAC.prototype.createDelay = function (max) {
  const d = makeNode();
  d.delayTime = makeParam();
  d.maxDelayTime = max || 1;
  this.lastDelay = d;
  return d;
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

// ---- OfflineAudioContext stub ----
function FakeOAC(channels, length, sampleRate) {
  FakeAC.call(this);
  this.numberOfChannels = channels;
  this._renderLength = length;
  this.sampleRate = sampleRate;
  this.sources = [];
}
FakeOAC.prototype = Object.create(FakeAC.prototype);
FakeOAC.prototype.constructor = FakeOAC;
FakeOAC.prototype.createBufferSource = function () {
  const s = FakeAC.prototype.createBufferSource.call(this);
  const self = this;
  s._loopFlag = false;
  const rawStart = s.start;
  s.start = function (t) {
    self.sources.push({ src: s, at: t == null ? 0 : t, loop: s._loopFlag });
    rawStart.call(s, t);
  };
  Object.defineProperty(s, "loop", {
    get: function () { return s._loopFlag; },
    set: function (v) { s._loopFlag = !!v; },
    configurable: true,
  });
  return s;
};
FakeOAC.prototype.startRendering = function () {
  const len = this._renderLength, sr = this.sampleRate, ch = this.numberOfChannels;
  const buf = {
    sampleRate: sr,
    length: len,
    duration: len / sr,
    numberOfChannels: ch,
    getChannelData: function () { return new Float32Array(len); },
  };
  return Promise.resolve(buf);
};

// ---- sandbox ----
const dlCapture = {};
const sandbox = {
  console: console,
  document: documentStub,
  window: { AudioContext: FakeAC, OfflineAudioContext: FakeOAC },
  Blob: function (parts, opts) { dlCapture.parts = parts; dlCapture.type = opts && opts.type; },
  URL: {
    createObjectURL: function () { dlCapture.urlMade = true; return "blob:fake"; },
    revokeObjectURL: function () {},
  },
  FileReader: function () {
    this.readAsText = function (f) {
      this.result = f._text;
      if (this.onload) this.onload();
    };
  },
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

// single-audio preview: a new audition cuts off the previous one
const firstAud = ac().lastSource;
SP._auditionSegment(2);
ok(firstAud.stopped, "auditioning a second segment stops the first (no clashing previews)");
ok(ac().lastSource !== firstAud, "the new audition is the live source");
SP._auditionSegment(1);  // restore the selection the chop-load test expects

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


// ---- voice modes: choke groups + mono/poly ----
SP.state.pads.forEach(function (p) { p._voices = []; });  // clear voices from earlier tests
ok(SP.state.pads[4].choke === 1 && SP.state.pads[5].choke === 1, "HAT and OPEN HAT ship in choke group A");
ok(SP.state.pads[0].choke === 0, "other pads ship with no choke group");
ok(ui.padChoke4.textContent === "CHK A", "choke strip button labels the default group");
ok(ui.padMode0.textContent === "POLY", "voice mode button shows POLY by default");

SP._playPad(5);  // open hat ringing
const ohatSrc = ac().lastSource;
ok(SP.state.pads[5]._voices.length === 1, "open hat voice is tracked");
SP._playPad(4);  // closed hat chokes it
ok(ohatSrc.stopped, "closed hat hit stops the open hat voice (choke group A)");
ok(SP.state.pads[5]._voices.length === 0, "choked pad voice list is cleared");
ok(SP.state.pads[4]._voices.length === 1, "choking pad keeps its own voice");

ui.padMode0.click();  // kick -> mono
ok(SP.state.pads[0].voiceMode === "mono", "MODE button switches the kick to mono");
ok(ui.padMode0.textContent === "MONO", "MODE button labels MONO");
SP._playPad(0);
const kickSrc1 = ac().lastSource;
SP._playPad(0);
ok(kickSrc1.stopped, "second hit in mono kills the first voice");
ok(SP.state.pads[0]._voices.length === 1, "mono keeps a single live voice");

SP._playPad(1);  // snare stays poly
const snareSrc1 = ac().lastSource;
SP._playPad(1);
ok(!snareSrc1.stopped, "poly pad lets voices overlap");
ok(SP.state.pads[1]._voices.length === 2, "poly tracks both live voices");

ui.padChoke0.click();
ok(SP.state.pads[0].choke === 1 && ui.padChoke0.textContent === "CHK A", "CHOKE cycles to group A");
ui.padChoke0.click(); ui.padChoke0.click();
ok(SP.state.pads[0].choke === 3 && ui.padChoke0.textContent === "CHK C", "CHOKE cycles to group C");
ui.padChoke0.click();
ok(SP.state.pads[0].choke === 0 && ui.padChoke0.textContent === "CHK OFF", "CHOKE wraps back to off");

// ---- per-pad delay ----
ok(!SP.state.pads[2]._delay, "no delay nodes before the effect is ever enabled");
SP._openEditor(2);
const ved = SP._editor();
ok(ved.dOn.textContent === "OFF", "delay toggle ships off");
ved.dOn.click();
ok(SP.state.pads[2].delay.on, "delay toggle enables the effect");
ok(ved.dOn.textContent === "ON", "delay toggle labels ON");
ok(SP.state.pads[2]._delay, "enabling delay creates the per-pad nodes");
const vdl = SP.state.pads[2]._delay;
ok(Math.abs(vdl.node.delayTime.value - 0.32) < 1e-9, "delay time synced from pad settings");
ok(Math.abs(vdl.fb.gain.value - 0.35) < 1e-9, "delay feedback synced from pad settings");
ok(Math.abs(vdl.wet.gain.value - 0.3) < 1e-9, "delay mix synced from pad settings");
SP._playPad(2);
ok(SP.state.pads[2]._delay === vdl, "delay nodes are reused across hits");
ved.dTime.input.value = "50";
ved.dTime.input._handlers.input[0]();
ok(Math.abs(SP.state.pads[2].delay.time - 0.5) < 1e-9, "TIME slider sets delay time");
ok(Math.abs(vdl.node.delayTime.value - 0.5) < 1e-9, "delay time re-syncs live");
ved.dOn.click();
ok(!SP.state.pads[2].delay.on && ved.dOn.textContent === "OFF", "delay toggle disables the effect");
ok(Math.abs(vdl.wet.gain.value - 0) < 1e-9, "wet gain drops to zero when delay is off");
SP._closeEditor();

// ---- voice + delay persist ----
const vsaved = JSON.parse(sandbox.localStorage.getItem("sp1200"));
ok(vsaved.pads[0].voiceMode === "mono", "mono mode persists to localStorage");
ok(vsaved.pads[4].choke === 1, "choke group persists to localStorage");
ok(vsaved.pads[2].delay.on === false, "delay disable persists to localStorage");
ok(Math.abs(vsaved.pads[2].delay.time - 0.5) < 1e-9, "delay time persists to localStorage");

// ---- tape: bounce + 4-track arranger (async) ----
(async function () {
  ok(SP.state.tapes.length === 4, "four tape tracks exist");
  ok(SP.state.tapes.every(function (t) { return !t.buffer; }), "tracks ship empty");
  ok(typeof ui.tapeBtn !== "undefined" && ui.tapeBtn.textContent === "TAPE", "transport has a TAPE button");

  // deterministic pattern: kick on steps 0 and 1, swing 75, 120 BPM
  SP.state.pattern.forEach(function (row) { row.fill(0); });
  SP.state.pattern[0][0] = 1;
  SP.state.pattern[0][1] = 1;
  SP.state.bpm = 120;
  SP.state.swing = 75;
  SP.state.pads[0].voiceMode = "poly";
  SP.state.pads[0].choke = 0;
  SP.state.pads[0].muted = false;

  const buf = await SP._renderPattern(1);
  const d = 60 / 120 / 4; // 0.125s per 16th
  ok(buf.length === Math.ceil(16 * d * 44100), "bounce buffer length matches 1 bar at 44.1kHz");
  ok(buf.numberOfChannels === 2, "bounce renders stereo");
  const ocx = FakeAC.instances[FakeAC.instances.length - 1];
  const hits = ocx.sources.map(function (r) { return r.at; }).sort(function (a, b) { return a - b; });
  // step 0 on the grid, step 1 (odd 16th) slid late by swing 75: 0.75 * 2 * d
  ok(hits.length === 2, "two scheduled hits in the bounce");
  ok(Math.abs(hits[0] - 0) < 1e-9, "even 16th stays on the grid in the bounce");
  ok(Math.abs(hits[1] - 0.75 * 2 * d) < 1e-9, "odd 16th slides late with swing in the bounce");

  // parity with the live scheduler: scheduleStep uses
  // t = gridTime + (stepTime16(s) - s*d) with gridTime = b*barDur + s*d,
  // which collapses to b*barDur + stepTime16(s) — exactly the bounce formula
  ok(Math.abs(hits[1] - sandbox.DSP.stepTime16(1, 120, 75)) < 1e-9, "bounce timing matches scheduleStep swing math");

  // 2-bar bounce doubles the hits
  const buf2 = await SP._renderPattern(2);
  const ocx2 = FakeAC.instances[FakeAC.instances.length - 1];
  ok(ocx2.sources.length === 4, "2-bar bounce schedules both bars");
  ok(buf2.length === 2 * buf.length, "2-bar buffer is twice as long");

  // arranger UI
  ui.tapeBtn.click();
  const tp = SP._tape();
  ok(tp.root.style.display === "flex", "TAPE button opens the arranger");
  ok(tp.rows.length === 4, "arranger shows four tracks");
  ok(tp.barsBtn.textContent === "BARS 2", "bounce length defaults to 2 bars");
  tp.barsBtn.click();
  ok(tp.barsBtn.textContent === "BARS 4", "BARS cycles 2 -> 4");
  tp.barsBtn.click();
  ok(tp.barsBtn.textContent === "BARS 1", "BARS cycles 4 -> 1");
  tp.barsBtn.click();
  ok(tp.barsBtn.textContent === "BARS 2", "BARS cycles 1 -> 2");

  // bounce track 1 -> auto-loops
  SP._bounceToTape(0);
  ok(SP.state.tapes[0].bouncing, "track shows bouncing state");
  await new Promise(function (r) { setTimeout(r, 20); });
  const t0 = SP.state.tapes[0];
  ok(!t0.bouncing && !!t0.buffer, "bounce lands a buffer on the track");
  ok(t0.bars === 2 && t0.bpm === 120, "track records bars + bpm");
  ok(!!t0._src, "bounced track auto-plays its loop");
  ok(t0._src.loop === true, "tape playback source loops");
  ok(tp.rows[0].root.classList.contains("playing"), "playing track is highlighted");
  ok(/2 bars/.test(tp.rows[0].status.textContent), "track status shows the bounce");

  // mute + level
  tp.rows[0].muteBtn.click();
  ok(t0.muted, "MUTE toggles the track");
  ok(Math.abs(t0._gain.gain.value - 0) < 1e-9, "mute ducks the track gain");
  tp.rows[0].muteBtn.click();
  ok(!t0.muted && Math.abs(t0._gain.gain.value - t0.level) < 1e-9, "unmute restores the track gain");
  tp.rows[0].level.input.value = "50";
  tp.rows[0].level.input._handlers.input[0]();
  ok(Math.abs(t0.level - 0.5) < 1e-9, "LEVEL slider sets the track level");

  // second track, then global stop
  SP._bounceToTape(1);
  await new Promise(function (r) { setTimeout(r, 20); });
  ok(!!SP.state.tapes[1]._src, "second track loops too");
  SP._tapeStopAll();
  ok(!SP.state.tapes[0]._src && !SP.state.tapes[1]._src, "STOP halts all tracks");

  // -> slicer glue
  SP._tapeToSlicer(0);
  ok(tp.root.style.display === "none", "send-to-slicer closes the arranger");
  ok(SP._slicer().root.style.display === "flex", "send-to-slicer opens the slicer");
  ok(SP._slicer().tape && SP._slicer().tape.length === t0.buffer.length, "bounced audio lands in the slicer");
  SP._closeSlicer();

  // clear
  ui.tapeBtn.click();
  tp.rows[0].clearBtn.click();
  ok(!SP.state.tapes[0].buffer, "CLEAR empties the track");
  ok(tp.rows[0].status.textContent === "EMPTY", "cleared track reads EMPTY");

  // Escape closes
  listeners.keydown({ code: "Escape", target: {} });
  ok(tp.root.style.display === "none", "Escape closes the arranger");

  // ---- global transport + panic ----
  ok(ui.panicBtn.textContent === "PANIC", "transport has a PANIC button");
  SP._bounceToTape(2);
  await new Promise(function (r) { setTimeout(r, 60); });
  ok(!!(SP.state.tapes[2] && SP.state.tapes[2].buffer), "track 3 holds a bounce for the global test");
  SP._tapeStopAll();
  ui.playBtn.click();
  ok(SP.state.playing, "main play starts the drum sequencer");
  ok(!!SP.state.tapes[2]._src, "main play also starts the tape tracks");
  ok(ui.playBtn.textContent === "\u25a0", "main button shows stop while anything plays");
  ui.playBtn.click();
  ok(!SP.state.playing && !SP.state.tapes[2]._src, "main stop halts drums + tape");
  ok(ui.playBtn.textContent === "\u25b6", "main button back to play when all is stopped");
  SP._tapePlay(2);
  ok(ui.playBtn.textContent === "\u25a0", "tape-only playback lights the main button too");
  SP._tapeStopAll();
  SP.state.pads[0].delay.on = true;
  var v0 = SP.state.pads[0]._voices.length, v1 = SP.state.pads[1]._voices.length;
  SP._playPad(0);
  SP._playPad(1);
  ok(SP.state.pads[0]._voices.length === v0 + 1 && SP.state.pads[1]._voices.length === v1 + 1, "voices ringing before panic");
  const dly = SP.state.pads[0]._delay;
  ok(!!dly, "delay nodes exist before panic");
  SP._globalPlay();
  ok(SP.state.playing && SP._anyTapePlaying(), "drums + tape running before panic");
  SP._panic();
  ok(!SP.state.playing, "panic stops the sequencer");
  ok(!SP._anyTapePlaying(), "panic stops the tapes");
  ok(SP.state.pads[0]._voices.length === 0 && SP.state.pads[1]._voices.length === 0, "panic clears every pad voice");
  ok(dly.wet.gain.value === 0 && dly.fb.gain.value === 0, "panic chokes the delay lines");
  ok(ui.playBtn.textContent === "\u25b6", "panic resets the main button");
  SP._playPad(0);
  ok(Math.abs(SP.state.pads[0]._delay.wet.gain.value - SP.state.pads[0].delay.mix) < 1e-9, "delay restores itself on the next hit");
  SP.state.pads[0].delay.on = false;

  // ---- projects: save / load ----
  ok(ui.projBtn.textContent === "PROJECT", "transport has a PROJECT button");
  ok(ui.projPanel.style.display === "none", "project panel starts hidden");
  ui.projBtn.click();
  ok(ui.projPanel.style.display === "flex", "PROJECT opens the panel");
  listeners.keydown({ code: "Escape", target: {} });
  ok(ui.projPanel.style.display === "none", "Escape closes the project panel");

  // pcm16 base64 round-trip
  const rt = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123456, -0.987654]);
  const rtBack = SP._pcm16B64ToF32(SP._f32ToPcm16B64(rt));
  ok(rtBack.length === rt.length, "pcm16 base64 round-trips the length");
  ok(Array.from(rtBack).every(function (v, i) { return Math.abs(v - rt[i]) < 1 / 32767; }), "pcm16 base64 round-trips the samples");

  // distinctive project state
  SP.state.bpm = 100; SP.state.swing = 70; SP.state.master = 64; SP.state.spMode = false;
  SP.state.pattern.forEach(function (row) { row.fill(0); });
  SP.state.pattern[3][5] = 1; SP.state.pattern[7][15] = 1;
  const sp0 = SP.state.pads[0];
  sp0.tune = 1.5; sp0.level = 0.4; sp0.muted = true;
  sp0.filterType = "lowpass"; sp0.filterFreq = 800; sp0.filterQ = 2;
  sp0.voiceMode = "mono"; sp0.choke = 2;
  sp0.delay.on = true; sp0.delay.time = 0.5; sp0.delay.feedback = 0.6; sp0.delay.mix = 0.45;
  const sp1 = SP.state.pads[1];
  sp1.dataClean = new Float32Array([0.1, -0.2, 0.3, -0.4, 0.5]);
  sp1.customName = "MYSMPL";
  SP._bounceToTape(0);
  await new Promise(function (r) { setTimeout(r, 60); });
  ok(!!(SP.state.tapes[0] && SP.state.tapes[0].buffer), "track 1 has audio before the project save");
  const tapeLen = SP.state.tapes[0].buffer.length;
  SP._saveProject("projtest");
  ok(!!SP._listProjects().projtest, "saved project appears in the index");
  ok(ui.projStatus.textContent.indexOf("projtest") >= 0, "save reports its status");

  // mutate everything, then load
  SP.state.bpm = 60; SP.state.swing = 50; SP.state.master = 80; SP.state.spMode = true;
  SP.state.pattern.forEach(function (row) { row.fill(0); });
  sp0.tune = 1; sp0.muted = false; sp0.filterType = "off"; sp0.voiceMode = "poly"; sp0.delay.on = false;
  sp1.dataClean = new Float32Array([0]); sp1.customName = null;
  SP._tapeStopAll();
  SP.state.tapes[0].buffer = null;
  SP._loadProject("projtest");
  ok(SP.state.bpm === 100, "project load restores bpm");
  ok(SP.state.swing === 70 && SP.state.master === 64 && SP.state.spMode === false, "project load restores transport scalars");
  ok(SP.state.pattern[3][5] === 1 && SP.state.pattern[7][15] === 1 && SP.state.pattern[0][0] === 0, "project load restores the pattern");
  const q0 = SP.state.pads[0];
  ok(Math.abs(q0.tune - 1.5) < 1e-9 && q0.muted === true && q0.filterType === "lowpass" &&
     q0.filterFreq === 800 && q0.filterQ === 2, "project load restores pad strip settings");
  ok(q0.voiceMode === "mono" && q0.choke === 2, "project load restores voice mode + choke");
  ok(q0.delay.on === true && Math.abs(q0.delay.time - 0.5) < 1e-9 &&
     Math.abs(q0.delay.feedback - 0.6) < 1e-9 && Math.abs(q0.delay.mix - 0.45) < 1e-9, "project load restores delay settings");
  const q1 = SP.state.pads[1];
  ok(q1.customName === "MYSMPL", "project load restores the custom sample name");
  ok(q1.dataClean.length === 5 && Math.abs(q1.dataClean[4] - 0.5) < 1 / 32767, "project load restores custom sample data");
  ok(!!q1.dataSP && q1.dataSP.length > 0, "project load re-runs the SP conversion on the custom sample");
  const qt = SP.state.tapes[0];
  ok(!!(qt.buffer && qt.buffer.getChannelData(0).length === tapeLen), "project load restores tape audio");
  // UI follows the loaded state
  ok(ui.stepBtns[3][5].classList.contains("on") && ui.stepBtns[7][15].classList.contains("on"), "loaded pattern shows on the grid");
  ok(!ui.stepBtns[0][0].classList.contains("on"), "cleared steps stay off on the grid");
  ok(ui.padNames[1].textContent === "MYSMPL", "loaded custom name shows on the strip");
  ok(ui.padNames[0].textContent === SP.state.pads[0].def.name, "built-in pad name restores on the strip");

  // loading silences playback
  SP._playPad(0);
  SP._tapePlay(0);
  ok(SP._anyTapePlaying(), "tape playing before the load-silence check");
  SP._loadProject("projtest");
  ok(!SP._anyTapePlaying(), "project load stops tape playback");
  ok(SP.state.pads[0]._voices.length === 0, "project load clears pad voices");

  // list + delete
  SP._saveProject("second");
  ok(!!SP._listProjects().projtest && !!SP._listProjects().second, "index lists both saves");
  ui.projList.children.length = 0; // stub: innerHTML="" doesn't drop stub children
  SP._paintProjects();
  ok(ui.projList.children.length === 2, "panel lists two projects");
  SP._deleteProject("second");
  ok(!SP._listProjects().second && !!SP._listProjects().projtest, "delete removes one project");
  ui.projList.children.length = 0;
  SP._paintProjects();
  ok(ui.projList.children.length === 1, "panel list updates after delete");
  SP._deleteProject("projtest");
  ok(Object.keys(SP._listProjects()).length === 0, "index empty after cleanup");

  // ---- external save / load: project files ----
  ok(SP._projectFileName("My Beat!") === "my-beat.sp1200.json", "export filename is sanitized");
  ok(SP._projectFileName("") === "untitled.sp1200.json", "empty name falls back to untitled");
  // rebuild a distinctive state to export
  SP.state.bpm = 97;
  SP.state.pattern.forEach(function (row) { row.fill(0); });
  SP.state.pattern[2][7] = 1;
  ui.projName.value = "My Beat!";
  SP._exportProject();
  ok(dlCapture.urlMade === true, "export creates a download");
  ok(dlCapture.type === "application/json", "export is typed as JSON");
  const exported = JSON.parse(dlCapture.parts[0]);
  ok(exported.name === "My Beat!" && exported.version === 1, "exported payload carries name + version");
  ok(exported.bpm === 97 && exported.pattern[2][7] === 1, "exported payload carries the project state");
  ok(ui.projStatus.textContent.indexOf("Exported") >= 0, "export reports its status");
  // mutate, then import the file back
  SP.state.bpm = 60;
  SP.state.pattern.forEach(function (row) { row.fill(0); });
  SP._importProjectFile({ _text: dlCapture.parts[0], name: "my-beat.sp1200.json" });
  ok(SP.state.bpm === 97, "import restores bpm from the file");
  ok(SP.state.pattern[2][7] === 1 && SP.state.pattern[0][0] === 0, "import restores the pattern from the file");
  ok(ui.stepBtns[2][7].classList.contains("on"), "imported pattern shows on the grid");
  ok(!!SP._listProjects()["My Beat!"], "imported project joins the saved list");
  ok(ui.projStatus.textContent.indexOf("Imported") >= 0, "import reports its status");
  // corrupt file
  SP._importProjectFile({ _text: "{nope", name: "bad.json" });
  ok(ui.projStatus.textContent.indexOf("not a valid project file") >= 0, "corrupt import is rejected cleanly");
  ok(SP.state.bpm === 97, "failed import leaves state untouched");
  // IMPORT button opens the file picker
  var pickerOpened = false;
  ui.projFile.click = function () { pickerOpened = true; };
  var xrow = ui.projPanel.children.filter(function (c) { return c.className === "proj-row"; })[1];
  var impBtn = xrow.children.filter(function (c) { return c.textContent === "IMPORT"; })[0];
  ok(!!impBtn, "IMPORT button exists in the panel");
  impBtn.click();
  ok(pickerOpened, "IMPORT opens the file picker");
  SP._deleteProject("My Beat!");
  ok(Object.keys(SP._listProjects()).length === 0, "index empty at the end");

  console.log("\nui: " + n + " passed");
})().catch(function (e) { console.error("TAPE TESTS FAILED:", e); process.exit(1); });
