// SP-1200 drum machine UI + sequencer.
// DSP (synthesis, 12-bit/26.04kHz pipeline, swing) lives in dsp.js and is
// loaded before this file. Everything here is built with createElement so
// the whole view can be smoke-tested with DOM stubs.
(function () {
  "use strict";

  var DSP = (typeof window !== "undefined" && window.DSP) || globalThis.DSP;

  var PAD_DEFS = [
    { id: "kick", name: "KICK", key: "1" },
    { id: "snare", name: "SNARE", key: "2" },
    { id: "clap", name: "CLAP", key: "3" },
    { id: "rim", name: "RIM", key: "4" },
    { id: "chat", name: "HAT", key: "5" },
    { id: "ohat", name: "OPEN HAT", key: "6" },
    { id: "tom", name: "TOM", key: "7" },
    { id: "shaker", name: "SHAKER", key: "8" },
  ];
  var STEPS = 16;

  // steps are 0/1 arrays; index = pad order above
  var PRESETS = {
    "Boom Bap": {
      bpm: 92, swing: 62,
      steps: [
        [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
        [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      ],
    },
    "Trap": {
      bpm: 140, swing: 54,
      steps: [
        [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
        [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      ],
    },
    "House": {
      bpm: 122, swing: 50,
      steps: [
        [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
        [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
        [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      ],
    },
  };

  var state = {
    bpm: 92, swing: 62, master: 80, spMode: true, playing: false,
    pads: [],      // { def, dataSP, dataClean, tune, level, muted, customName }
    pattern: [],   // [padIdx][step] -> 0/1
  };

  var ui = {};      // element handles, filled by buildUI()
  var ctx = null, masterGain = null;

  var FILTER_TYPES = ["off", "lowpass", "bandpass", "highpass"];
  var FILTER_SHORT = { off: "OFF", lowpass: "LP", bandpass: "BP", highpass: "HP" };
  var FREQ_MIN = 80, FREQ_MAX = 12000;
  function freqToSlider(f) { return 100 * Math.log(f / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN); }
  function sliderToFreq(s) { return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, s / 100); }

  // ---------------- helpers ----------------
  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function save() {
    try {
      localStorage.setItem("sp1200", JSON.stringify({
        bpm: state.bpm, swing: state.swing, master: state.master, spMode: state.spMode,
        pattern: state.pattern,
        pads: state.pads.map(function (p) { return {
          tune: p.tune, level: p.level, muted: p.muted,
          filterType: p.filterType, filterFreq: p.filterFreq, filterQ: p.filterQ,
        }; }),
      }));
    } catch (e) { /* private mode etc. */ }
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem("sp1200") || "null");
      if (!s) return;
      if (s.bpm) state.bpm = clamp(s.bpm, 60, 200);
      if (s.swing) state.swing = clamp(s.swing, 50, 75);
      if (typeof s.master === "number") state.master = clamp(s.master, 0, 100);
      if (typeof s.spMode === "boolean") state.spMode = s.spMode;
      if (Array.isArray(s.pattern) && s.pattern.length === PAD_DEFS.length) state.pattern = s.pattern;
      (s.pads || []).forEach(function (ps, i) {
        if (!state.pads[i] || !ps) return;
        state.pads[i].tune = clamp(ps.tune || 1, 0.5, 2);
        state.pads[i].level = clamp(ps.level == null ? 0.9 : ps.level, 0, 1);
        state.pads[i].muted = !!ps.muted;
        if (ps.filterType && FILTER_TYPES.indexOf(ps.filterType) >= 0) state.pads[i].filterType = ps.filterType;
        if (typeof ps.filterFreq === "number") state.pads[i].filterFreq = clamp(ps.filterFreq, FREQ_MIN, FREQ_MAX);
        if (typeof ps.filterQ === "number") state.pads[i].filterQ = clamp(ps.filterQ, 0.5, 8);
      });
    } catch (e) { /* corrupted save */ }
  }

  // ---------------- audio ----------------
  function ensureAudio() {
    if (ctx) {
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      return ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = state.master / 100;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    masterGain.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  }

  // Trigger a pad. `when` is an AudioContext time; omit for "now".
  function playPad(idx, when) {
    var p = state.pads[idx];
    if (!p || p.muted) return;
    ensureAudio();
    var useSP = state.spMode;
    var data = useSP ? p.dataSP : p.dataClean;
    var rate = useSP ? DSP.SP_RATE : DSP.SYNTH_RATE;
    var buf = ctx.createBuffer(1, data.length, rate);
    buf.copyToChannel(data, 0);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = p.tune; // varispeed, exactly like the hardware
    var g = ctx.createGain();
    g.gain.value = p.level;
    if (p.filterType !== "off") {
      var flt = ctx.createBiquadFilter();
      flt.type = p.filterType; // lowpass | bandpass | highpass
      flt.frequency.value = p.filterFreq;
      flt.Q.value = p.filterQ;
      src.connect(flt);
      flt.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(masterGain);
    src.start(when == null ? 0 : when);
    flashPad(idx);
  }

  // ---------------- sequencer ----------------
  var timer = null, curStep = 0, nextGridTime = 0;
  var LOOKAHEAD = 0.12, TICK_MS = 25;

  function startTransport() {
    ensureAudio();
    if (state.playing) return;
    state.playing = true;
    curStep = 0;
    nextGridTime = ctx.currentTime + 0.08;
    timer = setInterval(schedulerTick, TICK_MS);
    ui.playBtn.classList.add("playing");
    ui.playBtn.textContent = "\u25a0"; // ■
    ui.playBtn.setAttribute("aria-label", "Stop");
  }
  function stopTransport() {
    if (!state.playing) return;
    state.playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    clearPlayhead();
    ui.playBtn.classList.remove("playing");
    ui.playBtn.textContent = "\u25b6"; // ▶
    ui.playBtn.setAttribute("aria-label", "Play");
  }
  function schedulerTick() {
    var d = DSP.sixteenthDur(state.bpm);
    while (nextGridTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(curStep, nextGridTime);
      curStep = (curStep + 1) % STEPS;
      nextGridTime += d;
    }
  }
  function scheduleStep(step, gridTime) {
    var d = DSP.sixteenthDur(state.bpm);
    // swing: odd 16ths slide late inside their pair
    var t = gridTime + (DSP.stepTime16(step, state.bpm, state.swing) - step * d);
    for (var i = 0; i < state.pads.length; i++) {
      if (state.pattern[i][step] && !state.pads[i].muted) playPad(i, t);
    }
    var ms = Math.max(0, (t - ctx.currentTime) * 1000);
    setTimeout(function () { if (state.playing) highlightStep(step); }, ms);
  }

  // ---------------- custom samples ----------------
  function loadSampleFile(padIdx, file) {
    ensureAudio();
    var rd = new FileReader();
    rd.onload = function () {
      var done = function (audioBuf) {
        var ch = audioBuf.getChannelData(0);
        var p = state.pads[padIdx];
        var sp = DSP.resampleLinear(ch, audioBuf.sampleRate, DSP.SP_RATE);
        DSP.normalize(sp, 0.92);
        p.dataSP = DSP.quantize12(sp);
        var clean = DSP.resampleLinear(ch, audioBuf.sampleRate, DSP.SYNTH_RATE);
        p.dataClean = DSP.normalize(clean, 0.92);
        p.customName = (file.name || "sample").replace(/\.\w+$/, "").slice(0, 12).toUpperCase();
        ui.padNames[padIdx].textContent = p.customName;
        p._undo = null;
        p.selStart = 0; p.selEnd = 1;
        if (ui.edOpenFor === padIdx) syncEditor();
        playPad(padIdx);
        save();
      };
      try {
        var r = ctx.decodeAudioData(rd.result);
        if (r && r.then) r.then(done, function () {});
        else ctx.decodeAudioData(rd.result, done, function () {});
      } catch (e) { /* unreadable file */ }
    };
    rd.readAsArrayBuffer(file);
  }
  function resetPad(padIdx) {
    var p = state.pads[padIdx];
    p.dataSP = DSP.SYNTHS[p.def.id]();
    p.dataClean = DSP.SYNTHS_RAW[p.def.id]();
    p.customName = null;
    p._undo = null;
    p.selStart = 0; p.selEnd = 1;
    setFilterType(padIdx, "off");
    p.filterFreq = FREQ_MAX; p.filterQ = 0.8;
    if (ui.edOpenFor === padIdx) syncEditor();
    ui.padNames[padIdx].textContent = p.def.name;
    save();
  }

  // ---------------- per-pad filters + sample editor ----------------
  function setFilterType(i, t) {
    var p = state.pads[i];
    if (!p) return;
    p.filterType = t;
    var b = ui["padFlt" + i];
    if (b) {
      b.textContent = "FLT " + FILTER_SHORT[t];
      b.classList.toggle("on", t !== "off");
    }
    if (ui.edOpenFor === i) paintFilterTypes();
  }
  function cycleFilter(i) {
    var p = state.pads[i];
    setFilterType(i, FILTER_TYPES[(FILTER_TYPES.indexOf(p.filterType) + 1) % FILTER_TYPES.length]);
    save();
  }

  // Re-derive the 12-bit SP buffer from the edited clean sample.
  function refreshSample(i) {
    var p = state.pads[i];
    var sp = DSP.resampleLinear(p.dataClean, DSP.SYNTH_RATE, DSP.SP_RATE);
    p.dataSP = DSP.quantize12(sp);
  }
  function pushUndo(p) {
    if (p.dataClean.length > 2000000) return; // skip huge samples
    if (!p._undo) p._undo = [];
    p._undo.push(p.dataClean.slice());
    if (p._undo.length > 10) p._undo.shift();
  }
  function commitEdit(i) {
    var p = state.pads[i];
    refreshSample(i);
    p.selStart = 0; p.selEnd = 1;
    drawWave();
    playPad(i); // audition the edit
    save();
  }

  var ed = null; // lazily built editor handles
  function buildEditor() {
    var root = el("div", "overlay", document.body);
    root.style.display = "none";
    var panel = el("div", "editor", root);
    var head = el("div", "ed-head", panel);
    var title = el("div", "ed-title", head);
    var x = el("button", "btn ed-x", head);
    x.textContent = "\u00d7";
    x.setAttribute("aria-label", "Close sample editor");
    x.addEventListener("click", closeEditor);
    root.addEventListener("click", function (e) { if (e.target === root) closeEditor(); });

    var cv = el("canvas", "wave", panel);
    cv.width = 640; cv.height = 160;

    var info = el("div", "ed-info", panel);

    // drag on the waveform to set the trim selection
    var dragging = false;
    function frac(e) {
      var r = (cv.getBoundingClientRect) ? cv.getBoundingClientRect() : { left: 0, width: cv.width };
      var cx = (e.clientX - r.left) / (r.width || 1);
      return clamp(cx, 0, 1);
    }
    cv.addEventListener("pointerdown", function (e) {
      var p = state.pads[ui.edOpenFor];
      if (!p) return;
      dragging = true;
      p.selStart = p.selEnd = frac(e);
      drawWave();
      if (e.preventDefault) e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var p = state.pads[ui.edOpenFor];
      if (!p) return;
      p.selEnd = frac(e);
      drawWave();
    });
    cv.addEventListener("pointerup", function () { dragging = false; });

    var ops = el("div", "ed-ops", panel);
    function opBtn(label, fn, aria) {
      var b = el("button", "btn", ops);
      b.textContent = label;
      b.setAttribute("aria-label", aria || label);
      b.addEventListener("click", fn);
      return b;
    }
    opBtn("TRIM", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      var a = Math.min(p.selStart, p.selEnd), b = Math.max(p.selStart, p.selEnd);
      if (b - a < 0.002) return; // nothing selected
      pushUndo(p);
      p.dataClean = DSP.trimSample(p.dataClean, a, b);
      commitEdit(i);
    }, "Crop sample to selection");
    opBtn("NORM", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      pushUndo(p);
      DSP.normalize(p.dataClean, 0.92);
      commitEdit(i);
    }, "Normalize sample peak");
    opBtn("REVERSE", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      pushUndo(p);
      p.dataClean = DSP.reverseSample(p.dataClean);
      commitEdit(i);
    }, "Reverse sample");
    opBtn("FADE IN", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      pushUndo(p);
      p.dataClean = DSP.fadeSample(p.dataClean, 0.05, 0);
      commitEdit(i);
    }, "Fade in over first 5 percent");
    opBtn("FADE OUT", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      pushUndo(p);
      p.dataClean = DSP.fadeSample(p.dataClean, 0, 0.05);
      commitEdit(i);
    }, "Fade out over last 5 percent");
    opBtn("UNDO", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      if (p._undo && p._undo.length) {
        p.dataClean = p._undo.pop();
        commitEdit(i);
      }
    }, "Undo last edit");

    var fsec = el("div", "ed-filter", panel);
    var flab = el("div", "ed-flab", fsec);
    flab.textContent = "FILTER";
    var ftypes = el("div", "ed-ftypes", fsec);
    var ftypeBtns = {};
    FILTER_TYPES.forEach(function (t) {
      var b = el("button", "btn", ftypes);
      b.textContent = FILTER_SHORT[t];
      b.setAttribute("aria-label", "Filter type " + t);
      b.addEventListener("click", function () { setFilterType(ui.edOpenFor, t); save(); });
      ftypeBtns[t] = b;
    });
    var cutoff = makeSlider(fsec, "CUTOFF", 0, 100, 1, 100,
      function (v) { return Math.round(sliderToFreq(v)) + " Hz"; },
      function (v) { state.pads[ui.edOpenFor].filterFreq = sliderToFreq(v); save(); });
    var reso = makeSlider(fsec, "RESO", 5, 80, 1, 8,
      function (v) { return (v / 10).toFixed(1); },
      function (v) { state.pads[ui.edOpenFor].filterQ = v / 10; save(); });

    ed = { root: root, title: title, canvas: cv, info: info, ftypeBtns: ftypeBtns, cutoff: cutoff, reso: reso };
  }
  function paintFilterTypes() {
    if (!ed) return;
    var t = state.pads[ui.edOpenFor].filterType;
    FILTER_TYPES.forEach(function (k) { ed.ftypeBtns[k].classList.toggle("on", k === t); });
  }
  function syncEditor() {
    // refresh the editor for the currently open pad (after load/reset)
    if (!ed || ui.edOpenFor == null || ui.edOpenFor < 0) return;
    var p = state.pads[ui.edOpenFor];
    ed.title.textContent = "SAMPLE EDIT — " + (p.customName || p.def.name);
    paintFilterTypes();
    ed.cutoff.set(freqToSlider(p.filterFreq));
    ed.reso.set(p.filterQ * 10);
    drawWave();
  }
  function openEditor(i) {
    if (!ed) buildEditor();
    ui.edOpenFor = i;
    var p = state.pads[i];
    p.selStart = 0; p.selEnd = 1;
    syncEditor();
    ed.root.style.display = "flex";
  }
  function closeEditor() {
    if (ed) ed.root.style.display = "none";
    ui.edOpenFor = -1;
  }
  function drawWave() {
    if (!ed || ui.edOpenFor == null || ui.edOpenFor < 0) return;
    var p = state.pads[ui.edOpenFor];
    var cv = ed.canvas;
    var g2d = cv.getContext && cv.getContext("2d");
    if (!g2d) return;
    var W = cv.width, H = cv.height, d = p.dataClean;
    g2d.fillStyle = "#060907";
    g2d.fillRect(0, 0, W, H);
    var mid = H / 2, amp = H * 0.46;
    g2d.strokeStyle = "#ffb000";
    g2d.lineWidth = 1;
    g2d.beginPath();
    for (var x = 0; x < W; x++) {
      var a = Math.floor(x / W * d.length);
      var b = Math.max(a + 1, Math.floor((x + 1) / W * d.length));
      var mn = 1, mx = -1;
      for (var k = a; k < b && k < d.length; k++) {
        var v = d[k];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      if (mx < mn) { mx = 0; mn = 0; }
      g2d.moveTo(x + 0.5, mid - mx * amp);
      g2d.lineTo(x + 0.5, mid - mn * amp + 0.5);
    }
    g2d.stroke();
    var s0 = Math.min(p.selStart, p.selEnd) * W, s1 = Math.max(p.selStart, p.selEnd) * W;
    g2d.fillStyle = "rgba(0,0,0,0.55)";
    g2d.fillRect(0, 0, s0, H);
    g2d.fillRect(s1, 0, W - s1, H);
    g2d.fillStyle = "#ffd47a";
    g2d.fillRect(s0 - 1, 0, 2, H);
    g2d.fillRect(s1 - 1, 0, 2, H);
    var secs = d.length / DSP.SYNTH_RATE;
    ed.info.textContent = secs.toFixed(2) + "s \u00b7 " + d.length + " samples \u00b7 sel " +
      (Math.min(p.selStart, p.selEnd) * secs).toFixed(2) + "\u2013" +
      (Math.max(p.selStart, p.selEnd) * secs).toFixed(2) + "s \u00b7 drag to select, TRIM crops";
  }

  // ---------------- UI ----------------
  function flashPad(idx) {
    var b = ui.padBtns[idx];
    if (!b) return;
    b.classList.add("hit");
    setTimeout(function () { b.classList.remove("hit"); }, 130);
  }
  function clearPlayhead() {
    for (var i = 0; i < ui.stepBtns.length; i++)
      for (var s = 0; s < ui.stepBtns[i].length; s++)
        ui.stepBtns[i][s].classList.remove("now");
  }
  function highlightStep(step) {
    clearPlayhead();
    for (var i = 0; i < ui.stepBtns.length; i++) ui.stepBtns[i][step].classList.add("now");
  }

  function makeSlider(parent, label, min, max, step, val, fmt, onInput) {
    var wrap = el("div", "ctl", parent);
    var lab = el("label", "", wrap);
    var nameSpan = el("span", "", lab); nameSpan.textContent = label;
    var valEl = el("b", "", lab); valEl.textContent = fmt(val);
    var input = el("input", "", wrap);
    input.type = "range"; input.min = min; input.max = max; input.step = step;
    input.value = val;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      valEl.textContent = fmt(v);
      onInput(v);
    });
    return { input: input, valEl: valEl, set: function (v) { input.value = v; valEl.textContent = fmt(v); } };
  }

  // vertical channel fader (tall skinny mixer-style strip control)
  function makeVFader(parent, label, min, max, step, val, cls, fmt, onInput) {
    var fb = el("div", "fader", parent);
    var valEl = el("b", "led", fb); valEl.textContent = fmt(val);
    var input = el("input", "vf " + cls, fb);
    input.type = "range"; input.min = min; input.max = max; input.step = step;
    input.value = val;
    input.setAttribute("orient", "vertical");
    input.setAttribute("aria-label", label);
    input.addEventListener("input", function () {
      var v = parseFloat(input.value);
      valEl.textContent = fmt(v);
      onInput(v);
    });
    var flab = el("span", "flab", fb); flab.textContent = label;
    return { input: input, valEl: valEl, set: function (v) { input.value = v; valEl.textContent = fmt(v); } };
  }

  function buildUI() {
    var mount = (document.querySelector && document.querySelector(".chassis")) || document.body;
    var app = el("div", "", mount);
    app.id = "app";
    ui.edOpenFor = -1;

    // ---- transport ----
    var top = el("div", "top", app);
    var brand = el("div", "brand", top);
    var h1 = el("h1", "", brand); h1.textContent = "SP-1200";
    var sub = el("p", "", brand); sub.textContent = "12-BIT SAMPLING DRUM MACHINE";

    var transport = el("div", "transport", top);
    ui.playBtn = el("button", "play-btn", transport);
    ui.playBtn.textContent = "\u25b6";
    ui.playBtn.setAttribute("aria-label", "Play");
    ui.playBtn.addEventListener("click", function () {
      if (state.playing) stopTransport(); else startTransport();
    });

    ui.tempo = makeSlider(transport, "TEMPO", 60, 200, 1, state.bpm,
      function (v) { return Math.round(v) + " BPM"; },
      function (v) { state.bpm = Math.round(v); save(); });
    ui.swing = makeSlider(transport, "SWING", 50, 75, 0.5, state.swing,
      function (v) { return v.toFixed(1) + "%"; },
      function (v) { state.swing = v; save(); });

    var tapBtn = el("button", "btn", transport);
    tapBtn.textContent = "TAP";
    tapBtn.setAttribute("aria-label", "Tap tempo");
    var taps = [];
    tapBtn.addEventListener("click", function () {
      var now = Date.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      if (taps.length > 6) taps.shift();
      if (taps.length >= 2) {
        var diffs = [];
        for (var i = 1; i < taps.length; i++) diffs.push(taps[i] - taps[i - 1]);
        var avg = diffs.reduce(function (a, b) { return a + b; }, 0) / diffs.length;
        state.bpm = clamp(Math.round(60000 / avg), 60, 200);
        ui.tempo.set(state.bpm);
        save();
      }
    });

    ui.master = makeSlider(transport, "MASTER", 0, 100, 1, state.master,
      function (v) { return Math.round(v) + "%"; },
      function (v) {
        state.master = v;
        if (masterGain) masterGain.gain.value = v / 100;
        save();
      });

    ui.spBtn = el("button", "btn" + (state.spMode ? " on" : ""), transport);
    ui.spBtn.textContent = "SP-1200";
    ui.spBtn.title = "Toggle the 12-bit / 26.04 kHz signal path";
    ui.spBtn.setAttribute("aria-label", "Toggle SP-1200 sound");
    ui.spBtn.addEventListener("click", function () {
      state.spMode = !state.spMode;
      ui.spBtn.classList.toggle("on", state.spMode);
      save();
    });

    var spec = el("div", "spec", transport);
    spec.innerHTML = "<b>26.04 kHz</b> · <b>12-BIT</b><br>VARISPEED TUNING";

    // ---- pads ----
    var pt = el("div", "section-title", app); pt.textContent = "PERFORMANCE";
    var padsEl = el("div", "pads", app);
    ui.padBtns = []; ui.padNames = []; ui.padCards = [];

    PAD_DEFS.forEach(function (def, i) {
      var card = el("div", "pad-card strip", padsEl);
      ui.padCards.push(card);
      var btn = el("button", "pad", card);
      ui.padBtns.push(btn);
      var nm = el("span", "", btn); nm.textContent = def.name;
      ui.padNames.push(nm);
      var key = el("span", "key", btn); key.textContent = def.key;
      btn.setAttribute("aria-label", "Trigger " + def.name);
      btn.addEventListener("pointerdown", function (e) { e.preventDefault(); playPad(i); });

      var frow = el("div", "frow", card);
      var tune = makeVFader(frow, "TUNE", 50, 200, 1, 100, "tune",
        function (v) { return Math.round(v) + "%"; },
        function (v) { state.pads[i].tune = v / 100; save(); });
      var level = makeVFader(frow, "LEVEL", 0, 100, 1, 90, "level",
        function (v) { return Math.round(v) + "%"; },
        function (v) { state.pads[i].level = v / 100; save(); });

      var row = el("div", "pbtns", card);
      var muteBtn = el("button", "btn warn", row);
      muteBtn.textContent = "MUTE";
      muteBtn.setAttribute("aria-label", "Mute " + def.name);
      muteBtn.addEventListener("click", function () {
        state.pads[i].muted = !state.pads[i].muted;
        muteBtn.classList.toggle("on", state.pads[i].muted);
        card.classList.toggle("muted", state.pads[i].muted);
        ui.seqRows[i].classList.toggle("muted", state.pads[i].muted);
        ui.seqMutes[i].classList.toggle("on", state.pads[i].muted);
        save();
      });
      var loadBtn = el("button", "btn", row);
      loadBtn.textContent = "LOAD";
      loadBtn.setAttribute("aria-label", "Load sample for " + def.name);
      var fileInput = el("input", "", card);
      fileInput.type = "file";
      fileInput.accept = "audio/*";
      fileInput.style.display = "none";
      loadBtn.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) loadSampleFile(i, fileInput.files[0]);
        fileInput.value = "";
      });
      var resetBtn = el("button", "btn", row);
      resetBtn.textContent = "RESET";
      resetBtn.setAttribute("aria-label", "Reset " + def.name + " to built-in drum");
      resetBtn.addEventListener("click", function () { resetPad(i); });

      var row2 = el("div", "pbtns sub", card);
      var editBtn = el("button", "btn", row2);
      editBtn.textContent = "EDIT";
      editBtn.setAttribute("aria-label", "Open sample editor for " + def.name);
      editBtn.addEventListener("click", function () { openEditor(i); });
      var fltBtn = el("button", "btn", row2);
      fltBtn.setAttribute("aria-label", "Cycle filter type for " + def.name);
      fltBtn.addEventListener("click", function () { cycleFilter(i); });

      ui["padTune" + i] = tune; ui["padLevel" + i] = level; ui["padMute" + i] = muteBtn;
      ui["padEdit" + i] = editBtn; ui["padFlt" + i] = fltBtn;
      setFilterType(i, state.pads[i].filterType);
    });

    // ---- sequencer ----
    var st = el("div", "section-title", app); st.textContent = "PROGRAMMING";
    var seq = el("div", "seq", app);
    var screen = el("div", "screen", seq);
    ui.seqRows = []; ui.seqMutes = []; ui.stepBtns = [];

    PAD_DEFS.forEach(function (def, i) {
      var row = el("div", "seq-row", screen);
      ui.seqRows.push(row);
      var lab = el("div", "seq-label", row);
      var labName = el("span", "", lab); labName.textContent = def.name;
      var m = el("button", "mini", lab);
      m.textContent = "M";
      m.setAttribute("aria-label", "Mute " + def.name);
      ui.seqMutes.push(m);
      m.addEventListener("click", function () { ui["padMute" + i].click(); });

      var stepsEl = el("div", "seq-steps", row);
      var btns = [];
      for (var s = 0; s < STEPS; s++) {
        (function (pi, si) {
          var b = el("button", "step" + (si % 4 === 0 ? " beat" : ""), stepsEl);
          b.setAttribute("aria-label", def.name + " step " + (si + 1));
          if (state.pattern[pi][si]) b.classList.add("on");
          b.addEventListener("click", function () {
            state.pattern[pi][si] = state.pattern[pi][si] ? 0 : 1;
            b.classList.toggle("on", !!state.pattern[pi][si]);
            save();
          });
          btns.push(b);
        })(i, s);
      }
      ui.stepBtns.push(btns);
    });

    // ---- presets ----
    var presetRow = el("div", "presets", app);
    Object.keys(PRESETS).forEach(function (name) {
      var b = el("button", "btn", presetRow);
      b.textContent = name;
      b.addEventListener("click", function () { applyPreset(name); });
    });
    var clearBtn = el("button", "btn", presetRow);
    clearBtn.textContent = "Clear pattern";
    clearBtn.addEventListener("click", function () {
      for (var i = 0; i < PAD_DEFS.length; i++) {
        state.pattern[i] = new Array(STEPS).fill(0);
        for (var s = 0; s < STEPS; s++) ui.stepBtns[i][s].classList.remove("on");
      }
      save();
    });

    var foot = el("div", "foot", app);
    foot.innerHTML = "<kbd>Space</kbd> play / stop &nbsp;·&nbsp; <kbd>1</kbd>–<kbd>8</kbd> trigger pads &nbsp;·&nbsp; click steps to program &nbsp;·&nbsp; LOAD puts your own samples through the 12-bit path";

    // ---- keyboard ----
    document.addEventListener("keydown", function (e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.code === "Escape") { closeEditor(); return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (state.playing) stopTransport(); else startTransport();
      } else {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 8) playPad(n - 1);
      }
    });
  }

  function applyPreset(name) {
    var pr = PRESETS[name];
    if (!pr) return;
    state.bpm = pr.bpm; state.swing = pr.swing;
    for (var i = 0; i < PAD_DEFS.length; i++) {
      state.pattern[i] = pr.steps[i].slice();
      for (var s = 0; s < STEPS; s++) ui.stepBtns[i][s].classList.toggle("on", !!pr.steps[i][s]);
    }
    ui.tempo.set(state.bpm);
    ui.swing.set(state.swing);
    save();
  }

  function init() {
    // default voices: synthesized, then "sampled" through the SP path
    PAD_DEFS.forEach(function (def) {
      state.pads.push({
        def: def,
        dataSP: DSP.SYNTHS[def.id](),
        dataClean: DSP.SYNTHS_RAW[def.id](),
        tune: 1, level: 0.9, muted: false, customName: null,
        filterType: "off", filterFreq: FREQ_MAX, filterQ: 0.8,
        selStart: 0, selEnd: 1, _undo: null,
      });
      state.pattern.push(new Array(STEPS).fill(0));
    });
    load();
    // pattern empty after load? fall back to Boom Bap factory groove
    var any = state.pattern.some(function (row) { return row.some(Boolean); });
    buildUI();
    if (!any) applyPreset("Boom Bap");
    else {
      // reflect loaded state in the freshly built UI
      ui.tempo.set(state.bpm);
      ui.swing.set(state.swing);
      ui.master.set(state.master);
      ui.spBtn.classList.toggle("on", state.spMode);
      state.pads.forEach(function (p, i) {
        ui["padTune" + i].set(p.tune * 100);
        ui["padLevel" + i].set(p.level * 100);
        ui["padMute" + i].classList.toggle("on", p.muted);
        setFilterType(i, p.filterType);
        ui.padCards[i].classList.toggle("muted", p.muted);
        ui.seqRows[i].classList.toggle("muted", p.muted);
        ui.seqMutes[i].classList.toggle("on", p.muted);
        for (var s = 0; s < STEPS; s++) ui.stepBtns[i][s].classList.toggle("on", !!state.pattern[i][s]);
      });
    }
  }

  // expose for tests
  var api = { init: init, state: state, ui: ui, applyPreset: applyPreset, PAD_DEFS: PAD_DEFS, PRESETS: PRESETS,
    _playPad: function (i, w) { return playPad(i, w); },
    _scheduleStep: function (s, t) { return scheduleStep(s, t); },
    _start: startTransport, _stop: stopTransport,
    _setFilterType: setFilterType, _cycleFilter: cycleFilter,
    _openEditor: openEditor, _closeEditor: closeEditor,
    _refreshSample: refreshSample, _drawWave: drawWave };
  if (typeof window !== "undefined") window.SP1200 = api;
  else globalThis.SP1200 = api;

  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
