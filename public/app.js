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
        pads: state.pads.map(function (p) { return { tune: p.tune, level: p.level, muted: p.muted }; }),
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
    src.connect(g);
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
    ui.padNames[padIdx].textContent = p.def.name;
    save();
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

  function buildUI() {
    var mount = (document.querySelector && document.querySelector(".chassis")) || document.body;
    var app = el("div", "", mount);
    app.id = "app";

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
    var pt = el("div", "section-title", app); pt.textContent = "PADS";
    var padsEl = el("div", "pads", app);
    ui.padBtns = []; ui.padNames = []; ui.padCards = [];

    PAD_DEFS.forEach(function (def, i) {
      var card = el("div", "pad-card", padsEl);
      ui.padCards.push(card);
      var btn = el("button", "pad", card);
      ui.padBtns.push(btn);
      var nm = el("span", "", btn); nm.textContent = def.name;
      ui.padNames.push(nm);
      var key = el("span", "key", btn); key.textContent = def.key;
      btn.setAttribute("aria-label", "Trigger " + def.name);
      btn.addEventListener("pointerdown", function (e) { e.preventDefault(); playPad(i); });

      var tune = makeSlider(card, "TUNE", 50, 200, 1, 100,
        function (v) { return Math.round(v) + "%"; },
        function (v) { state.pads[i].tune = v / 100; save(); });
      tune.input.classList.add("mini-slider");
      var level = makeSlider(card, "LEVEL", 0, 100, 1, 90,
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

      ui["padTune" + i] = tune; ui["padLevel" + i] = level; ui["padMute" + i] = muteBtn;
    });

    // ---- sequencer ----
    var st = el("div", "section-title", app); st.textContent = "SEQUENCER";
    var seq = el("div", "seq", app);
    ui.seqRows = []; ui.seqMutes = []; ui.stepBtns = [];

    PAD_DEFS.forEach(function (def, i) {
      var row = el("div", "seq-row", seq);
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
    _start: startTransport, _stop: stopTransport };
  if (typeof window !== "undefined") window.SP1200 = api;
  else globalThis.SP1200 = api;

  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
