import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

// Run against the existing local dev/preview server. All nonlocal browser requests
// are blocked and recorded; this proves that normal viewing does not need them.
const base = process.env.VIEWER_URL || 'http://127.0.0.1:5173';
const origin = new URL(base).origin;
const output = path.resolve('outputs/qa');
fs.mkdirSync(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: base, checks: [], externalRequests: [], pageErrors: [], localRequestCount: 0, tileRequestCount: 0, screenshots: [], timings: {} };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) {
    report.localRequestCount += 1;
    if (/\/pilot_files\/\d+\/\d+_\d+\./.test(url.pathname)) report.tileRequestCount += 1;
    await route.continue();
  } else {
    report.externalRequests.push(url.href);
    await route.abort('blockedbyclient');
  }
});
const page = await context.newPage();
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const check = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
const screenshot = async (name, target = page) => { const filename = `viewer-${name}.png`; await target.screenshot({ path: path.join(output, filename) }); report.screenshots.push(filename); };
const waitReady = async (target = page) => {
  await target.locator('.map-status').waitFor({ state: 'hidden', timeout: 45000 });
  await target.waitForFunction(() => document.querySelectorAll('.map-pin').length === 4, undefined, { timeout: 15000 });
  await target.waitForLoadState('networkidle');
};
const urlState = (url) => Object.fromEntries(new URLSearchParams(new URL(url).hash.slice(1)));
try {
  const tick = performance.now();
  const response = await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await waitReady();
  report.timings.initialReadyMs = Math.round(performance.now() - tick);
  assert.equal(await page.locator('.map-pin').count(), 4);
  assert.equal(await page.locator('.place-row').count(), 7);
  assert.equal(await page.locator('.tile-warning').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'B High-bit art' }).isDisabled(), true);
  check('Local pyramid loads; four curated pins and three named streets; unavailable art disabled');
  await screenshot('overview');

  const metadata = await (await context.request.get(`${base}/map/metadata.json`)).json();
  const expectedNorth = Math.atan2(metadata.transform.right[1], metadata.transform.up[1]) * 180 / Math.PI;
  const actualNorth = Number(await page.locator('[data-north-angle]').getAttribute('data-north-angle'));
  assert.ok(Math.abs(actualNorth - expectedNorth) < 0.001);
  check('Compass north agrees with the rendered camera basis');

  const search = page.getByRole('textbox', { name: 'Search landmarks and streets' });
  await search.fill('Palace of Winds');
  assert.equal(await page.locator('.place-row').count(), 1);
  await page.locator('.place-row').click();
  await page.locator('.selected-panel h2').filter({ hasText: 'Hawa Mahal' }).waitFor();
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle');
  await screenshot('hawa-mahal');
  check('English alias search opens georeferenced Hawa Mahal information');

  await search.fill('जंतर');
  assert.equal(await page.locator('.place-row').count(), 1);
  await page.locator('.place-row').click();
  await page.locator('.selected-panel h2').filter({ hasText: 'Jantar Mantar' }).waitFor();
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle');
  await screenshot('jantar-mantar');
  check('Hindi search finds and opens Jantar Mantar');

  await page.getByRole('button', { name: 'Share view' }).click();
  const shared = page.url();
  const before = urlState(shared);
  assert.equal(before.v, '1');
  assert.equal(before.poi, 'jantar-mantar');
  assert.ok(['cx', 'cy', 'z'].every((key) => Number.isFinite(Number(before[key]))));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.map-status').waitFor({ state: 'hidden', timeout: 45000 });
  await page.locator('.selected-panel h2').filter({ hasText: 'Jantar Mantar' }).waitFor();
  await page.waitForTimeout(350);
  const after = urlState(page.url());
  assert.equal(after.poi, before.poi);
  for (const key of ['cx', 'cy', 'z']) assert.ok(Math.abs(Number(before[key]) - Number(after[key])) < 0.05, `${key} changed on URL restoration`);
  check('Versioned image-pixel viewport and selected landmark survive reload');

  await search.fill('City Palace');
  await page.locator('.place-row').first().click();
  await page.waitForTimeout(1000);
  await page.waitForLoadState('networkidle');
  await screenshot('city-palace');
  await page.getByRole('button', { name: 'Reset map', exact: true }).click();
  await page.waitForTimeout(800);
  await page.locator('body').click({ position: { x: 800, y: 90 } });
  const home = urlState(page.url());
  const navTick = performance.now();
  await page.keyboard.press('+');
  await page.waitForFunction((initial) => Number(new URLSearchParams(location.hash.slice(1)).get('z')) > initial, Number(home.z), { timeout: 5000 });
  report.timings.keyboardZoomSettledMs = Math.round(performance.now() - navTick);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const panned = urlState(page.url());
  assert.notEqual(panned.cx, home.cx);
  await page.keyboard.press('g');
  assert.equal(await page.locator('.debug-banner').count(), 1);
  await screenshot('geography-debug');
  await page.keyboard.press('g');
  check('Keyboard zoom, arrow pan, geographic debug and reset respond');

  await page.getByRole('button', { name: 'About this map' }).click();
  const close = page.getByRole('button', { name: 'Close map information' });
  await close.waitFor();
  assert.equal(await close.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.about-modal').evaluate((el) => el.contains(document.activeElement)), true);
  await screenshot('about');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.about-modal').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'About this map' }).evaluate((el) => el === document.activeElement), true);
  check('About dialog traps focus and restores it on Escape');

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  mobile.on('pageerror', (error) => report.pageErrors.push(error.message));
  await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  await waitReady(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await screenshot('mobile', mobile);
  await mobile.getByRole('button', { name: 'Explore the Old City' }).click();
  await mobile.getByRole('textbox', { name: 'Search landmarks and streets' }).fill('हवा');
  await mobile.locator('.place-row').click();
  assert.equal(await mobile.locator('.explorer.mobile-open').count(), 1);
  await mobile.locator('.selected-panel h2').filter({ hasText: 'Hawa Mahal' }).waitFor();
  await screenshot('mobile-search', mobile);
  await mobile.close();
  check('Mobile layout fits viewport; Hindi search and place detail work');

  const missing = await context.newPage();
  await missing.route('**/pilot_files/**', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Simulated QA missing tile' }));
  await missing.goto(base, { waitUntil: 'domcontentloaded' });
  await missing.locator('.tile-warning').waitFor({ timeout: 30000 });
  await screenshot('missing-tile', missing);
  await missing.close();
  check('Missing local tile requests display actionable feedback');

  assert.equal(report.externalRequests.length, 0, 'Normal viewing attempted external network access');
  assert.equal(report.pageErrors.length, 0, 'Browser JavaScript errors');
  assert.ok(report.tileRequestCount > 0, 'No image tiles were requested');
  check('No external browser requests or uncaught JavaScript errors');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack || String(error);
  await screenshot('failure').catch(() => {});
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'viewer-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, externalRequests: report.externalRequests.length, timings: report.timings, report: 'outputs/qa/viewer-report.json' }, null, 2));
}
