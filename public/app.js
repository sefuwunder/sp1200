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
    tapes: [],     // 4 tape tracks: { buffer, bars, bpm, name, level, muted, bouncing, _src, _gain }
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

  // ---- compact binary <-> text helpers (pure JS, no btoa dependency) ----
  var B64ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToB64(bytes) {
    var s = "", i, n;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      s += B64ABC[(n >> 18) & 63] + B64ABC[(n >> 12) & 63] + B64ABC[(n >> 6) & 63] + B64ABC[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      n = bytes[i] << 16;
      s += B64ABC[(n >> 18) & 63] + B64ABC[(n >> 12) & 63] + "==";
    } else if (rem === 2) {
      n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      s += B64ABC[(n >> 18) & 63] + B64ABC[(n >> 12) & 63] + B64ABC[(n >> 6) & 63] + "=";
    }
    return s;
  }
  function b64ToBytes(b64) {
    var rev = {}, k;
    for (k = 0; k < 64; k++) rev[B64ABC.charAt(k)] = k;
    var pad = 0;
    if (b64.charAt(b64.length - 1) === "=") pad++;
    if (b64.charAt(b64.length - 2) === "=") pad++;
    var out = new Uint8Array((b64.length * 3 >> 2) - pad), j = 0, i;
    for (i = 0; i < b64.length; i += 4) {
      var a = rev[b64.charAt(i)], b = rev[b64.charAt(i + 1)];
      var c = b64.charAt(i + 2) === "=" ? 0 : rev[b64.charAt(i + 2)];
      var d = b64.charAt(i + 3) === "=" ? 0 : rev[b64.charAt(i + 3)];
      var n = (a << 18) | (b << 12) | (c << 6) | d;
      out[j++] = (n >> 16) & 255;
      if (j < out.length) out[j++] = (n >> 8) & 255;
      if (j < out.length) out[j++] = n & 255;
    }
    return out;
  }
  // Float32Array <-> base64 of 16-bit PCM (halves the size of float storage)
  function f32ToPcm16B64(data) {
    var bytes = new Uint8Array(data.length * 2);
    for (var i = 0; i < data.length; i++) {
      var v = data[i] < -1 ? -1 : data[i] > 1 ? 1 : data[i];
      var s = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
      if (s < 0) s += 65536;
      bytes[i * 2] = s & 255;
      bytes[i * 2 + 1] = (s >> 8) & 255;
    }
    return bytesToB64(bytes);
  }
  function pcm16B64ToF32(b64) {
    var bytes = b64ToBytes(b64), n = bytes.length >> 1, out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var s = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
      if (s >= 32768) s -= 65536;
      out[i] = s < 0 ? s / 32768 : s / 32767;
    }
    return out;
  }

  function applyScalars(s) {
    if (!s) return;
    if (s.bpm) state.bpm = clamp(s.bpm, 60, 200);
    if (s.swing) state.swing = clamp(s.swing, 50, 75);
    if (typeof s.master === "number") state.master = clamp(s.master, 0, 100);
    if (typeof s.spMode === "boolean") state.spMode = s.spMode;
    if (Array.isArray(s.pattern) && s.pattern.length === PAD_DEFS.length) {
      state.pattern = s.pattern.map(function (row) {
        var r = new Array(STEPS).fill(0);
        if (Array.isArray(row)) for (var i = 0; i < Math.min(row.length, STEPS); i++) r[i] = row[i] ? 1 : 0;
        return r;
      });
    }
  }
  function applyPadSettings(i, ps) {
    if (!state.pads[i] || !ps) return;
    state.pads[i].tune = clamp(ps.tune || 1, 0.5, 2);
    state.pads[i].level = clamp(ps.level == null ? 0.9 : ps.level, 0, 1);
    state.pads[i].muted = !!ps.muted;
    if (ps.filterType && FILTER_TYPES.indexOf(ps.filterType) >= 0) state.pads[i].filterType = ps.filterType;
    if (typeof ps.filterFreq === "number") state.pads[i].filterFreq = clamp(ps.filterFreq, FREQ_MIN, FREQ_MAX);
    if (typeof ps.filterQ === "number") state.pads[i].filterQ = clamp(ps.filterQ, 0.5, 8);
    if (ps.voiceMode === "mono" || ps.voiceMode === "poly") state.pads[i].voiceMode = ps.voiceMode;
    if (typeof ps.choke === "number") state.pads[i].choke = clamp(Math.round(ps.choke), 0, 3);
    if (ps.delay) {
      var d = state.pads[i].delay;
      d.on = !!ps.delay.on;
      if (typeof ps.delay.time === "number") d.time = clamp(ps.delay.time, 0.03, 1);
      if (typeof ps.delay.feedback === "number") d.feedback = clamp(ps.delay.feedback, 0, 0.85);
      if (typeof ps.delay.mix === "number") d.mix = clamp(ps.delay.mix, 0, 0.6);
    }
  }
  function padSettings(i) {
    var p = state.pads[i];
    var o = {
      tune: p.tune, level: p.level, muted: p.muted,
      filterType: p.filterType, filterFreq: p.filterFreq, filterQ: p.filterQ,
      voiceMode: p.voiceMode, choke: p.choke,
      delay: { on: p.delay.on, time: p.delay.time, feedback: p.delay.feedback, mix: p.delay.mix },
      custom: null,
    };
    if (p.customName && p.dataClean) o.custom = { name: p.customName, pcm: f32ToPcm16B64(p.dataClean) };
    return o;
  }
  function save() {
    try {
      localStorage.setItem("sp1200", JSON.stringify({
        bpm: state.bpm, swing: state.swing, master: state.master, spMode: state.spMode,
        pattern: state.pattern,
        pads: state.pads.map(function (p, i) { return padSettings(i); }),
      }));
    } catch (e) { /* private mode etc. */ }
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem("sp1200") || "null");
      if (!s) return;
      applyScalars(s);
      (s.pads || []).forEach(function (ps, i) { applyPadSettings(i, ps); });
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
  // ---- voice management: choke groups + mono/poly ----
  function stopVoice(v, t) {
    try {
      var g = v.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(0, t, 0.004);
      v.src.stop(t + 0.08);
    } catch (e) {
      try { v.src.stop(); } catch (e2) {}
    }
  }

  // A voice store holds one pad's live voices + delay nodes on one context.
  function newVoiceStore() { return { voices: [], delay: null }; }

  function killStoreVoices(st, t) {
    var vs = st.voices.slice();
    st.voices.length = 0;
    for (var i = 0; i < vs.length; i++) stopVoice(vs[i], t);
  }

  // ---- per-pad delay effect (shared nodes, lazily created) ----
  function storeDelay(ac, dest, st) {
    if (!st.delay) {
      var d = ac.createDelay(1.0);
      var fb = ac.createGain();
      var wet = ac.createGain();
      wet.gain.value = 0;
      d.connect(fb);
      fb.connect(d);
      d.connect(wet);
      wet.connect(dest);
      st.delay = { node: d, fb: fb, wet: wet };
    }
    return st.delay;
  }

  function syncStoreDelay(ac, st, p) {
    if (!st.delay) return;
    var t = ac.currentTime;
    st.delay.node.delayTime.setTargetAtTime(clamp(p.delay.time, 0.03, 1), t, 0.02);
    st.delay.fb.gain.setTargetAtTime(clamp(p.delay.feedback, 0, 0.85), t, 0.02);
    st.delay.wet.gain.setTargetAtTime(p.delay.on ? clamp(p.delay.mix, 0, 0.6) : 0, t, 0.02);
  }

  // Facade so the generic trigger reads/writes a pad's live voice state.
  function liveVS() {
    return state.pads.map(function (p) {
      return {
        get voices() { return p._voices || (p._voices = []); },
        set voices(v) { p._voices = v; },
        get delay() { return p._delay; },
        set delay(d) { p._delay = d; }
      };
    });
  }

  function padDelay(idx) {
    return storeDelay(ctx, masterGain, liveVS()[idx]);
  }

  function syncDelay(idx) {
    if (!ctx) return;
    syncStoreDelay(ctx, liveVS()[idx], state.pads[idx]);
  }

  // Generic pad trigger on any BaseAudioContext. VS is an array of voice
  // stores (one per pad); the live path passes liveVS(), the bounce render
  // passes fresh stores on an OfflineAudioContext.
  function playPadOn(ac, dest, idx, t0, VS) {
    var p = state.pads[idx];
    if (!p || p.muted) return null;
    // Choke groups: a hit cuts every other pad sharing its group.
    if (p.choke) {
      for (var c = 0; c < state.pads.length; c++) {
        if (c !== idx && state.pads[c].choke === p.choke) killStoreVoices(VS[c], t0);
      }
    }
    // Mono: retriggering cuts this pad's own tail.
    if (p.voiceMode === "mono") killStoreVoices(VS[idx], t0);
    var useSP = state.spMode;
    var data = useSP ? p.dataSP : p.dataClean;
    var rate = useSP ? DSP.SP_RATE : DSP.SYNTH_RATE;
    var buf = ac.createBuffer(1, data.length, rate);
    buf.copyToChannel(data, 0);
    var src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = p.tune; // varispeed, exactly like the hardware
    var g = ac.createGain();
    g.gain.value = p.level;
    if (p.filterType !== "off") {
      var flt = ac.createBiquadFilter();
      flt.type = p.filterType; // lowpass | bandpass | highpass
      flt.frequency.value = p.filterFreq;
      flt.Q.value = p.filterQ;
      src.connect(flt);
      flt.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(dest);
    if (p.delay.on) {
      var dl = storeDelay(ac, dest, VS[idx]);
      syncStoreDelay(ac, VS[idx], p);
      g.connect(dl.node);
    }
    var voice = { src: src, gain: g };
    VS[idx].voices.push(voice);
    src.onended = function () {
      var a = VS[idx].voices.indexOf(voice);
      if (a >= 0) VS[idx].voices.splice(a, 1);
    };
    src.start(t0);
    return voice;
  }

  function playPad(idx, when) {
    var p = state.pads[idx];
    if (!p || p.muted) return;
    ensureAudio();
    playPadOn(ctx, masterGain, idx, when == null ? ctx.currentTime : when, liveVS());
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
    paintTransport();
  }
  function stopTransport() {
    if (!state.playing) return;
    state.playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    clearPlayhead();
    paintTransport();
  }

  // The main transport is global: the drum machine and the tape tracks
  // start/stop together. The tape overlay keeps its own tape-only controls.
  function anyTapePlaying() {
    return state.tapes.some(function (t) { return t && t._src; });
  }
  function paintTransport() {
    if (!ui.playBtn) return;
    var playing = state.playing || anyTapePlaying();
    ui.playBtn.classList.toggle("playing", playing);
    ui.playBtn.textContent = playing ? "\u25a0" : "\u25b6"; // ■ / ▶
    ui.playBtn.setAttribute("aria-label", playing ? "Stop drums + tape" : "Play drums + tape");
  }
  function globalPlay() {
    ensureAudio();
    startTransport();
    tapePlayAll();
    paintTransport();
  }
  function globalStop() {
    stopTransport();
    tapeStopAll();
    paintTransport();
  }
  // Panic: silence every voice, delay tail, tape, and the sequencer, now.
  function panic() {
    ensureAudio();
    var t = ctx.currentTime;
    stopTransport();
    tapeStopAll();
    stopSlicerAudition();
    var VS = liveVS();
    for (var i = 0; i < state.pads.length; i++) {
      killStoreVoices(VS[i], t);
      if (VS[i].delay) {
        // choke the delay line itself; the next hit re-syncs from pad state
        VS[i].delay.wet.gain.setTargetAtTime(0, t, 0.01);
        VS[i].delay.fb.gain.setTargetAtTime(0, t, 0.01);
      }
    }
    paintTape();
    paintTransport();
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

  // ---------------- tape: bounce + 4-track arranger ----------------
  var TAPE_COUNT = 4;
  var BOUNCE_SR = 44100;

  function freshTape(i) {
    return { buffer: null, bars: 0, bpm: 0, name: "TRACK " + (i + 1),
             level: 0.8, muted: false, bouncing: false, _src: null, _gain: null };
  }

  // Render the current pattern (with swing, choke, mono, filters, delay —
  // exactly what the live transport would play) to a stereo buffer.
  function renderPattern(bars) {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var d = DSP.sixteenthDur(state.bpm);
    var barDur = d * STEPS;
    var oc = new OC(2, Math.max(1, Math.ceil(barDur * bars * BOUNCE_SR)), BOUNCE_SR);
    var master = oc.createGain();
    master.gain.value = state.master / 100;
    var comp = oc.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(oc.destination);
    var VS = state.pads.map(function () { return newVoiceStore(); });
    for (var b = 0; b < bars; b++) {
      for (var s = 0; s < STEPS; s++) {
        // same swing math as scheduleStep: gridTime = b*barDur + s*d,
        // t = gridTime + (stepTime16(s) - s*d)
        var t = b * barDur + DSP.stepTime16(s, state.bpm, state.swing);
        for (var i = 0; i < state.pads.length; i++) {
          if (state.pattern[i][s]) playPadOn(oc, master, i, t, VS);
        }
      }
    }
    return oc.startRendering();
  }

  function tapeStop(i) {
    var t = state.tapes[i];
    if (t && t._src) {
      try { t._src.stop(); } catch (e) {}
      t._src = null;
      t._gain = null;
      paintTransport();
    }
  }

  function tapePlay(i) {
    var t = state.tapes[i];
    if (!t || !t.buffer || t.bouncing) return;
    ensureAudio();
    tapeStop(i);
    var src = ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = true;
    var g = ctx.createGain();
    g.gain.value = t.muted ? 0 : t.level;
    src.connect(g);
    g.connect(masterGain);
    src.start();
    t._src = src;
    t._gain = g;
    paintTape();
    paintTransport();
  }

  function tapePlayAll() {
    for (var i = 0; i < TAPE_COUNT; i++) {
      var t = state.tapes[i];
      if (t && t.buffer && !t.bouncing && !t.muted) tapePlay(i);
    }
    paintTape();
  }

  function tapeStopAll() {
    for (var i = 0; i < TAPE_COUNT; i++) tapeStop(i);
    paintTape();
    paintTransport();
  }

  function tapeToggleMute(i) {
    var t = state.tapes[i];
    if (!t) return;
    t.muted = !t.muted;
    if (t._gain && ctx) t._gain.gain.setTargetAtTime(t.muted ? 0 : t.level, ctx.currentTime, 0.02);
    paintTape();
  }

  function tapeSetLevel(i, v) {
    var t = state.tapes[i];
    if (!t) return;
    t.level = clamp(v, 0, 1);
    if (t._gain && ctx && !t.muted) t._gain.gain.setTargetAtTime(t.level, ctx.currentTime, 0.02);
  }

  function tapeClear(i) {
    tapeStop(i);
    state.tapes[i] = freshTape(i);
    paintTape();
  }

  function bounceToTape(i) {
    var t = state.tapes[i];
    if (!t || t.bouncing) return;
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) { t.bounceError = true; paintTape(); return; }
    tapeStop(i);
    t.bouncing = true;
    t.bounceError = false;
    paintTape();
    var bars = ui.tapeBars || 2;
    renderPattern(bars).then(function (buf) {
      t.buffer = buf;
      t.bars = bars;
      t.bpm = state.bpm;
      t.name = "BOUNCE " + (i + 1);
      t.bouncing = false;
      paintTape();
      drawTapeWave(i);
      tapePlay(i); // bounce straight onto the loop
    }, function () {
      t.bouncing = false;
      t.bounceError = true;
      paintTape();
    });
  }

  function tapeToSlicer(i) {
    var t = state.tapes[i];
    if (!t || !t.buffer) return;
    closeTape();
    openSlicer();
    // slicerSetTape takes mono 44.1 kHz data — the bounce already is that
    slicerSetTape(t.buffer.getChannelData(0), t.name);
  }

  // ---------------- projects: named save / load ----------------
  var PROJECTS_KEY = "sp1200.projects";
  function loadProjectIndex() {
    try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function writeProjectIndex(idx) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(idx));
  }
  function tapeToSaved(t) {
    var o = { name: t.name, bars: t.bars, bpm: t.bpm, level: t.level, muted: t.muted, audio: null };
    if (t.buffer && t.buffer.length) {
      var len = t.buffer.length;
      var l = t.buffer.getChannelData(0);
      var r = (t.buffer.numberOfChannels || 1) > 1 ? t.buffer.getChannelData(1) : l;
      var planar = new Float32Array(len * 2);
      for (var i = 0; i < len; i++) { planar[i] = l[i]; planar[len + i] = r[i]; }
      o.audio = { sr: t.buffer.sampleRate, len: len, pcm: f32ToPcm16B64(planar) };
    }
    return o;
  }
  function audioBufferFromSaved(a) {
    ensureAudio();
    var f = pcm16B64ToF32(a.pcm);
    var buf = ctx.createBuffer(2, a.len, a.sr);
    buf.getChannelData(0).set(f.subarray(0, a.len));
    if (buf.numberOfChannels > 1) buf.getChannelData(1).set(f.subarray(a.len, a.len * 2));
    return buf;
  }
  function serializeProject(name) {
    return {
      version: 1, name: name, savedAt: Date.now(),
      bpm: state.bpm, swing: state.swing, master: state.master, spMode: state.spMode,
      pattern: state.pattern.map(function (row) { return row.slice(); }),
      pads: state.pads.map(function (p, i) { return padSettings(i); }),
      tapes: state.tapes.map(tapeToSaved),
      tapeBars: ui.tapeBars || 2,
    };
  }
  function saveProject(name) {
    name = (name || "").trim().slice(0, 40);
    if (!name) { projStatus("Name the project first"); return; }
    var idx = loadProjectIndex();
    var proj = serializeProject(name);
    try {
      idx[name] = proj;
      writeProjectIndex(idx);
      projStatus("Saved \u201c" + name + "\u201d");
    } catch (e) {
      // quota: retry without tape audio, which dominates the size
      try {
        proj.tapes.forEach(function (t) { t.audio = null; });
        proj.tapesDropped = true;
        idx[name] = proj;
        writeProjectIndex(idx);
        projStatus("Saved \u201c" + name + "\u201d (tape audio too large \u2014 skipped)");
      } catch (e2) { projStatus("Save failed: storage is full"); }
    }
    paintProjects();
  }
  function loadProject(name) {
    var proj = loadProjectIndex()[name];
    if (!proj || proj.version !== 1) { projStatus("Can't load \u201c" + name + "\u201d"); return; }
    loadProjectData(proj);
  }
  function loadProjectData(proj) {
    panic();
    applyScalars(proj);
    (proj.pads || []).forEach(function (ps, i) {
      applyPadSettings(i, ps);
      var p = state.pads[i];
      if (!p) return;
      if (ps && ps.custom && ps.custom.pcm) {
        try {
          p.dataClean = pcm16B64ToF32(ps.custom.pcm);
          refreshSample(i);
          p.customName = ps.custom.name || "SAMPLE";
        } catch (e) { resetPad(i); }
      } else {
        p.dataSP = DSP.SYNTHS[p.def.id]();
        p.dataClean = DSP.SYNTHS_RAW[p.def.id]();
        p.customName = null;
      }
      p._undo = null; p.selStart = 0; p.selEnd = 1;
    });
    for (var ti = 0; ti < TAPE_COUNT; ti++) {
      tapeStop(ti);
      var t = state.tapes[ti], ts = (proj.tapes || [])[ti] || {};
      t.buffer = null; t.bouncing = false; t.bounceError = false;
      t.name = ts.name || ("TRACK " + (ti + 1));
      t.bars = ts.bars || 2; t.bpm = ts.bpm || state.bpm;
      t.level = typeof ts.level === "number" ? clamp(ts.level, 0, 1) : 0.8;
      t.muted = !!ts.muted;
      if (ts.audio && ts.audio.pcm && ts.audio.len) {
        try { t.buffer = audioBufferFromSaved(ts.audio); }
        catch (e) { t.buffer = null; }
      }
    }
    ui.tapeBars = proj.tapeBars || 2;
    syncUIFromState();
    save(); // the autosave follows the loaded project
    closeProjPanel();
  }
  function deleteProject(name) {
    var idx = loadProjectIndex();
    delete idx[name];
    try { writeProjectIndex(idx); } catch (e) {}
    paintProjects();
    projStatus("Deleted \u201c" + name + "\u201d");
  }
  function newProject() {
    if (!window.confirm("Start a new project? Unsaved changes will be lost.")) return;
    try { localStorage.removeItem("sp1200"); } catch (e) {}
    window.location.reload();
  }
  // ---------------- external save / load: project files ----------------
  function projectFileName(name) {
    var base = (name || "untitled").trim().toLowerCase()
      .replace(/[^\w\- ]+/g, "").trim().replace(/[\s_]+/g, "-");
    if (!base) base = "untitled";
    return base + ".sp1200.json";
  }
  function downloadFile(filename, text, type) {
    try {
      if (typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return false;
      var blob = new Blob([text], { type: type });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); if (a.remove) a.remove(); }, 800);
      return true;
    } catch (e) { return false; }
  }
  function exportProject() {
    var name = (ui.projName && ui.projName.value || "").trim().slice(0, 40) || "untitled";
    var text = JSON.stringify(serializeProject(name));
    if (downloadFile(projectFileName(name), text, "application/json")) {
      projStatus("Exported \u201c" + name + "\u201d");
    } else {
      projStatus("Export needs a full browser");
    }
  }
  function importProjectFile(file) {
    if (typeof FileReader === "undefined") { projStatus("Import needs a full browser"); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var proj;
      try {
        proj = JSON.parse(rd.result);
        if (!proj || proj.version !== 1 || !Array.isArray(proj.pattern)) throw 0;
      } catch (e) { projStatus("Import failed: not a valid project file"); return; }
      var name = (proj.name || "imported").toString().slice(0, 40) || "imported";
      proj.name = name;
      try {
        var idx = loadProjectIndex();
        idx[name] = proj;
        writeProjectIndex(idx);
      } catch (e) { /* quota: load it anyway, just don't keep it listed */ }
      loadProjectData(proj);
      paintProjects();
      projStatus("Imported \u201c" + name + "\u201d");
    };
    try { rd.readAsText(file); } catch (e) { projStatus("Import failed: can't read the file"); }
  }
  function projStatus(msg) {
    if (ui.projStatus) ui.projStatus.textContent = msg || "";
  }
  function toggleProjPanel() {
    if (!ui.projPanel) return;
    var open = ui.projPanel.style.display !== "none";
    if (open) closeProjPanel();
    else {
      ui.projPanel.style.display = "flex";
      paintProjects();
      projStatus("");
      if (ui.projName && ui.projName.focus) ui.projName.focus();
    }
  }
  function closeProjPanel() {
    if (ui.projPanel) ui.projPanel.style.display = "none";
  }
  function paintProjects() {
    if (!ui.projList) return;
    var idx = loadProjectIndex();
    var names = Object.keys(idx).sort();
    ui.projList.innerHTML = "";
    if (!names.length) {
      var empty = el("div", "proj-empty", ui.projList);
      empty.textContent = "NO SAVED PROJECTS";
      return;
    }
    names.forEach(function (name) {
      var item = el("div", "proj-item", ui.projList);
      var nm = el("div", "nm", item);
      nm.textContent = name;
      nm.title = name;
      var dt = el("div", "dt", item);
      var when = idx[name] && idx[name].savedAt;
      dt.textContent = when ? new Date(when).toLocaleDateString() : "";
      var loadB = el("button", "btn", item);
      loadB.textContent = "LOAD";
      loadB.setAttribute("aria-label", "Load project " + name);
      loadB.addEventListener("click", function () { loadProject(name); });
      var delB = el("button", "btn", item);
      delB.textContent = "DEL";
      delB.setAttribute("aria-label", "Delete project " + name);
      delB.addEventListener("click", function () {
        if (window.confirm("Delete project \u201c" + name + "\u201d?")) deleteProject(name);
      });
    });
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

  var CHOKE_NAMES = ["CHK OFF", "CHK A", "CHK B", "CHK C"];
  function paintVoiceMode(i) {
    var p = state.pads[i], b = ui["padMode" + i];
    if (!p || !b) return;
    b.textContent = p.voiceMode === "mono" ? "MONO" : "POLY";
    b.classList.toggle("on", p.voiceMode === "mono");
  }
  function paintChoke(i) {
    var p = state.pads[i], b = ui["padChoke" + i];
    if (!p || !b) return;
    b.textContent = CHOKE_NAMES[clamp(p.choke | 0, 0, 3)];
    b.classList.toggle("on", (p.choke | 0) > 0);
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

    var dsec = el("div", "ed-filter", panel);
    var dlab = el("div", "ed-flab", dsec);
    dlab.textContent = "DELAY";
    var drow = el("div", "ed-ftypes", dsec);
    var dOnBtn = el("button", "btn", drow);
    dOnBtn.textContent = "OFF";
    dOnBtn.setAttribute("aria-label", "Toggle delay effect");
    dOnBtn.addEventListener("click", function () {
      var i = ui.edOpenFor, p = state.pads[i];
      p.delay.on = !p.delay.on;
      if (p.delay.on && ctx) { padDelay(i); syncDelay(i); }
      else if (ctx) syncDelay(i);
      paintDelay();
      save();
    });
    var dTime = makeSlider(dsec, "TIME", 3, 100, 1, 32,
      function (v) { return Math.round(v * 10) + " ms"; },
      function (v) { var p = state.pads[ui.edOpenFor]; p.delay.time = v / 100; if (ctx) syncDelay(ui.edOpenFor); save(); });
    var dFdbk = makeSlider(dsec, "FDBK", 0, 85, 1, 35,
      function (v) { return Math.round(v) + "%"; },
      function (v) { var p = state.pads[ui.edOpenFor]; p.delay.feedback = v / 100; if (ctx) syncDelay(ui.edOpenFor); save(); });
    var dMix = makeSlider(dsec, "MIX", 0, 60, 1, 30,
      function (v) { return Math.round(v) + "%"; },
      function (v) { var p = state.pads[ui.edOpenFor]; p.delay.mix = v / 100; if (ctx) syncDelay(ui.edOpenFor); save(); });

    ed = { root: root, title: title, canvas: cv, info: info, ftypeBtns: ftypeBtns, cutoff: cutoff, reso: reso,
           dOn: dOnBtn, dTime: dTime, dFdbk: dFdbk, dMix: dMix };
  }
  function paintDelay() {
    if (!ed) return;
    var on = state.pads[ui.edOpenFor].delay.on;
    ed.dOn.textContent = on ? "ON" : "OFF";
    ed.dOn.classList.toggle("on", on);
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
    paintDelay();
    ed.dTime.set(p.delay.time * 100);
    ed.dFdbk.set(p.delay.feedback * 100);
    ed.dMix.set(p.delay.mix * 100);
    drawWave();
  }
  function openEditor(i) {
    closeProjPanel();
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

  // ---------------- tape slicer ----------------
  // Load a long sample ("tape"), drop markers to chop it into segments,
  // audition each chop, and load any segment onto any pad through the
  // 12-bit SP path. The tape itself is never persisted; loaded chops
  // behave exactly like LOADed samples (undoable in the editor).
  var sl = null; // lazily built slicer handles + tape state

  function slicerSegments() {
    // [{start, end}] in samples, derived from the sorted markers.
    if (!sl || !sl.tape || !sl.tape.length) return [];
    var marks = sl.markers.slice().sort(function (a, b) { return a - b; });
    var bounds = [0];
    for (var i = 0; i < marks.length; i++) bounds.push(Math.floor(marks[i] * sl.tape.length));
    bounds.push(sl.tape.length);
    var segs = [];
    for (var j = 0; j + 1 < bounds.length; j++) {
      if (bounds[j + 1] - bounds[j] >= 64) segs.push({ start: bounds[j], end: bounds[j + 1] });
    }
    return segs;
  }

  function buildSlicer() {
    var root = el("div", "overlay", document.body);
    root.style.display = "none";
    var panel = el("div", "editor slicer", root);
    var head = el("div", "ed-head", panel);
    var title = el("div", "ed-title", head);
    title.textContent = "TAPE SLICER";
    var x = el("button", "btn ed-x", head);
    x.textContent = "\u00d7";
    x.setAttribute("aria-label", "Close tape slicer");
    x.addEventListener("click", closeSlicer);
    root.addEventListener("click", function (e) { if (e.target === root) closeSlicer(); });

    var cv = el("canvas", "wave", panel);
    cv.width = 640; cv.height = 170;

    var info = el("div", "ed-info", panel);

    var ops = el("div", "ed-ops", panel);
    function opBtn(label, fn, aria) {
      var b = el("button", "btn", ops);
      b.textContent = label;
      b.setAttribute("aria-label", aria || label);
      b.addEventListener("click", fn);
      return b;
    }
    var loadBtn = opBtn("LOAD TAPE", function () { sl.fileInput.click(); }, "Load a long sample to slice");
    var fileInput = el("input", "", panel);
    fileInput.type = "file";
    fileInput.accept = "audio/*";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) loadTapeFile(fileInput.files[0]);
      fileInput.value = "";
    });
    var nInput = el("input", "slicer-n", ops);
    nInput.type = "number"; nInput.min = 2; nInput.max = 64; nInput.value = 8;
    nInput.setAttribute("aria-label", "Number of equal slices");
    opBtn("EQUAL", slicerEqual, "Chop the tape into N equal slices");
    opBtn("AUTO", slicerAuto, "Detect transients and mark each hit");
    opBtn("CLEAR", function () {
      pushTapeUndo();
      sl.markers = []; sl.selSeg = 0; syncSlicer();
    }, "Remove all slice markers");
    var trimBtn = opBtn("TRIM", slicerTrim, "Tighten the selected segment to the audio — trims leading/trailing silence");
    var cropBtn = opBtn("CROP", slicerCrop, "Keep only the selected segment: the tape becomes this chop");
    var undoBtn = opBtn("UNDO", slicerUndo, "Undo the last trim, crop, or clear");
    var panicBtn = opBtn("PANIC", panic, "Stop all sound immediately");
    panicBtn.classList.add("panic");

    var chipsLab = el("div", "ed-flab", panel);
    chipsLab.textContent = "SEGMENTS — TAP TO HEAR";
    var chips = el("div", "seg-chips", panel);

    var assign = el("div", "assign-row", panel);
    var alab = el("span", "lab", assign); alab.textContent = "\u2192 PAD";
    var padBtns = [];
    for (var i = 0; i < PAD_DEFS.length; i++) {
      (function (pi) {
        var b = el("button", "btn", assign);
        b.textContent = String(pi + 1);
        b.setAttribute("aria-label", "Load selected segment onto pad " + (pi + 1));
        b.addEventListener("click", function () { sliceToPad(pi); });
        padBtns.push(b);
      })(i);
    }

    var hint = el("div", "ed-hint", panel);
    hint.textContent = "Click the waveform to drop a marker \u00b7 drag markers to move them \u00b7 double-click a marker to remove it \u00b7 tap a segment to hear it, then pick a pad.";

    sl = {
      root: root, title: title, canvas: cv, info: info, chips: chips,
      nInput: nInput, fileInput: fileInput, padBtns: padBtns,
      tape: null, tapeName: "", markers: [], selSeg: 0, chipBtns: [],
      dragIdx: -1, auditionSrc: null, tapeUndo: [], peaks: null,
      trimBtn: trimBtn, cropBtn: cropBtn, undoBtn: undoBtn, panicBtn: panicBtn,
    };

    // marker interactions on the waveform
    function frac(e) {
      var r = (cv.getBoundingClientRect) ? cv.getBoundingClientRect() : { left: 0, width: cv.width };
      var cx = (e.clientX - r.left) / (r.width || 1);
      return clamp(cx, 0, 1);
    }
    function markerNear(f) {
      var best = -1, bd = 12 / (cv.width || 640);
      for (var i = 0; i < sl.markers.length; i++) {
        var d = Math.abs(sl.markers[i] - f);
        if (d < bd && (best < 0 || d < Math.abs(sl.markers[best] - f))) best = i;
      }
      return best;
    }
    cv.addEventListener("pointerdown", function (e) {
      if (!sl.tape) return;
      var f = frac(e);
      var mi = markerNear(f);
      if (mi >= 0) {
        sl.dragIdx = mi;
      } else {
        sl.markers.push(clamp(f, 0.002, 0.998));
        sl.dragIdx = -1;
        // select the segment under the click
        var segs = slicerSegments();
        var s = Math.floor(f * sl.tape.length);
        for (var i = 0; i < segs.length; i++) {
          if (s >= segs[i].start && s < segs[i].end) { sl.selSeg = i; break; }
        }
        rebuildChips();
        auditionSegment(sl.selSeg);
      }
      if (e.preventDefault) e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      if (sl.dragIdx < 0 || !sl.tape) return;
      sl.markers[sl.dragIdx] = clamp(frac(e), 0.002, 0.998);
      requestSlicerDraw();
    });
    cv.addEventListener("pointerup", function () {
      if (sl.dragIdx >= 0) { sl.dragIdx = -1; syncSlicer(); }
    });
    cv.addEventListener("dblclick", function (e) {
      if (!sl.tape) return;
      var mi = markerNear(frac(e));
      if (mi >= 0) { sl.markers.splice(mi, 1); sl.selSeg = 0; syncSlicer(); }
    });
  }

  function openSlicer() {
    closeProjPanel();
    if (!sl) buildSlicer();
    syncSlicer();
    sl.root.style.display = "flex";
  }
  function closeSlicer() {
    if (sl) sl.root.style.display = "none";
  }

  // ---------------- tape arranger overlay ----------------
  var tp = null; // lazily built tape overlay handles

  function buildTape() {
    var root = el("div", "overlay", document.body);
    root.style.display = "none";
    var panel = el("div", "editor tape", root);
    var head = el("div", "ed-head", panel);
    var title = el("div", "ed-title", head);
    title.textContent = "TAPE ARRANGER";
    var x = el("button", "btn ed-x", head);
    x.textContent = "\u00d7";
    x.setAttribute("aria-label", "Close tape arranger");
    x.addEventListener("click", closeTape);
    root.addEventListener("click", function (e) { if (e.target === root) closeTape(); });

    var bar = el("div", "tp-bar", panel);
    var barsBtn = el("button", "btn", bar);
    barsBtn.setAttribute("aria-label", "Bounce length in bars");
    barsBtn.addEventListener("click", function () {
      ui.tapeBars = ui.tapeBars >= 4 ? 1 : ui.tapeBars * 2;
      paintTape();
    });
    var playAll = el("button", "btn", bar);
    playAll.textContent = "\u25b6 ALL";
    playAll.setAttribute("aria-label", "Play all unmuted tape tracks");
    playAll.addEventListener("click", tapePlayAll);
    var stopAll = el("button", "btn", bar);
    stopAll.textContent = "\u25a0 STOP";
    stopAll.setAttribute("aria-label", "Stop all tape tracks");
    stopAll.addEventListener("click", tapeStopAll);

    var tracksEl = el("div", "tp-tracks", panel);
    var rows = [];
    for (var i = 0; i < TAPE_COUNT; i++) {
      (function (ti) {
        var tr = el("div", "tp-track", tracksEl);
        var thead = el("div", "tp-thead", tr);
        var tname = el("div", "tp-tname", thead);
        var tstatus = el("div", "tp-status", thead);
        var cv = el("canvas", "tp-wave", tr);
        cv.width = 560; cv.height = 64;
        var tops = el("div", "tp-tops", tr);
        function tbtn(label, fn, aria) {
          var b = el("button", "btn", tops);
          b.textContent = label;
          b.setAttribute("aria-label", aria || label);
          b.addEventListener("click", function () { fn(ti); });
          return b;
        }
        var bounceBtn = tbtn("BOUNCE", bounceToTape, "Bounce the pattern onto this track");
        var muteBtn = tbtn("MUTE", tapeToggleMute, "Mute this track");
        var sliceBtn = tbtn("\u2192SLICER", tapeToSlicer, "Send this track to the tape slicer");
        var clearBtn = tbtn("CLEAR", tapeClear, "Clear this track");
        var lvl = makeSlider(tr, "LEVEL", 0, 100, 1, 80,
          function (v) { return Math.round(v) + "%"; },
          function (v) { tapeSetLevel(ti, v / 100); });
        rows.push({ root: tr, name: tname, status: tstatus, canvas: cv,
                    bounceBtn: bounceBtn, muteBtn: muteBtn, sliceBtn: sliceBtn,
                    clearBtn: clearBtn, level: lvl });
      })(i);
    }

    var hint = el("div", "ed-hint", panel);
    hint.textContent = "BOUNCE renders the current pattern (swing, choke, mono, filters, delay) to tape and loops it. Tracks loop independently — layer them under the live sequencer. Tapes live in memory until reload.";

    tp = { root: root, title: title, barsBtn: barsBtn, rows: rows };
    ui.tapeBars = ui.tapeBars || 2;
    paintTape();
  }

  function openTape() {
    closeProjPanel();
    if (!tp) buildTape();
    tp.root.style.display = "flex";
    paintTape();
  }

  function closeTape() {
    if (tp) tp.root.style.display = "none";
  }

  function tapeDurStr(t) {
    if (!t.buffer) return "";
    var sec = t.buffer.duration;
    if (typeof sec !== "number") {
      var ch0 = null;
      try { ch0 = t.buffer.getChannelData(0); } catch (e) {}
      sec = ch0 ? ch0.length / (t.buffer.sampleRate || 44100) : 0;
    }
    return t.bars + (t.bars === 1 ? " bar" : " bars") + " \u00b7 " + t.bpm + " BPM \u00b7 " + sec.toFixed(1) + "s";
  }

  function paintTape() {
    if (!tp) return;
    tp.barsBtn.textContent = "BARS " + (ui.tapeBars || 2);
    for (var i = 0; i < TAPE_COUNT; i++) {
      var t = state.tapes[i], r = tp.rows[i];
      if (!t) continue;
      r.name.textContent = t.name;
      r.status.textContent = t.bouncing ? "BOUNCING\u2026" :
        t.bounceError ? "RENDER FAILED" :
        t.buffer ? tapeDurStr(t) : "EMPTY";
      r.root.classList.toggle("playing", !!t._src);
      r.bounceBtn.textContent = t.bouncing ? "\u2026" : "BOUNCE";
      r.muteBtn.classList.toggle("on", t.muted);
      r.sliceBtn.classList.toggle("dim", !t.buffer);
      r.level.set(t.level * 100);
    }
  }

  function drawTapeWave(i) {
    if (!tp) return;
    var t = state.tapes[i], cv = tp.rows[i].canvas;
    var g2d = cv.getContext && cv.getContext("2d");
    if (!g2d) return;
    var W = cv.width, H = cv.height;
    g2d.fillStyle = "#060907";
    g2d.fillRect(0, 0, W, H);
    if (!t || !t.buffer) return;
    var d = t.buffer.getChannelData(0);
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
      g2d.lineTo(x + 0.5, mid - mn * amp + 1);
    }
    g2d.stroke();
  }

  function syncSlicer() {
    if (!sl) return;
    sl.title.textContent = "TAPE SLICER" + (sl.tapeName ? " — " + sl.tapeName : "");
    drawSlicerWave();
    rebuildChips();
    updateSlicerInfo();
  }

  function drawSlicerWave() {
    if (!sl) return;
    var cv = sl.canvas;
    var g2d = cv.getContext && cv.getContext("2d");
    if (!g2d) return;
    var W = cv.width, H = cv.height;
    g2d.fillStyle = "#060907";
    g2d.fillRect(0, 0, W, H);
    if (!sl.tape) {
      g2d.fillStyle = "#8f959d";
      g2d.font = "11px sans-serif";
      g2d.textAlign = "center";
      g2d.fillText("LOAD A TAPE TO START CHOPPING", W / 2, H / 2);
      return;
    }
    var d = sl.tape, mid = H / 2, amp = H * 0.44;
    // shade the selected segment
    var segs = slicerSegments();
    var seg = segs[Math.min(sl.selSeg, segs.length - 1)];
    if (seg) {
      g2d.fillStyle = "rgba(255,176,0,0.10)";
      g2d.fillRect(seg.start / d.length * W, 0, (seg.end - seg.start) / d.length * W, H);
    }
    // waveform from the precomputed peak cache: O(canvas width), never O(tape)
    var pk = sl.peaks;
    if (pk) {
      g2d.strokeStyle = "#ffb000";
      g2d.lineWidth = 1;
      g2d.beginPath();
      for (var x = 0; x < W; x++) {
        var c = Math.min(pk.cols - 1, (x * pk.cols / W) | 0);
        g2d.moveTo(x + 0.5, mid - pk.max[c] * amp);
        g2d.lineTo(x + 0.5, mid - pk.min[c] * amp + 0.5);
      }
      g2d.stroke();
    }
    // markers: one batched stroke; numbers only when sparse enough to read
    var marks = sl.markers.slice().sort(function (p, q) { return p - q; });
    g2d.strokeStyle = "#ffd47a";
    g2d.lineWidth = 1.5;
    g2d.beginPath();
    for (var m = 0; m < marks.length; m++) {
      var mxp = marks[m] * W;
      g2d.moveTo(mxp, 0);
      g2d.lineTo(mxp, H);
    }
    g2d.stroke();
    if (marks.length <= 96) {
      g2d.font = "9px sans-serif";
      g2d.textAlign = "left";
      g2d.fillStyle = "#ffd47a";
      for (var m2 = 0; m2 < marks.length; m2++) {
        g2d.fillText(String(m2 + 1), marks[m2] * W + 3, 11);
      }
    }
  }

  // Min/max peak cache over the tape, built once per tape load. Drawing the
  // waveform then costs O(canvas width) instead of O(tape samples), which is
  // what keeps marker drags smooth on song-length tapes.
  function buildTapePeaks() {
    if (!sl || !sl.tape) { if (sl) sl.peaks = null; return; }
    var d = sl.tape, n = d.length, COLS = 2048;
    var mn = new Float32Array(COLS), mx = new Float32Array(COLS);
    for (var c = 0; c < COLS; c++) {
      var a = Math.floor(c / COLS * n), b = Math.max(a + 1, Math.floor((c + 1) / COLS * n));
      var lo = 1, hi = -1;
      for (var k = a; k < b && k < n; k++) {
        var v = d[k];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi < lo) { lo = 0; hi = 0; }
      mn[c] = lo; mx[c] = hi;
    }
    sl.peaks = { min: mn, max: mx, cols: COLS };
  }

  // Redraw at most once per animation frame while dragging a marker, so a
  // burst of pointermove events can't queue up expensive redraws.
  function requestSlicerDraw() {
    if (!sl || sl._drawQueued) return;
    sl._drawQueued = true;
    var raf = (typeof requestAnimationFrame === "function") ? requestAnimationFrame : function (fn) { fn(); return 0; };
    raf(function () { if (sl) sl._drawQueued = false; drawSlicerWave(); });
  }

  function rebuildChips() {
    if (!sl) return;
    var segs = slicerSegments();
    var sr = DSP.SYNTH_RATE;
    if (sl.chipBtns.length === segs.length && segs.length > 0) {
      // same segment count: refresh labels in place, no DOM churn
      for (var i = 0; i < segs.length; i++) {
        sl.chipBtns[i].textContent = (i + 1) + "  " + (segs[i].start / sr).toFixed(2) + "\u2013" + (segs[i].end / sr).toFixed(2) + "s";
      }
    } else {
      sl.chips.innerHTML = "";
      sl.chipBtns = [];
      if (!segs.length) return;
      for (var j = 0; j < segs.length; j++) {
        (function (idx) {
          var b = el("button", "seg-chip", sl.chips);
          b.textContent = (idx + 1) + "  " + (segs[idx].start / sr).toFixed(2) + "\u2013" + (segs[idx].end / sr).toFixed(2) + "s";
          b.setAttribute("aria-label", "Audition segment " + (idx + 1));
          b.addEventListener("click", function () { auditionSegment(idx); });
          sl.chipBtns.push(b);
        })(j);
      }
    }
    paintChips();
  }
  function paintChips() {
    if (!sl) return;
    for (var i = 0; i < sl.chipBtns.length; i++) {
      sl.chipBtns[i].classList.toggle("sel", i === sl.selSeg);
    }
  }

  function updateSlicerInfo() {
    if (!sl) return;
    if (!sl.tape) {
      sl.info.textContent = "no tape loaded \u00b7 pick a long sample and chop it across the pads";
      return;
    }
    var segs = slicerSegments();
    var secs = sl.tape.length / DSP.SYNTH_RATE;
    var s = segs[Math.min(sl.selSeg, segs.length - 1)];
    sl.info.textContent = secs.toFixed(2) + "s \u00b7 " + segs.length + " segments" +
      (s ? " \u00b7 seg " + (Math.min(sl.selSeg, segs.length - 1) + 1) + ": " +
        (s.start / DSP.SYNTH_RATE).toFixed(2) + "–" + (s.end / DSP.SYNTH_RATE).toFixed(2) + "s" : "");
  }

  function auditionSegment(i) {
    var segs = slicerSegments();
    if (!segs[i] || !sl.tape) return;
    sl.selSeg = i;
    paintChips();
    drawSlicerWave();
    updateSlicerInfo();
    ensureAudio();
    // single-audio preview: a new audition cuts off any still-ringing one
    // so previewing slices never clashes with itself
    if (sl.auditionSrc) { try { sl.auditionSrc.stop(); } catch (e) {} }
    // subarray: zero-copy view; copyToChannel does the one unavoidable copy
    var cut = sl.tape.subarray(segs[i].start, segs[i].end);
    var buf = ctx.createBuffer(1, cut.length, DSP.SYNTH_RATE);
    buf.copyToChannel(cut, 0);
    var src = ctx.createBufferSource();
    sl.auditionSrc = src;
    src.buffer = buf;
    var g = ctx.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(masterGain);
    src.start();
  }

  function stopSlicerAudition() {
    if (sl && sl.auditionSrc) {
      try { sl.auditionSrc.stop(); } catch (e) {}
      sl.auditionSrc = null;
    }
  }

  // Destructive tape ops (trim/crop/clear) push the pre-op state here.
  function pushTapeUndo() {
    if (!sl || !sl.tape) return;
    sl.tapeUndo.push({
      tape: sl.tape.slice(), markers: sl.markers.slice(),
      tapeName: sl.tapeName, selSeg: sl.selSeg,
    });
    if (sl.tapeUndo.length > 12) sl.tapeUndo.shift();
  }
  function slicerUndo() {
    if (!sl || !sl.tapeUndo.length) return;
    stopSlicerAudition();
    var u = sl.tapeUndo.pop();
    sl.tape = u.tape; sl.markers = u.markers; sl.tapeName = u.tapeName;
    sl.selSeg = Math.min(u.selSeg, Math.max(0, slicerSegments().length - 1));
    buildTapePeaks();
    syncSlicer();
  }

  function slicerTrim() {
    // Tighten the selected segment: move its bounding markers inward to the
    // first/last sample above the silence threshold. Tape edges have no
    // marker, so they stay put.
    var segs = slicerSegments();
    var i = Math.min(sl.selSeg, segs.length - 1);
    if (!sl || !sl.tape || !segs[i]) return;
    var d = sl.tape, n = d.length, seg = segs[i], TH = 0.02, MINLEN = 64;
    var s = seg.start, e = seg.end;
    while (s < e - MINLEN && Math.abs(d[s]) < TH) s++;
    while (e > s + MINLEN && Math.abs(d[e - 1]) < TH) e--;
    if (s === seg.start && e === seg.end) {
      updateSlicerInfo();
      sl.info.textContent += " · already tight, nothing to trim";
      return;
    }
    pushTapeUndo();
    var eps = 2 / n, f0 = seg.start / n, f1 = seg.end / n;
    for (var k = 0; k < sl.markers.length; k++) {
      if (Math.abs(sl.markers[k] - f0) < eps) sl.markers[k] = s / n;
      else if (Math.abs(sl.markers[k] - f1) < eps) sl.markers[k] = e / n;
    }
    sl.selSeg = i;
    stopSlicerAudition();
    syncSlicer();
  }

  function slicerCrop() {
    // The tape becomes the selected segment; everything else is discarded.
    var segs = slicerSegments();
    var i = Math.min(sl.selSeg, segs.length - 1);
    if (!sl || !sl.tape || !segs[i]) return;
    pushTapeUndo();
    sl.tape = sl.tape.slice(segs[i].start, segs[i].end);
    sl.markers = [];
    sl.selSeg = 0;
    stopSlicerAudition();
    buildTapePeaks();
    syncSlicer();
  }

  function sliceToPad(padIdx) {
    var segs = slicerSegments();
    if (!segs.length || !sl.tape) return;
    sl.selSeg = Math.min(sl.selSeg, segs.length - 1);
    var seg = segs[sl.selSeg];
    var cut = sl.tape.slice(seg.start, seg.end);
    if (cut.length < 64) return;
    DSP.normalize(cut, 0.92);
    var p = state.pads[padIdx];
    pushUndo(p);
    p.dataClean = cut;
    refreshSample(padIdx); // re-derive the 12-bit SP buffer
    p.customName = ("SLC " + (sl.selSeg + 1)).slice(0, 12).toUpperCase();
    ui.padNames[padIdx].textContent = p.customName;
    p.selStart = 0; p.selEnd = 1;
    playPad(padIdx); // audition the chop through the SP path
    save();
    updateSlicerInfo();
  }

  function slicerEqual() {
    if (!sl || !sl.tape) return;
    var n = clamp(parseInt(sl.nInput.value, 10) || 8, 2, 64);
    sl.nInput.value = n;
    sl.markers = [];
    for (var i = 1; i < n; i++) sl.markers.push(i / n);
    sl.selSeg = 0;
    syncSlicer();
  }

  function slicerAuto() {
    if (!sl || !sl.tape) return;
    var on = DSP.detectOnsets(sl.tape, DSP.SYNTH_RATE);
    sl.markers = [];
    for (var i = 0; i < on.length; i++) {
      var f = on[i] / sl.tape.length;
      if (f > 0.005 && f < 0.995) sl.markers.push(f);
    }
    sl.selSeg = 0;
    syncSlicer();
  }

  function loadTapeFile(file) {
    ensureAudio();
    var rd = new FileReader();
    rd.onload = function () {
      var done = function (audioBuf) {
        var ch = audioBuf.getChannelData(0);
        slicerSetTape(DSP.resampleLinear(ch, audioBuf.sampleRate, DSP.SYNTH_RATE),
          (file.name || "tape").replace(/\.\w+$/, ""));
      };
      try {
        var r = ctx.decodeAudioData(rd.result);
        if (r && r.then) r.then(done, function () {});
        else ctx.decodeAudioData(rd.result, done, function () {});
      } catch (e) { /* unreadable file */ }
    };
    rd.readAsArrayBuffer(file);
  }

  // Test hook + shared entry: install already-decoded tape data (at 44.1 kHz).
  function slicerSetTape(data, name) {
    if (!sl) buildSlicer();
    var clean = Float32Array.from(data);
    DSP.normalize(clean, 0.92);
    sl.tape = clean;
    sl.tapeName = String(name || "tape").replace(/\.\w+$/, "").slice(0, 18).toUpperCase();
    sl.markers = [];
    sl.selSeg = 0;
    sl.tapeUndo = [];
    sl.auditionSrc = null;
    buildTapePeaks();
    syncSlicer();
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
    if (ui.koStepNum) ui.koStepNum.textContent = "--";
    if (ui.koLcd) ui.koLcd.classList.remove("playing");
  }
  function highlightStep(step) {
    clearPlayhead();
    for (var i = 0; i < ui.stepBtns.length; i++) ui.stepBtns[i][step].classList.add("now");
    if (ui.koStepNum) ui.koStepNum.textContent = (step < 9 ? "0" : "") + (step + 1);
    if (ui.koLcd) ui.koLcd.classList.add("playing");
  }
  // EP-133 module LCD: live BPM / swing readout.
  function paintKoMeta() {
    if (!ui.koMeta) return;
    ui.koMeta.textContent = Math.round(state.bpm) + " BPM \u00B7 SW " + state.swing.toFixed(1) + "%";
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
    ui.playBtn.setAttribute("aria-label", "Play drums + tape");
    ui.playBtn.addEventListener("click", function () {
      if (state.playing || anyTapePlaying()) globalStop(); else globalPlay();
    });

    ui.panicBtn = el("button", "btn panic", transport);
    ui.panicBtn.textContent = "PANIC";
    ui.panicBtn.title = "Stop all sound immediately";
    ui.panicBtn.setAttribute("aria-label", "Stop all sounds immediately");
    ui.panicBtn.addEventListener("click", panic);

    ui.tempo = makeSlider(transport, "TEMPO", 60, 200, 1, state.bpm,
      function (v) { return Math.round(v) + " BPM"; },
      function (v) { state.bpm = Math.round(v); paintKoMeta(); save(); });
    ui.swing = makeSlider(transport, "SWING", 50, 75, 0.5, state.swing,
      function (v) { return v.toFixed(1) + "%"; },
      function (v) { state.swing = v; paintKoMeta(); save(); });

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
        paintKoMeta();
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

    ui.sliceBtn = el("button", "btn", transport);
    ui.sliceBtn.textContent = "SLICE";
    ui.sliceBtn.title = "Chop a long sample into pad-ready segments";
    ui.sliceBtn.setAttribute("aria-label", "Open the tape slicer");
    ui.sliceBtn.addEventListener("click", openSlicer);

    ui.tapeBtn = el("button", "btn", transport);
    ui.tapeBtn.textContent = "TAPE";
    ui.tapeBtn.title = "Bounce the pattern to tape and layer 4 tape tracks";
    ui.tapeBtn.setAttribute("aria-label", "Open the tape arranger");
    ui.tapeBtn.addEventListener("click", openTape);

    ui.projBtn = el("button", "btn", transport);
    ui.projBtn.textContent = "PROJECT";
    ui.projBtn.title = "Save / load named projects";
    ui.projBtn.setAttribute("aria-label", "Open project save and load");
    ui.projBtn.addEventListener("click", toggleProjPanel);

    ui.projPanel = el("div", "proj-panel", transport);
    ui.projPanel.style.display = "none";
    ui.projPanel.setAttribute("role", "dialog");
    ui.projPanel.setAttribute("aria-label", "Project save and load");
    var prow = el("div", "proj-row", ui.projPanel);
    ui.projName = el("input", "proj-name", prow);
    ui.projName.placeholder = "PROJECT NAME";
    ui.projName.maxLength = 40;
    ui.projName.setAttribute("aria-label", "Project name");
    ui.projName.addEventListener("keydown", function (e) {
      if (e.code === "Enter" || e.key === "Enter") { saveProject(ui.projName.value); ui.projName.value = ""; }
      else if (e.code === "Escape") { if (ui.projName.blur) ui.projName.blur(); closeProjPanel(); }
      if (e.stopPropagation) e.stopPropagation();
    });
    var saveB = el("button", "btn", prow);
    saveB.textContent = "SAVE";
    saveB.setAttribute("aria-label", "Save project under this name");
    saveB.addEventListener("click", function () { saveProject(ui.projName.value); ui.projName.value = ""; });
    var xrow = el("div", "proj-row", ui.projPanel);
    var expB = el("button", "btn", xrow);
    expB.textContent = "EXPORT";
    expB.title = "Download this project as a .sp1200.json file";
    expB.setAttribute("aria-label", "Export project to a file");
    expB.addEventListener("click", exportProject);
    var impB = el("button", "btn", xrow);
    impB.textContent = "IMPORT";
    impB.title = "Load a project from a .sp1200.json file";
    impB.setAttribute("aria-label", "Import project from a file");
    impB.addEventListener("click", function () { if (ui.projFile) ui.projFile.click(); });
    ui.projFile = el("input", "", ui.projPanel);
    ui.projFile.type = "file";
    ui.projFile.accept = ".sp1200.json,.json,application/json";
    ui.projFile.style.display = "none";
    ui.projFile.setAttribute("aria-label", "Choose a project file to import");
    ui.projFile.addEventListener("change", function () {
      if (ui.projFile.files && ui.projFile.files[0]) importProjectFile(ui.projFile.files[0]);
      ui.projFile.value = "";
    });
    ui.projStatus = el("div", "proj-status", ui.projPanel);
    ui.projStatus.setAttribute("aria-live", "polite");
    ui.projList = el("div", "proj-list", ui.projPanel);
    var nrow = el("div", "proj-row", ui.projPanel);
    var newB = el("button", "btn", nrow);
    newB.textContent = "NEW";
    newB.title = "Clear everything and start a fresh project";
    newB.setAttribute("aria-label", "Start a new project");
    newB.addEventListener("click", newProject);

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
      var modeBtn = el("button", "btn", row2);
      modeBtn.setAttribute("aria-label", "Toggle mono/poly voice mode for " + def.name);
      modeBtn.addEventListener("click", function () {
        var p = state.pads[i];
        p.voiceMode = p.voiceMode === "mono" ? "poly" : "mono";
        paintVoiceMode(i);
        save();
      });
      var chokeBtn = el("button", "btn", row2);
      chokeBtn.setAttribute("aria-label", "Cycle choke group for " + def.name);
      chokeBtn.addEventListener("click", function () {
        var p = state.pads[i];
        p.choke = (p.choke + 1) % 4;  // off -> A -> B -> C -> off
        paintChoke(i);
        save();
      });

      ui["padTune" + i] = tune; ui["padLevel" + i] = level; ui["padMute" + i] = muteBtn;
      ui["padEdit" + i] = editBtn; ui["padFlt" + i] = fltBtn;
      ui["padMode" + i] = modeBtn; ui["padChoke" + i] = chokeBtn;
      setFilterType(i, state.pads[i].filterType);
      paintVoiceMode(i);
      paintChoke(i);
    });

    // ---- sequencer: EP-133 "K.O." composer module ----
    var st = el("div", "section-title", app); st.textContent = "PROGRAMMING";
    var seq = el("div", "seq", app);
    el("div", "ko-grille", seq);
    var koHead = el("div", "ko-head", seq);
    var koTitle = el("div", "ko-title", koHead); koTitle.textContent = "STEP COMPOSER";
    var koSub = el("small", "", koTitle); koSub.textContent = "16 STEP \u00B7 8 VOICE";
    var koTabs = el("div", "ko-tabs", koHead);
    ["OUTPUT", "INPUT", "MIDI", "USB"].forEach(function (t, ti) {
      var tb = el("span", "", koTabs); tb.textContent = t;
      if (ti === 1) tb.classList.add("hot");
    });
    var lcd = el("div", "ko-lcd", seq);
    ui.koLcd = lcd;
    var barTag = el("span", "bar-tag", lcd); barTag.textContent = "BAR";
    var digits = el("div", "digits", lcd);
    ui.koStepNum = el("span", "", digits); ui.koStepNum.textContent = "--";
    var slash = el("small", "", digits); slash.textContent = " / 16";
    el("span", "play-dot", lcd);
    ui.koMeta = el("div", "meta", lcd);
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
          b.textContent = String(si + 1);
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
    paintKoMeta();

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
    foot.innerHTML = "<kbd>Space</kbd> play / stop &nbsp;·&nbsp; <kbd>1</kbd>–<kbd>8</kbd> trigger pads &nbsp;·&nbsp; click steps to program &nbsp;·&nbsp; LOAD puts your own samples through the 12-bit path &nbsp;·&nbsp; SLICE chops a long sample across the pads &nbsp;·&nbsp; MONO / CHK voice modes per strip &nbsp;·&nbsp; delay lives in EDIT &nbsp;·&nbsp; TAPE bounces the pattern to a 4-track loop &nbsp;·&nbsp; play runs drums + tape together &nbsp;·&nbsp; PANIC kills all sound &nbsp;·&nbsp; PROJECT saves / loads / exports / imports";

    // ---- keyboard ----
    document.addEventListener("keydown", function (e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.code === "Escape") { closeEditor(); closeSlicer(); closeTape(); closeProjPanel(); return; }
      if (e.code === "Space") {
        e.preventDefault();
        if (state.playing || anyTapePlaying()) globalStop(); else globalPlay();
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

  // Push the whole state into every control: transport, strips, grid, tapes.
  function syncUIFromState() {
    ui.tempo.set(state.bpm);
    ui.swing.set(state.swing);
    paintKoMeta();
    ui.master.set(state.master);
    ui.spBtn.classList.toggle("on", state.spMode);
    state.pads.forEach(function (p, i) {
      ui["padTune" + i].set(p.tune * 100);
      ui["padLevel" + i].set(p.level * 100);
      ui["padMute" + i].classList.toggle("on", p.muted);
      setFilterType(i, p.filterType);
      paintVoiceMode(i);
      paintChoke(i);
      ui.padNames[i].textContent = p.customName || p.def.name;
      ui.padCards[i].classList.toggle("muted", p.muted);
      ui.seqRows[i].classList.toggle("muted", p.muted);
      ui.seqMutes[i].classList.toggle("on", p.muted);
      for (var s = 0; s < STEPS; s++) ui.stepBtns[i][s].classList.toggle("on", !!state.pattern[i][s]);
    });
    paintTape();
    for (var ti = 0; ti < TAPE_COUNT; ti++) drawTapeWave(ti);
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
        voiceMode: "poly",
        choke: (def.id === "chat" || def.id === "ohat") ? 1 : 0,  // 0=off, 1..3 = groups A/B/C
        delay: { on: false, time: 0.32, feedback: 0.35, mix: 0.3 },
        selStart: 0, selEnd: 1, _undo: null, _voices: [], _delay: null,
      });
      state.pattern.push(new Array(STEPS).fill(0));
    });
    for (var ti = 0; ti < TAPE_COUNT; ti++) state.tapes.push(freshTape(ti));
    load();
    // pattern empty after load? fall back to Boom Bap factory groove
    var any = state.pattern.some(function (row) { return row.some(Boolean); });
    buildUI();
    if (!any) applyPreset("Boom Bap");
    else syncUIFromState(); // reflect loaded state in the freshly built UI
  }

  // expose for tests
  var api = { init: init, state: state, ui: ui, applyPreset: applyPreset, PAD_DEFS: PAD_DEFS, PRESETS: PRESETS,
    _playPad: function (i, w) { return playPad(i, w); },
    _scheduleStep: function (s, t) { return scheduleStep(s, t); },
    _start: startTransport, _stop: stopTransport,
    _setFilterType: setFilterType, _cycleFilter: cycleFilter,
    _openEditor: openEditor, _closeEditor: closeEditor,
    _refreshSample: refreshSample, _drawWave: drawWave,
    _openSlicer: openSlicer, _closeSlicer: closeSlicer,
    _slicerSetTape: slicerSetTape, _slicerEqual: slicerEqual, _slicerAuto: slicerAuto,
    _slicerSegments: slicerSegments, _auditionSegment: auditionSegment, _sliceToPad: sliceToPad,
    _slicerTrim: slicerTrim, _slicerCrop: slicerCrop, _slicerUndo: slicerUndo,
    _slicer: function () { return sl; },
    _editor: function () { return ed; }, _paintChoke: paintChoke, _paintVoiceMode: paintVoiceMode,
    _openTape: openTape, _closeTape: closeTape, _tape: function () { return tp; },
    _renderPattern: renderPattern, _bounceToTape: bounceToTape,
    _tapePlay: tapePlay, _tapeStop: tapeStop, _tapePlayAll: tapePlayAll, _tapeStopAll: tapeStopAll,
    _tapeToSlicer: tapeToSlicer,
    _globalPlay: globalPlay, _globalStop: globalStop, _panic: panic,
    _anyTapePlaying: anyTapePlaying, _paintTransport: paintTransport,
    _saveProject: saveProject, _loadProject: loadProject, _deleteProject: deleteProject,
    _listProjects: loadProjectIndex, _paintProjects: paintProjects,
    _exportProject: exportProject, _importProjectFile: importProjectFile,
    _projectFileName: projectFileName,
    _serializeProject: serializeProject, _syncUI: syncUIFromState,
    _f32ToPcm16B64: f32ToPcm16B64, _pcm16B64ToF32: pcm16B64ToF32 };
  if (typeof window !== "undefined") window.SP1200 = api;
  else globalThis.SP1200 = api;

  if (typeof document !== "undefined" && document.addEventListener) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
