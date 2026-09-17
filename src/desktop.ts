// SP-1200 desktop entry: compiled with `bun build --compile` into a single
// native Linux binary. Web assets are embedded at compile time, so the
// binary needs nothing else on disk. On launch it serves the app on a free
// local port and opens it in a dedicated window (Chromium --app when
// available, otherwise the default browser).
import indexHtml from "../public/index.html" with { type: "text" };
import appJs from "../public/app.js" with { type: "text" };
import dspJs from "../public/dsp.js" with { type: "text" };
import styleCss from "../public/style.css" with { type: "text" };

const ASSETS: Record<string, { body: string; type: string }> = {
  "/": { body: indexHtml, type: "text/html; charset=utf-8" },
  "/index.html": { body: indexHtml, type: "text/html; charset=utf-8" },
  "/app.js": { body: appJs, type: "text/javascript; charset=utf-8" },
  "/dsp.js": { body: dspJs, type: "text/javascript; charset=utf-8" },
  "/style.css": { body: styleCss, type: "text/css; charset=utf-8" },
};

const port = Number(process.env.PORT || 0);
const server = Bun.serve({
  port,
  fetch(req) {
    const p = new URL(req.url).pathname;
    const a = ASSETS[p];
    if (!a) return new Response("not found", { status: 404 });
    return new Response(a.body, { headers: { "content-type": a.type } });
  },
});

const url = `http://127.0.0.1:${server.port}/`;
console.log(`SP-1200 running at ${url}  (Ctrl+C to quit)`);

function openWindow(target: string) {
  const attempts: string[][] = [
    ["chromium", `--app=${target}`],
    ["google-chrome", `--app=${target}`],
    ["chromium-browser", `--app=${target}`],
    ["xdg-open", target],
  ];
  for (const [cmd, ...args] of attempts) {
    try {
      Bun.spawn([cmd, ...args], { stdout: "ignore", stderr: "ignore" });
      return;
    } catch {
      // command not present — try the next one
    }
  }
  console.log(`Could not open a browser automatically. Visit: ${target}`);
}

openWindow(url);
