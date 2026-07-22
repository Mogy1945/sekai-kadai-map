// 実ブラウザでの実タップ/クリック検証 (jsdomでは検出できないヒットテスト・pointer capture問題用)
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (cond, name) => {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.error('  ✗ ' + name); }
};

const browser = await chromium.launch();

// --- デスクトップ: マウスクリック ---
{
  const page = await browser.newPage({ viewport: { width: 1380, height: 860 } });
  await page.goto('file://' + join(ROOT, 'index.html'));
  await page.waitForTimeout(800);
  await page.click('#introBtns .enterBtn');
  await page.waitForTimeout(2200); // 遷移完了(trans=1)まで待つ

  // 大課題ノードの画面座標を取得して実クリック
  const pos = await page.evaluate(() => {
    const nd = window.__APP__.regions[0].graph.nodes.find(n => n.type === 'major');
    return { x: nd.sx, y: nd.sy, id: nd.id, name: nd.issue.name };
  });
  await page.mouse.click(pos.x, pos.y);
  await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => ({
    panelHidden: document.getElementById('panel').hidden,
    selected: window.__APP__.state().selected,
    panelText: document.getElementById('panel').textContent.slice(0, 200),
  }));
  ok(!r1.panelHidden, 'デスクトップ: ノード実クリックでパネル表示');
  ok(r1.selected === pos.id, `デスクトップ: 選択ID一致 (${r1.selected})`);
  ok(r1.panelText.includes(pos.name), 'デスクトップ: パネルに課題名');

  // 背景クリックで解除
  await page.mouse.click(80, 700);
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => document.getElementById('panel').hidden);
  ok(r2, 'デスクトップ: 背景クリックで選択解除');

  // ドラッグ後はパネルが開かない(誤タップ防止)
  const pos2 = await page.evaluate(() => {
    const nd = window.__APP__.regions[0].graph.nodes.filter(n => n.type === 'major')[1];
    return { x: nd.sx, y: nd.sy };
  });
  await page.mouse.move(pos2.x, pos2.y);
  await page.mouse.down();
  await page.mouse.move(pos2.x + 60, pos2.y + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(() => document.getElementById('panel').hidden);
  ok(r3, 'デスクトップ: ドラッグではパネルが開かない');
  await page.close();
}

// --- モバイル: タッチタップ ---
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('file://' + join(ROOT, 'index.html'));
  await page.waitForTimeout(800);
  await page.tap('#introBtns .enterBtn');
  await page.waitForTimeout(2200);

  const pos = await page.evaluate(() => {
    // 画面内にいる大課題を選ぶ
    const nd = window.__APP__.regions[0].graph.nodes.find(n =>
      n.type === 'major' && n.sx > 40 && n.sx < 350 && n.sy > 100 && n.sy < 700);
    return { x: nd.sx, y: nd.sy, id: nd.id };
  });
  await page.touchscreen.tap(pos.x, pos.y);
  await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => ({
    panelHidden: document.getElementById('panel').hidden,
    selected: window.__APP__.state().selected,
  }));
  ok(!r1.panelHidden, 'モバイル: ノード実タップでパネル表示');
  ok(r1.selected === pos.id, `モバイル: 選択ID一致 (${r1.selected})`);
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
