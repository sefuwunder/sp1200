# SP-1200

A 12-bit drum machine / sampler in the browser, served by Bun — a loving simulation of the E-mu SP-1200's sound and swing. Zero dependencies.

## The sound

Every drum (and every sample you load) runs through the SP-1200's converter path:

- **26.04 kHz sample rate** — the original's fixed rate; everything above ~13 kHz folds back as grit
- **12-bit quantization** — the famous crunch
- **Varispeed tuning** — the TUNE slider replays the sample faster/slower, exactly like the hardware (pitch, time, and aliasing all shift together)

The 8 built-in voices are synthesized clean at 44.1 kHz, then "sampled" by that path. The **SP-1200** toggle in the transport bypasses the path so you can A/B the grit against the clean signal.

## The swing

Roger Linn-style swing on the 16th grid: even 16ths stay locked, odd 16ths slide late. **50%** is straight, **75%** is the full triplet-style lope (the MPC/SP range). Timing is sample-accurate via a lookahead scheduler on the AudioContext clock.

## Use

```sh
bun start   # http://localhost:3007
```

- **Pads** — click, tap `1`–`8`, or program the 16-step sequencer. Each pad has TUNE (± octave varispeed), LEVEL, MUTE, LOAD (drop your own sample through the 12-bit path), and RESET.
- **Transport** — play/stop (`Space`), TEMPO with TAP, SWING, MASTER, SP-1200 bypass.
- **Presets** — Boom Bap, Trap, House, plus Clear. Pattern, tempo, swing, and pad settings persist in localStorage.

## Layout

- `src/server.ts` — Bun static server (port 3007)
- `public/dsp.js` — pure DSP: drum synthesis, the 26.04 kHz / 12-bit pipeline, swing math. Runs in node too (`require("./public/dsp.js")`)
- `public/app.js` — UI, Web Audio voices, lookahead sequencer
- `public/style.css`, `public/index.html`
