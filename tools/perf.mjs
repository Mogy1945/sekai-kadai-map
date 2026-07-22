// 性能計測: 読込時間 / 静止時CPU占有率 / フライト中fps
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1380, height: 860 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');

const metric = async (name) => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === name).value;
// TaskDuration(メインスレッド稼働秒)の増分 / 実時間 = CPU占有率
async function cpuBusy(ms) {
  const a = await metric('TaskDuration');
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  const b = await metric('TaskDuration');
  return (b - a) / ((Date.now() - t0) / 1000) * 100;
}
const fps = (ms) => page.evaluate((ms) => new Promise((res) => {
  let c = 0; const t0 = performance.now();
  (function f() { c++; performance.now() - t0 < ms ? requestAnimationFrame(f) : res(Math.round(c / ((performance.now() - t0) / 1000))); })();
}), ms);

const t0 = Date.now();
await page.goto('file://' + join(ROOT, 'index.html'), { waitUntil: 'load' });
const loadMs = Date.now() - t0;

await page.waitForTimeout(1000);
const worldIdle = await cpuBusy(4000);

await page.click('#introBtns .enterBtn');
await page.waitForTimeout(1500);
const webEntry = await cpuBusy(3000);          // 展開直後(物理が残っている)
await page.waitForTimeout(12000);              // 物理が完全収束するまで待つ
const webIdle = await cpuBusy(4000);           // 完全静止時

await page.evaluate(() => window.__APP__.flyTo('kr'));
const flightFps = await fps(1400);
await page.waitForTimeout(1500);

console.log(JSON.stringify({
  loadMs,
  worldIdleCpuPct: +worldIdle.toFixed(1),
  webEntryCpuPct: +webEntry.toFixed(1),
  webIdleCpuPct: +webIdle.toFixed(1),
  flightFps,
}, null, 1));
await browser.close();
