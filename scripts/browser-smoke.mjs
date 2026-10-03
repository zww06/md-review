import { writeFile } from "node:fs/promises";

const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const screenshotPath = process.argv[3] ?? ".impeccable/review/desktop.png";
const viewportWidth = Number(process.argv[4] ?? 1440);
const viewportHeight = Number(process.argv[5] ?? 900);
const fileLabel = process.argv[6] ?? "03-implementation-plan.md";
const outlineLabel = process.argv[7];
const targets = await fetch(`${endpoint}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("No debuggable Edge page found.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: viewportWidth,
  height: viewportHeight,
  deviceScaleFactor: 1,
  mobile: viewportWidth <= 760,
});
await send("Page.navigate", { url: "http://127.0.0.1:4173" });
await pause(1200);

await evaluate(`(() => {
  const button = [...document.querySelectorAll('.file-list button')]
    .find((item) => item.textContent.trim() === ${JSON.stringify(fileLabel)});
  if (!button) throw new Error('Planning document button not found');
  button.click();
})()`);
await pause(700);

if (outlineLabel) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.outline-list button')]
      .find((item) => item.textContent.trim() === ${JSON.stringify(outlineLabel)});
    if (!button) throw new Error('Outline heading not found');
    button.click();
  })()`);
  await pause(350);
}

const sourceResult = await evaluate(`(async () => {
  const source = [...document.querySelectorAll('.topbar-actions button')]
    .find((item) => item.textContent.trim() === 'Source');
  source.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const lineCount = document.querySelectorAll('.source-lines li').length;
  [...document.querySelectorAll('.topbar-actions button')]
    .find((item) => item.textContent.trim() === 'Read').click();
  return lineCount;
})()`);
await pause(300);

const foldResult = await evaluate(`(() => {
  const details = document.querySelector('.reader details');
  if (details?.open) details.querySelector('summary').click();
  const folded = Boolean(details && !details.open);
  document.querySelector('.section-navigation button:last-child')?.click();
  return folded;
})()`);
await pause(350);

if (viewportWidth <= 760) {
  await evaluate(`document.querySelector('.icon-button')?.click()`);
  await pause(350);
}

await evaluate(`window.scrollTo(0, 0)`);

const stateResult = await evaluate(`(() => ({
  title: document.querySelector('.reader > h1')?.textContent,
  section: document.querySelector('.reader > h2')?.textContent,
  selectedFile: document.querySelector('.file-list .is-selected')?.textContent,
  sourceLines: ${JSON.stringify(sourceResult)}.result.value,
  folded: ${JSON.stringify(foldResult)}.result.value
}))()`);

const screenshot = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: viewportWidth, height: viewportHeight, scale: 1 },
});
await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
socket.close();
console.log(JSON.stringify(stateResult.result.value));
