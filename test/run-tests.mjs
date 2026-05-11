// Headless self-test runner. Loads index.html in a real browser and calls
// window.__runTests(), then prints pass/fail. Exit code 0 = all pass.
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = 'file://' + resolve(__dirname, '..', 'index.html');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ timezoneId: 'Asia/Bangkok' });
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', msg => {
  const txt = msg.text();
  consoleLines.push(`[${msg.type()}] ${txt}`);
});
page.on('pageerror', err => {
  consoleLines.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
});

let exitCode = 0;
try {
  await page.goto(indexPath + '?test=1', { waitUntil: 'load' });
  // Wait for tests to complete (set by __runTests)
  const result = await page.waitForFunction(() => window.__testResults, { timeout: 8000 }).then(h => h.jsonValue());

  console.log(`\n=== Self-test results ===`);
  console.log(`Passed: ${result.pass} / ${result.total}`);
  if (result.failed && result.failed.length) {
    console.log(`\nFailures:`);
    result.failed.forEach(f => console.log(`  ✗ ${f.name} — ${f.err}`));
    exitCode = 1;
  }
  // Print console output for context
  if (process.env.VERBOSE) {
    console.log(`\n=== Browser console ===`);
    consoleLines.forEach(l => console.log(l));
  }
} catch (e) {
  console.error(`\nTest harness failure: ${e.message}`);
  consoleLines.forEach(l => console.error(l));
  exitCode = 1;
}

await browser.close();
process.exit(exitCode);
