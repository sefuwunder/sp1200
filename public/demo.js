/* SP-1200 DEMOSCENE EDITION — a 100% keyboard-driven demo-scene interface.
   No mouse. No menus. Just keys, copper bars and 12-bit drums.
   Audio: reuses the battle-tested dsp.js (12-bit SP path, Roger Linn swing). */
(function () {
"use strict";
var DSP = window.DSP;
var W = 480, H = 270;

/* ============================== state ============================== */
var PADS = [
  { id: "kick",   name: "KICK",  key: "A" },
  { id: "snare",  name: "SNARE", key: "S" },
  { id: "clap",   name: "CLAP",  key: "D" },
  { id: "rim",    name: "RIM",   key: "F" },
  { id: "chat",   name: "HAT",   key: "J" },
  { id: "ohat",   name: "OHAT",  key: "K" },
  { id: "tom",    name: "TOM",   key: "L" },
  { id: "shaker", name: "SHAKR", key: ";" },
];
var STEPS = 16;
var pattern = [];   // 8 x 16 booleans
var muted = [];
var bpm = 96, swing = 56;
var cursor = { pad: 0, step: 0 };
var playing = false;
var patternName = "EMPTY";
var showHelp = false;
var splash = true;  // first keypress boots the audio + dismisses

function blankPattern() {
  var p = [];
  for (var i = 0; i < 8; i++) { p.push([]); for (var s = 0; s < STEPS; s++) p[i].push(false); }
  return p;
}
pattern = blankPattern();
for (var mi = 0; mi < 8; mi++) muted.push(false);

var PRESETS = {
  "1": { name: "BOOM BAP", rows: [
    [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],
    [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0],
    [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0],
  ]},
  "2": { name: "HOUSE", rows: [
    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
    [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
    [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,1],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  ]},
  "3": { name: "BREAKBEAT", rows: [
    [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0],
    [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
    [0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0],
    [1,1,0,1,0,1,0,1,1,0,1,0,1,0,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
    [0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0],
    [1,0,1,0,1,0,1,0,1,0,1,0,1,1,0,1],
  ]},
  "4": { name: "TECHNO", rows: [
    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
    [0,0,0,1,0,0,0,1,0,0,0,1,0,0,1,0],
    [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    [0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0],
    [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
  ]},
};

function loadPreset(n) {
  var pr = PRESETS[n];
  if (!pr) return;
  pattern = blankPattern();
  for (var i = 0; i < 8; i++) for (var s = 0; s < STEPS; s++) pattern[i][s] = !!pr.rows[i][s];
  for (var m = 0; m < 8; m++) muted[m] = false;
  patternName = pr.name;
  save();
}
function randomize() {
  pattern = blankPattern();
  var density = [0.28, 0.22, 0.12, 0.12, 0.55, 0.18, 0.15, 0.45];
  for (var i = 0; i < 8; i++) for (var s = 0; s < STEPS; s++)
    pattern[i][s] = Math.random() < density[i];
  pattern[1][4] = true; pattern[1][12] = true; // keep the backbeat, we're not animals
  patternName = "CHAOS " + Math.floor(Math.random() * 90 + 10);
  save();
}

/* persistence — the demo remembers */
function save() {
  try {
    localStorage.setItem("sp1200-demo", JSON.stringify({ pattern: pattern, muted: muted, bpm: bpm, swing: swing, name: patternName }));
  } catch (e) { /* private mode etc. */ }
}
function restore() {
  try {
    var d = JSON.parse(localStorage.getItem("sp1200-demo") || "null");
    if (d && d.pattern && d.pattern.length === 8) {
      pattern = d.pattern; muted = d.muted || muted;
      bpm = d.bpm || bpm; swing = d.swing || swing; patternName = d.name || patternName;
    }
  } catch (e) {}
}
restore();

/* ============================== audio ============================== */
var ac = null, bufs = [];
function ensureAudio() {
  if (!ac) {
    var AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    for (var i = 0; i < 8; i++) {
      var data = DSP.SYNTHS_I16[PADS[i].id](); // Int16Array, 12-bit in 16-bit clothes
      var b = ac.createBuffer(1, data.length, DSP.SP_RATE);
      var ch = b.getChannelData(0);
      for (var n = 0; n < data.length; n++) ch[n] = data[n] / 2047;
      bufs[i] = b;
    }
  }
  if (ac.state === "suspended") ac.resume();
}

/* visual event queues — the renderer reads these against ac.currentTime */
var padFlashes = [];  // {pad, t}
var stepEvents = [];  // {step, t}
var pulse = 0;        // beat pulse 0..1, driven by kick hits

function hit(pad, when) {
  if (!ac || muted[pad]) return;
  var src = ac.createBufferSource();
  src.buffer = bufs[pad];
  var g = ac.createGain();
  g.gain.value = 0.9;
  src.connect(g); g.connect(ac.destination);
  src.start(when == null ? 0 : when);
  padFlashes.push({ pad: pad, t: when == null ? ac.currentTime : when });
  if (pad === 0) pulse = 1;
  if (padFlashes.length > 64) padFlashes.shift();
}

function fireStep(s, t) {
  for (var p = 0; p < 8; p++) if (pattern[p][s]) hit(p, t);
  stepEvents.push({ step: s, t: t });
  if (stepEvents.length > 32) stepEvents.shift();
}

/* lookahead scheduler with Roger Linn swing */
var step = 0, barStart = 0, timer = null;
function scheduler() {
  if (!playing) return;
  for (;;) {
    var t = barStart + DSP.stepTime16(step, bpm, swing);
    if (t > ac.currentTime + 0.15) break;
    fireStep(step, t);
    step++;
    if (step >= STEPS) { step = 0; barStart += STEPS * DSP.sixteenthDur(bpm); }
  }
}
function setPlaying(on) {
  ensureAudio();
  if (on && !playing) {
    playing = true; step = 0;
    barStart = ac.currentTime + 0.08;
    timer = setInterval(scheduler, 25);
  } else if (!on && playing) {
    playing = false;
    clearInterval(timer); timer = null;
  }
}

/* ============================== renderer ============================== */
var cv = document.getElementById("screen");
var ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = false;

var stars = [];
for (var si = 0; si < 110; si++)
  stars.push({ x: Math.random() * W, y: Math.random() * H, z: 0.2 + Math.random() * 0.8 });

var SCROLL = "      *** SP-1200 DEMOSCENE EDITION ***  100% KEYBOARD DRIVEN -- NO MOUSE REQUIRED, NO MOUSE WANTED ... " +
  "A S D F J K L ; FIRE THE PADS ... SPACE ROCKS THE SEQUENCER ... ARROWS + ENTER PROGRAM THE GRID ... " +
  "1-4 LOAD FACTORY BREAKS ... R SUMMONS CHAOS ... C CLEARS THE DECK ... M MUTES THE ROW ... " +
  "- / = TEMPO ... [ / ] SWING ... H FOR THE FULL KEY MAP ... " +
  "GREETINGS TO ALL 12-BIT FREAKS, TRACKER WARRIORS AND COPPER-BAR ROMANTICS ... " +
  "E-MU NEVER SAW THIS COMING ...      ";
var scrollX = 0;

var NEON = ["#00e5ff", "#ff2fd6", "#ffe14d", "#39ff6a"];
function neonAt(t, i) { return NEON[Math.floor(t * 2 + i) % NEON.length]; }

function drawStarfield(t, dt) {
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, W, H);
  var spd = (1 + pulse * 6) * dt * 60;
  for (var i = 0; i < stars.length; i++) {
    var st = stars[i];
    st.x -= st.z * spd * 0.35;
    if (st.x < 0) { st.x = W; st.y = Math.random() * H; }
    var b = Math.floor(60 + st.z * 160 + pulse * 40);
    ctx.fillStyle = "rgb(" + b + "," + b + "," + Math.min(255, b + 40) + ")";
    var sz = st.z > 0.7 ? 2 : 1;
    ctx.fillRect(st.x | 0, st.y | 0, sz, sz);
  }
}

/* copper bars: horizontal gradient bands drifting vertically */
function copperBand(y, hgt, c1, c2) {
  for (var y0 = 0; y0 < hgt; y0++) {
    var f = y0 / hgt;
    ctx.fillStyle = "rgba(" +
      Math.floor(8 + f * 40) + "," + Math.floor(8 + f * 60) + "," + Math.floor(30 + f * 120) + ",0.55)";
    ctx.fillRect(0, Math.floor(y + y0), W, 1);
  }
  void c1; void c2;
}
function drawCopper(t) {
  var y1 = 30 + Math.sin(t * 0.9) * 14 + pulse * 6;
  var y2 = 218 + Math.cos(t * 0.7) * 10 - pulse * 4;
  copperBand(y1, 10, 0, 0);
  copperBand(y2, 8, 0, 0);
}

/* raster bars bouncing behind the logo */
function drawRasters(t) {
  var bars = [
    { sp: 1.7, ph: 0.0, c: "#ff2fd6" },
    { sp: 2.3, ph: 2.1, c: "#00e5ff" },
    { sp: 1.3, ph: 4.2, c: "#ffe14d" },
  ];
  for (var i = 0; i < bars.length; i++) {
    var b = bars[i];
    var y = 44 + Math.sin(t * b.sp + b.ph) * 16;
    var g = ctx.createLinearGradient(0, y - 5, 0, y + 5);
    g.addColorStop(0, "#050510"); g.addColorStop(0.5, b.c); g.addColorStop(1, "#050510");
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, y - 5, W, 10);
    ctx.globalAlpha = 1;
  }
}

function drawLogo(t) {
  ctx.textAlign = "center";
  ctx.font = "bold 30px monospace";
  var grd = ctx.createLinearGradient(0, 14, 0, 46);
  grd.addColorStop(0, neonAt(t, 0)); grd.addColorStop(1, neonAt(t, 2));
  ctx.fillStyle = grd;
  ctx.fillText("SP-1200", W / 2, 40);
  ctx.font = "bold 9px monospace";
  ctx.fillStyle = "#8a8ab0";
  var sub = "D E M O S C E N E   E D I T I O N";
  ctx.fillText(sub, W / 2, 54);
}

/* the 8x16 grid */
var GX = 96, GW = 368, GY = 66, ROWH = 17;
var CELLW = GW / STEPS; // 23
function drawGrid(t, now) {
  var curStep = -1;
  for (var e = stepEvents.length - 1; e >= 0; e--) {
    if (stepEvents[e].t <= now) { curStep = stepEvents[e].step; break; }
  }
  ctx.font = "bold 9px monospace";
  for (var p = 0; p < 8; p++) {
    var y = GY + p * ROWH;
    var isCur = cursor.pad === p;
    /* pad flash: row glows briefly after a hit */
    var glow = 0;
    for (var f = padFlashes.length - 1; f >= 0; f--) {
      var fl = padFlashes[f];
      if (fl.pad === p && now - fl.t < 0.18) { glow = 1 - (now - fl.t) / 0.18; break; }
    }
    /* row label */
    var dim = muted[p];
    ctx.textAlign = "left";
    ctx.fillStyle = dim ? "#3a3a55" : (glow > 0 ? "#ffffff" : (isCur ? "#ffe14d" : "#00e5ff"));
    var label = "[" + PADS[p].key + "] " + PADS[p].name + (muted[p] ? " X" : "");
    ctx.fillText(label, 8, y + 11);
    if (glow > 0) {
      ctx.fillStyle = "rgba(255,255,255," + (glow * 0.25).toFixed(2) + ")";
      ctx.fillRect(GX, y, GW, ROWH - 4);
    }
    /* cells */
    for (var s = 0; s < STEPS; s++) {
      var x = GX + s * CELLW;
      var on = pattern[p][s];
      var isPlay = playing && s === curStep;
      var isCurCell = isCur && cursor.step === s;
      var beat = s % 4 === 0;
      if (on) {
        ctx.fillStyle = dim ? "#4a4a66" : (isPlay ? "#ffffff" : neonAt(t, p % 4));
        ctx.fillRect(x + 2, y, CELLW - 4, ROWH - 6);
      } else {
        ctx.fillStyle = isPlay ? "rgba(255,255,255,0.28)" : (beat ? "#23233d" : "#171728");
        ctx.fillRect(x + 2, y, CELLW - 4, ROWH - 6);
      }
      if (isCurCell && (Math.floor(t * 3) % 2 === 0)) {
        ctx.strokeStyle = "#ffe14d";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1.5, y - 0.5, CELLW - 3, ROWH - 5);
      }
    }
  }
}

function drawStatus() {
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#8a8ab0";
  var st = playing ? "#39ff6a" : "#ff2fd6";
  ctx.fillStyle = st;
  ctx.fillText(playing ? "[>> PLAYING]" : "[ ] STOPPED", 8, 216);
  ctx.fillStyle = "#8a8ab0";
  ctx.fillText("BPM " + bpm + "   SWING " + swing + "%   PTRN:" + patternName, 120, 216);
  ctx.fillStyle = "#55557a";
  ctx.font = "8px monospace";
  ctx.fillText("SPACE PLAY   ARROWS+ENTER EDIT   ASDFJKL; PADS   1-4 BREAKS   R CHAOS   H HELP", 8, 230);
}

function drawScroll(t) {
  var y0 = 248;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, y0 - 14, W, 22);
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "left";
  var x = W - scrollX;
  for (var i = 0; i < SCROLL.length; i++) {
    var ch = SCROLL[i];
    var cx = x + i * 7.2;
    if (cx < -10) continue;
    if (cx > W + 10) break;
    var yo = Math.sin((scrollX + i * 7.2) * 0.045) * 4;
    ctx.fillStyle = NEON[(i + Math.floor(t * 3)) % NEON.length];
    ctx.fillText(ch, cx, y0 + yo);
  }
  scrollX += 1.1;
  if (scrollX > SCROLL.length * 7.2 + W) scrollX = 0;
}

var HELP = [
  ["A S D F J K L ;", "fire pads 1-8"],
  ["SPACE", "play / stop sequencer"],
  ["ARROWS", "move grid cursor"],
  ["ENTER / X", "toggle step at cursor"],
  ["M", "mute / unmute pad row"],
  ["1 2 3 4", "factory breaks"],
  ["R", "randomize pattern"],
  ["C", "clear pattern"],
  ["- / =", "tempo down / up"],
  ["[ / ]", "swing down / up"],
  ["H", "this scroll"],
  ["ESC", "close this scroll"],
];
function drawHelp() {
  ctx.fillStyle = "rgba(2,2,10,0.88)";
  ctx.fillRect(40, 30, W - 80, H - 60);
  ctx.strokeStyle = "#00e5ff";
  ctx.strokeRect(40.5, 30.5, W - 81, H - 61);
  ctx.textAlign = "center";
  ctx.font = "bold 12px monospace";
  ctx.fillStyle = "#ffe14d";
  ctx.fillText("* KEY MAP *", W / 2, 52);
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  for (var i = 0; i < HELP.length; i++) {
    var y = 72 + i * 13;
    ctx.fillStyle = "#00e5ff";
    ctx.fillText(HELP[i][0], 70, y);
    ctx.fillStyle = "#b0b0d0";
    ctx.fillText(HELP[i][1], 220, y);
  }
}

function drawSplash(t) {
  ctx.fillStyle = "rgba(2,2,10,0.72)";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = neonAt(t, 1);
  ctx.fillText("SP-1200", W / 2, 110);
  ctx.font = "bold 10px monospace";
  ctx.fillStyle = "#8a8ab0";
  ctx.fillText("D E M O S C E N E   E D I T I O N", W / 2, 130);
  if (Math.floor(t * 2.2) % 2 === 0) {
    ctx.font = "bold 13px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("* PRESS ANY KEY *", W / 2, 168);
  }
  ctx.font = "9px monospace";
  ctx.fillStyle = "#55557a";
  ctx.fillText("KEYBOARD ONLY. NO MOUSE REQUIRED.", W / 2, 196);
}

/* ============================== main loop ============================== */
var lastT = 0;
function frame(ts) {
  var t = ts / 1000;
  var dt = Math.min(0.05, t - (lastT || t));
  lastT = t;
  var now = ac ? ac.currentTime : 0;
  pulse = Math.max(0, pulse - dt * 6);

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  drawStarfield(t, reduced ? 0 : dt);
  if (!reduced) { drawCopper(t); drawRasters(t); }
  drawLogo(t);
  drawGrid(t, now);
  drawStatus();
  if (!reduced) drawScroll(t);
  if (showHelp) drawHelp();
  if (splash) drawSplash(t);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ============================== keyboard ============================== */
var PADKEYS = { a: 0, s: 1, d: 2, f: 3, j: 4, k: 5, l: 6, ";": 7 };

document.addEventListener("keydown", function (e) {
  var k = e.key;
  if (k === " " || k.indexOf("Arrow") === 0) e.preventDefault();

  if (splash) {
    splash = false;
    ensureAudio();
    e.preventDefault();
    return;
  }

  if (k === "Escape") { showHelp = false; return; }
  if (k === "h" || k === "H") { showHelp = !showHelp; return; }
  if (showHelp) return;

  var lk = k.toLowerCase();

  if (PADKEYS.hasOwnProperty(lk)) { ensureAudio(); hit(PADKEYS[lk], null); return; }
  if (k === " ") { setPlaying(!playing); return; }

  if (k === "ArrowUp") { cursor.pad = (cursor.pad + 7) % 8; return; }
  if (k === "ArrowDown") { cursor.pad = (cursor.pad + 1) % 8; return; }
  if (k === "ArrowLeft") { cursor.step = (cursor.step + STEPS - 1) % STEPS; return; }
  if (k === "ArrowRight") { cursor.step = (cursor.step + 1) % STEPS; return; }

  if (k === "Enter" || lk === "x") {
    pattern[cursor.pad][cursor.step] = !pattern[cursor.pad][cursor.step];
    patternName = "CUSTOM";
    save();
    return;
  }
  if (lk === "m") { muted[cursor.pad] = !muted[cursor.pad]; save(); return; }
  if (lk === "c") { pattern = blankPattern(); patternName = "EMPTY"; save(); return; }
  if (lk === "r") { randomize(); return; }
  if (PRESETS[k]) { loadPreset(k); return; }
  if (k === "-" || k === "_") { bpm = Math.max(60, bpm - 1); save(); return; }
  if (k === "=" || k === "+") { bpm = Math.min(200, bpm + 1); save(); return; }
  if (k === "[") { swing = Math.max(50, swing - 1); save(); return; }
  if (k === "]") { swing = Math.min(75, swing + 1); save(); return; }
});
})();
