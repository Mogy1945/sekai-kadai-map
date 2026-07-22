// Playwrightでスクリーンショット撮影 (目視検証用)
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '/tmp/claude-1000/-home-shuirein928/7b97e682-bef2-44d6-aa95-b7a3b448fc9e/scratchpad';

const browser = await chromium.launch();
for (const [name, vp] of [['desktop', { width: 1380, height: 860 }], ['mobile', { width: 390, height: 780 }]]) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
  await page.goto('file://' + join(ROOT, 'index.html'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}-1-world.png`) });

  // 日本
  await page.click('#introBtns .enterBtn');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(OUT, `${name}-2-jp.png`) });

  await page.evaluate(() => {
    const jp = window.__APP__.regions[0];
    window.__APP__.selectNode(jp.graph.nodes[0].id);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}-3-jp-panel.png`) });

  // 韓国へ (地球経由)
  await page.evaluate(() => { window.__APP__.clearSelection(); window.__APP__.exitWeb(); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__APP__.enterWeb('kr'));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(OUT, `${name}-4-kr.png`) });

  await page.evaluate(() => {
    const kr = window.__APP__.regions.find(r => r.data.id === 'kr');
    window.__APP__.selectNode(kr.graph.nodes[0].id);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}-5-kr-panel.png`) });

  // 一覧
  await page.click('#tableBtn');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}-6-table.png`) });
  await page.close();
}
await browser.close();
console.log('shots saved to', OUT);
