const endpoint = process.argv[2] ?? "http://127.0.0.1:9223";
const appUrl = process.argv[3] ?? "http://127.0.0.1:4174";
const targets = await fetch(`${endpoint}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("No debuggable browser page found.");

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
  const handlers = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handlers.reject(new Error(message.error.message)); else handlers.resolve(message.result);
});
function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed.");
  return result.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: appUrl });
await pause(900);

const result = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clickText = (selector, text) => {
    const element = [...document.querySelectorAll(selector)].find((item) => item.textContent.trim().startsWith(text));
    if (!element) throw new Error('Missing control: ' + text);
    element.click();
    return element;
  };
  const setText = (element, value, label) => {
    if (!element) throw new Error('Missing textarea: ' + label);
    element.focus();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, value);
  };
  const choose = [...document.querySelectorAll('.file-list button')].find((item) => item.textContent.trim() === 'PRODUCT.md');
  if (!choose) throw new Error('PRODUCT.md was not discovered.');
  choose.click();
  await wait(350);
  const paragraph = document.querySelector('.reader p[data-source-start]');
  if (!paragraph?.firstChild) throw new Error('No selectable paragraph.');
  const textNode = paragraph.firstChild;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(24, textNode.textContent.length));
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await wait(50);
  const draft = document.querySelector('.comment-popover textarea');
  if (!draft) throw new Error('Selection did not open a comment draft.');
  setText(draft, 'Session 02 persistence check', 'new comment');
  clickText('.comment-popover button', 'Save comment');
  await wait(300);
  const highlight = Boolean(document.querySelector('.comment-highlight'));
  clickText('.topbar-actions button', 'Comments');
  await wait(50);
  const card = document.querySelector('.comment-card');
  if (!card) throw new Error('Saved comment missing from list.');
  clickText('.comment-card button', 'Edit');
  await wait(30);
  setText(document.querySelector('.comment-card textarea'), 'Session 02 edited persistence check', 'edit comment');
  clickText('.comment-card button', 'Save edit');
  await wait(150);
  clickText('.comment-card button', 'Resolve');
  await wait(150);
  const resolved = document.querySelector('.anchor-state')?.textContent.trim() === 'resolved';
  clickText('.comment-card button', 'Reopen');
  await wait(150);
  const reopened = document.querySelector('.anchor-state')?.textContent.trim() === 'open';
  clickText('.topbar-actions button', 'Comments');

  const freshParagraphs = document.querySelectorAll('.reader p[data-source-start]');
  const secondParagraph = freshParagraphs[1] ?? freshParagraphs[0];
  const secondText = secondParagraph.firstChild;
  const range2 = document.createRange(); range2.setStart(secondText, 0); range2.setEnd(secondText, Math.min(16, secondText.textContent.length));
  selection.removeAllRanges(); selection.addRange(range2); secondParagraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await wait(100);
  setText(document.querySelector('.comment-popover textarea'), 'Keep this draft', 'protected draft');
  const originalPath = document.querySelector('.document-location span').textContent;
  window.confirm = () => false;
  const other = [...document.querySelectorAll('.file-list button')].find((item) => item.textContent.trim() !== 'PRODUCT.md');
  other.click(); await wait(100);
  const protectedDraft = document.querySelector('.comment-popover textarea')?.value === 'Keep this draft' && document.querySelector('.document-location span').textContent === originalPath;
  clickText('.comment-popover button', 'Cancel');
  window.confirm = () => true;
  await wait(100);

  const planFile = [...document.querySelectorAll('.file-list button')].find((item) => item.textContent.trim() === '02-plan.md');
  planFile?.click(); await wait(400);
  const selectedAfterPlan = document.querySelector('.document-location span')?.textContent;
  const courseHeading = [...document.querySelectorAll('.outline-list button')].find((item) => item.textContent.trim() === 'Course structure and layout');
  courseHeading?.click(); await wait(150);
  const table = document.querySelector('.reader table');
  let blockFallback = false;
  if (table) {
    const cellText = table.querySelector('td, th')?.firstChild;
    if (cellText?.textContent) {
      const range3 = document.createRange(); range3.setStart(cellText, 0); range3.setEnd(cellText, Math.min(5, cellText.textContent.length));
      selection.removeAllRanges(); selection.addRange(range3); table.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await wait(30);
      blockFallback = document.querySelector('.comment-popover .eyebrow')?.textContent.includes('Block fallback') ?? false;
      clickText('.comment-popover button', 'Cancel');
    }
  }

  const productFile = [...document.querySelectorAll('.file-list button')].find((item) => item.textContent.trim() === 'PRODUCT.md');
  productFile?.click(); await wait(200);
  clickText('.topbar-actions button', 'Feedback'); await wait(30);
  clickText('.feedback-builder button', 'Build preview'); await wait(30);
  const preview = document.querySelector('.feedback-preview')?.value ?? '';
  clickText('.feedback-builder button', 'Copy feedback'); await wait(80);
  const copyResult = document.querySelector('.copy-status')?.textContent ?? '';
  const commentId = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/api/comments'));
  return { highlight, resolved, reopened, protectedDraft, selectedAfterPlan, courseHeadingFound: Boolean(courseHeading), tableFound: Boolean(table), blockFallback, feedbackHasPath: preview.includes('File: PRODUCT.md'), feedbackHasRequest: preview.includes('Session 02 edited persistence check'), copyResult, resourceSeen: Boolean(commentId) };
})()`);

socket.close();
console.log(JSON.stringify(result));
