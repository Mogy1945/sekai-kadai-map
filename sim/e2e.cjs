// E2E: データ整合性 + ヘッドレス物理 + jsdomでUI操作フロー検証
'use strict';
const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
let failures = 0;
const ok = (cond, name) => {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.error('  ✗ ' + name); }
};

// ---------- 1. データ整合性 ----------
console.log('[1] データ整合性');
const { ISSUE_DATA } = require(join(ROOT, 'src', 'data.js'));
const { GraphCore } = require(join(ROOT, 'src', 'graph.js'));
const { WORLD_MAP } = require(join(ROOT, 'src', 'mapdata.js'));

const issues = ISSUE_DATA.issues;
ok(issues.length >= 3, `大課題 ${issues.length}件 (>=3)`);
const ids = new Set(issues.map(i => i.id));
ok(ids.size === issues.length, '大課題IDが一意');

const allSubIds = new Set();
let statOk = true, linkOk = true, subDup = false, catOk = true, urlOk = true;
for (const I of issues) {
  if (!GraphCore.CATEGORIES.includes(I.category)) { catOk = false; console.error('    不明カテゴリ:', I.id, I.category); }
  if (!(I.key_stats && I.key_stats.length >= 3)) { statOk = false; console.error('    key_stats不足:', I.id); }
  for (const st of I.key_stats || []) {
    if (!/^https?:\/\//.test(st.source_url || '')) { urlOk = false; console.error('    不正URL:', I.id, st.label); }
  }
  for (const s of I.sub_issues || []) {
    if (allSubIds.has(s.id) || ids.has(s.id)) { subDup = true; console.error('    サブID重複:', s.id); }
    allSubIds.add(s.id);
    if (!/^https?:\/\//.test((s.key_stat || {}).source_url || '')) { urlOk = false; console.error('    サブ不正URL:', s.id); }
  }
  for (const l of I.links_to_other_issues || []) {
    if (!ids.has(l.target_id)) { linkOk = false; console.error('    リンク先不明:', I.id, '→', l.target_id); }
  }
}
ok(catOk, 'カテゴリが定義済み7種の中');
ok(statOk, '全課題にkey_stats>=3');
ok(urlOk, '全出典URLがhttp(s)');
ok(!subDup, 'サブ課題IDが一意');
ok(linkOk, '課題間リンクのtarget_idが実在');

for (const I of issues) {
  const { score } = GraphCore.computeScore(I.score_inputs);
  if (!(score >= 0 && score <= 100)) { failures++; console.error('  ✗ スコア範囲外:', I.id, score); }
}
console.log('  ✓ 全スコアが0..100');

// ---------- 2. ヘッドレス物理 ----------
console.log('[2] 力学シミュレーション');
const graph = GraphCore.buildGraph(ISSUE_DATA);
ok(graph.nodes.length === issues.length + issues.reduce((a, i) => a + i.sub_issues.length, 0), `ノード数=${graph.nodes.length}`);
const sim = GraphCore.createSim(graph);
sim.settle(500);
let nan = false, far = false;
for (const nd of graph.nodes) {
  if (!isFinite(nd.x) || !isFinite(nd.y)) nan = true;
  if (Math.hypot(nd.x, nd.y) > 4000) far = true;
}
ok(!nan, '座標にNaN/Infなし');
ok(!far, '座標が発散していない (<4000)');
ok(sim.alpha < 0.1, `収束 (alpha=${sim.alpha.toFixed(4)})`);
// 大ノード同士のめり込みが酷くないか
let overlap = 0;
const majors = graph.nodes.filter(n => n.type === 'major');
for (let i = 0; i < majors.length; i++) for (let j = i + 1; j < majors.length; j++) {
  const a = majors[i], b = majors[j];
  if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.9) overlap++;
}
ok(overlap === 0, '大課題ノード同士の重なりなし');
// クラスタ配置が日本近傍
const cluster = GraphCore.clusterPositions(graph.nodes, WORLD_MAP.japanCenter.x, WORLD_MAP.japanCenter.y);
let clusterOk = true;
for (const [, p] of cluster) {
  if (Math.hypot(p.x - WORLD_MAP.japanCenter.x, p.y - WORLD_MAP.japanCenter.y) > 45) clusterOk = false;
}
ok(clusterOk, '世界ビューのクラスタが日本近傍');

// ---------- 3. jsdomでUIフロー ----------
console.log('[3] UIフロー (jsdom)');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

const errors = [];
window.addEventListener('error', e => errors.push(e.message));

setTimeout(() => {
  try {
    const APP = window.__APP__;
    ok(!!APP, 'アプリ初期化 (window.__APP__)');
    ok(errors.length === 0, 'JSエラーなし' + (errors.length ? ': ' + errors[0] : ''));

    const nodeEls = document.querySelectorAll('.node');
    ok(nodeEls.length === graph.nodes.length, `ノードDOM ${nodeEls.length}個`);
    ok(document.querySelectorAll('.edge-tree').length > 0, '親子エッジ描画');
    ok(document.getElementById('app').classList.contains('world'), '初期状態=worldビュー');

    // 世界→課題マップ
    document.getElementById('enterBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().mode === 'web', 'enterでwebビューへ');
    ok(!document.getElementById('topbar').hidden, 'topbar表示');
    ok(!document.getElementById('legend').hidden, '凡例表示');
    ok(document.querySelectorAll('#legendCats .lchip').length >= 1, '凡例カテゴリチップ');

    // 大課題を選択
    const firstMajorId = issues[0].id;
    APP.selectNode(firstMajorId);
    const panel = document.getElementById('panel');
    ok(!panel.hidden, '詳細パネル表示');
    ok(panel.textContent.includes(issues[0].name), 'パネルに課題名');
    ok(panel.querySelectorAll('.stat').length >= 3, 'パネルに統計>=3');
    ok(panel.querySelectorAll('a[href^="http"]').length >= 3, 'パネルに出典リンク>=3');
    ok(panel.textContent.includes('深刻度スコア'), 'スコア内訳表示');
    ok(document.getElementById('app').classList.contains('focus'), '近傍フォーカス発動');
    const litCount = document.querySelectorAll('.node.lit').length;
    ok(litCount >= 1 + issues[0].sub_issues.length, `隣接ノード点灯 (${litCount})`);

    // サブ課題へ遷移
    const subBtn = panel.querySelector('.subitem[data-goto]');
    subBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().selected === subBtn.getAttribute('data-goto'), 'サブ課題パネルへ遷移');
    ok(panel.textContent.includes('構成課題'), 'サブパネルに親課題表記');

    // ノードクリックでも選択できる (SVG経由)
    APP.clearSelection();
    const someNode = document.querySelector('.node.major');
    someNode.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().selected === someNode.getAttribute('data-id'), 'SVGノードクリックで選択');

    // 一覧テーブル
    document.getElementById('tableBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(!document.getElementById('modalWrap').hidden, '一覧モーダル表示');
    const rows = document.querySelectorAll('#modal tr.trow');
    ok(rows.length === issues.length, `一覧テーブル ${rows.length}行`);
    // スコア降順チェック
    const scores = [...rows].map(r => parseInt(r.querySelector('td.num strong').textContent, 10));
    ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s), '一覧がスコア降順');
    rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(document.getElementById('modalWrap').hidden, '行クリックでモーダル閉');

    // 根拠モーダル
    document.getElementById('aboutBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(document.getElementById('modal').textContent.includes('機械的'), '根拠モーダルに算出説明');
    document.querySelector('#modal .mclose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // 戻る
    document.getElementById('backBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().mode === 'world', '地球ビューへ戻る');
    ok(document.getElementById('panel').hidden, 'パネルが閉じている');

    ok(errors.length === 0, '操作後もJSエラーなし' + (errors.length ? ': ' + errors[0] : ''));
  } catch (err) {
    failures++;
    console.error('  ✗ 例外:', err.message, err.stack && err.stack.split('\n')[1]);
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}, 300);
