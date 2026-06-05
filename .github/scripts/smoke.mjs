// Headless-browser smoke test for a built miso-wasm app.
//
// Usage: node smoke.mjs <url> <screenshot-path> <log-path>
//
// Asserts:
//   (a) Page loads without any unhandled `pageerror` exceptions.
//   (b) The wasm module finishes initializing — observed by miso
//       actually mutating <body>'s DOM (so the body grows beyond the
//       original <script> tag).
//   (c) No console.error lines reference an Error/Exception.
//
// All console output from the browser is captured to <log-path> for
// post-mortem inspection, and a full-page screenshot is dropped at
// <screenshot-path>.

import { chromium } from 'playwright';
import { writeFileSync, appendFileSync } from 'node:fs';

const [, , urlArg, screenshotPath, logPath] = process.argv;
if (!urlArg || !screenshotPath || !logPath) {
  console.error('usage: smoke.mjs <url> <screenshot-path> <log-path>');
  process.exit(2);
}

writeFileSync(logPath, `== smoke.mjs starting against ${urlArg} ==\n`);
const log = (line) => {
  process.stdout.write(line + '\n');
  appendFileSync(logPath, line + '\n');
};

const browser = await chromium.launch();
const page = await browser.newPage();

const pageErrors = [];
const consoleErrors = [];

page.on('console', (msg) => {
  const text = `[${msg.type()}] ${msg.text()}`;
  log('BROWSER ' + text);
  if (msg.type() === 'error') consoleErrors.push(text);
});
page.on('pageerror', (err) => {
  const text = err.stack || err.message || String(err);
  log('PAGEERROR ' + text);
  pageErrors.push(text);
});

try {
  // `networkidle` waits until no in-flight request for >=500ms — covers
  // the wasm fetch + jsdelivr ESM imports. The extra waitForTimeout
  // gives miso time to run startApp -> render once after wasm init.
  log(`navigating to ${urlArg}`);
  await page.goto(urlArg, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(5_000);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  log(`screenshot saved: ${screenshotPath}`);

  const bodyHtml = await page.evaluate(() => document.body.innerHTML);
  log(`body.innerHTML length: ${bodyHtml.length}`);
  log('--- body preview (first 400 chars) ---');
  log(bodyHtml.substring(0, 400));
  log('--- end preview ---');

  let failed = false;

  if (pageErrors.length > 0) {
    log(`FAIL: ${pageErrors.length} pageerror(s)`);
    failed = true;
  }

  // Filter console.error noise: only fail on errors that look like real
  // exceptions, not e.g. WASI stderr lines or RTS noise that miso may
  // legitimately emit.
  const fatalConsole = consoleErrors.filter((l) =>
    /Error|Exception|TypeError|ReferenceError|SyntaxError/.test(l)
  );
  if (fatalConsole.length > 0) {
    log(`FAIL: ${fatalConsole.length} fatal console.error(s):`);
    fatalConsole.forEach((l) => log('  ' + l));
    failed = true;
  }

  // miso replaces document.body with the rendered virtual DOM. If body
  // still only contains the bootstrap <script> tag, miso never mounted.
  // The bootstrap markup is ~50 chars (one `<script src="index.js" ...>`);
  // 200 is a generous floor that anything genuinely-rendered exceeds.
  if (bodyHtml.length < 200) {
    log(`FAIL: body looks empty (length=${bodyHtml.length}) — miso did not mount`);
    failed = true;
  }

  if (failed) {
    log('SMOKE TEST: FAIL');
    process.exit(1);
  }
  log('SMOKE TEST: PASS');
} finally {
  await browser.close();
}
