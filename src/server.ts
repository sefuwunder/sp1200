// SP-1200: 12-bit drum machine. Bun serves the static app; all audio runs
// in the browser via Web Audio (OfflineAudioContext-free, pure DSP in dsp.js).
const root = new URL("../public/", import.meta.url);
const port = Number(process.env.PORT || 3007);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    if (p.includes("..")) return new Response("bad path", { status: 400 });
    const file = Bun.file(new URL("." + p, root));
    if (await file.exists()) return new Response(file);
    return new Response("not found", { status: 404 });
  },
});

console.log(`SP-1200 running at http://localhost:${port}`);
