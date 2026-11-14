// A promo film from a page that draws any instant (brand/promo/<name>.html: window.ready → total ms, window.render(ms)):
// headless Chrome is asked for each frame over its debugging port, ffmpeg joins them.
//   node scripts/promo-render.mjs messages            → brand/promo/messages.mp4 (1080 × 1350, 30 frames a second)
// Needs Google Chrome and ffmpeg on this Mac, and the network for the fonts.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const name = process.argv[2] ?? "messages";
const FPS = 30, W = 1080, H = 1350, PORT = 9333;
const page = pathToFileURL(resolve(`brand/promo/${name}.html`)).href + "?frames";
const out = resolve(`brand/promo/${name}.mp4`);
const frames = mkdtempSync(join(tmpdir(), "promo-frames-"));
const profile = mkdtempSync(join(tmpdir(), "promo-chrome-"));

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run", "--allow-file-access-from-files", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const t = list.find((x) => x.type === "page"); if (t) return t.webSocketDebuggerUrl; } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

try {
  const ws = new WebSocket(await target());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiting.get(m.id); if (w) { waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { waiting.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };

  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: page });
  let total = null;
  for (let i = 0; i < 100 && total == null; i++) { await sleep(200); total = await evaluate("window.ready ? window.ready : null").catch(() => null); }
  if (!total) throw new Error("the page never became ready");
  const n = Math.ceil((total / 1000) * FPS);
  for (let f = 0; f < n; f++) {
    await evaluate(`render(${(f * 1000) / FPS}); new Promise((r) => requestAnimationFrame(() => r(1)))`);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(frames, `f${String(f).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
    if (f % 60 === 0) console.log(`frame ${f} / ${n}`);
  }
  ws.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", out]);
  console.log(`${out} (${n} frames, ${(total / 1000).toFixed(1)} s)`);
} finally {
  chrome.kill();
  rmSync(frames, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
