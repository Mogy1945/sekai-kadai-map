// E2E: データ整合性 + ヘッドレス物理 + jsdomでUI操作フロー検証 (多国対応)
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

ok(ISSUE_DATA.regions.length >= 2, `地域 ${ISSUE_DATA.regions.length}件 (>=2)`);
const globalIds = new Set();
for (const rd of ISSUE_DATA.regions) {
  const issues = rd.issues;
  ok(issues.length >= 3, `${rd.id}: 大課題 ${issues.length}件 (>=3)`);
  ok(!!WORLD_MAP.regions[rd.id], `${rd.id}: mapdataに地域あり`);
  const ids = new Set(issues.map(i => i.id));
  ok(ids.size === issues.length, `${rd.id}: 大課題IDが一意`);

  let statOk = true, linkOk = true, dup = false, catOk = true, urlOk = true, nsOk = true;
  for (const I of issues) {
    if (!I.id.startsWith(rd.id + '-')) nsOk = false;
    if (globalIds.has(I.id)) { dup = true; console.error('    地域間ID衝突:', I.id); }
    globalIds.add(I.id);
    if (!GraphCore.CATEGORIES.includes(I.category)) { catOk = false; console.error('    不明カテゴリ:', I.id, I.category); }
    if (!(I.key_stats && I.key_stats.length >= 3)) { statOk = false; console.error('    key_stats不足:', I.id); }
    for (const st of I.key_stats || []) {
      if (!/^https?:\/\//.test(st.source_url || '')) { urlOk = false; console.error('    不正URL:', I.id, st.label); }
    }
    for (const s of I.sub_issues || []) {
      if (globalIds.has(s.id)) { dup = true; console.error('    サブID重複:', s.id); }
      globalIds.add(s.id);
      if (!/^https?:\/\//.test((s.key_stat || {}).source_url || '')) { urlOk = false; console.error('    サブ不正URL:', s.id); }
    }
    for (const l of I.links_to_other_issues || []) {
      if (!ids.has(l.target_id)) { linkOk = false; console.error('    リンク先不明:', I.id, '→', l.target_id); }
    }
    const { score } = GraphCore.computeScore(I.score_inputs);
    if (!(score >= 0 && score <= 100)) { failures++; console.error('  ✗ スコア範囲外:', I.id, score); }
  }
  ok(nsOk, `${rd.id}: IDが地域プレフィクス付き`);
  ok(catOk, `${rd.id}: カテゴリが定義済み7種の中`);
  ok(statOk, `${rd.id}: 全課題にkey_stats>=3`);
  ok(urlOk, `${rd.id}: 全出典URLがhttp(s)`);
  ok(!dup, `${rd.id}: ID一意(地域横断)`);
  ok(linkOk, `${rd.id}: 課題間リンクのtarget_idが実在(地域内)`);
}

// ---------- 2. ヘッドレス物理 (地域ごと) ----------
console.log('[2] 力学シミュレーション');
const graphs = {};
for (const rd of ISSUE_DATA.regions) {
  const graph = GraphCore.buildGraph(rd);
  graphs[rd.id] = graph;
  const expectN = rd.issues.length + rd.issues.reduce((a, i) => a + i.sub_issues.length, 0);
  ok(graph.nodes.length === expectN, `${rd.id}: ノード数=${graph.nodes.length}`);
  const sim = GraphCore.createSim(graph);
  sim.settle(500);
  let nan = false, far = false;
  for (const nd of graph.nodes) {
    if (!isFinite(nd.x) || !isFinite(nd.y)) nan = true;
    if (Math.hypot(nd.x, nd.y) > 4000) far = true;
  }
  ok(!nan && !far, `${rd.id}: 座標が有限かつ発散なし`);
  ok(sim.alpha < 0.1, `${rd.id}: 収束 (alpha=${sim.alpha.toFixed(4)})`);
  let overlap = 0;
  const majors = graph.nodes.filter(n => n.type === 'major');
  for (let i = 0; i < majors.length; i++) for (let j = i + 1; j < majors.length; j++) {
    const a = majors[i], b = majors[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.9) overlap++;
  }
  ok(overlap === 0, `${rd.id}: 大課題ノード同士の重なりなし`);

  const mreg = WORLD_MAP.regions[rd.id];
  const spread = Math.max(5, Math.min(14, Math.min(mreg.bbox.w, mreg.bbox.h) * 0.33));
  const cluster = GraphCore.clusterPositions(graph.nodes, mreg.center.x, mreg.center.y, spread, GraphCore.hashCode(rd.id));
  let clusterOk = true;
  for (const [, p] of cluster) {
    if (Math.hypot(p.x - mreg.center.x, p.y - mreg.center.y) > spread * 2.2) clusterOk = false;
  }
  ok(clusterOk, `${rd.id}: クラスタが自国近傍 (spread=${spread.toFixed(1)})`);
}

// 2国のクラスタが完全に混ざらないこと (中心間距離 > 各spreadの和の半分)
{
  const [ra, rb] = ISSUE_DATA.regions;
  const ma = WORLD_MAP.regions[ra.id], mb = WORLD_MAP.regions[rb.id];
  const d = Math.hypot(ma.center.x - mb.center.x, ma.center.y - mb.center.y);
  ok(d > 10, `2国の中心距離 ${d.toFixed(1)} (>10)`);
}

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
    const R = ISSUE_DATA.regions;
    const totalNodes = Object.values(graphs).reduce((a, g) => a + g.nodes.length, 0);
    ok(!!APP, 'アプリ初期化 (window.__APP__)');
    ok(errors.length === 0, 'JSエラーなし' + (errors.length ? ': ' + errors[0] : ''));
    ok(document.querySelectorAll('.node').length === totalNodes, `ノードDOM ${totalNodes}個 (全地域)`);
    ok(document.querySelectorAll('#worldLabels .country-label').length === R.length, '国ラベル描画');
    ok(document.querySelectorAll('.regionland').length >= 2, '対象国ハイライト描画');
    ok(document.getElementById('app').classList.contains('world'), '初期状態=worldビュー');

    // イントロに国ボタン
    const btns = document.querySelectorAll('#introBtns .enterBtn');
    ok(btns.length === R.length, `国選択ボタン ${btns.length}個`);

    // 日本へ
    btns[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().mode === 'web' && APP.state().region === R[0].id, `${R[0].id}のwebビューへ`);
    ok(document.getElementById('regionTitle').textContent.includes(R[0].name), 'タイトルに国名');

    // 大課題を選択
    const firstIssue = R[0].issues[0];
    APP.selectNode(firstIssue.id);
    const panel = document.getElementById('panel');
    ok(!panel.hidden, '詳細パネル表示');
    ok(panel.textContent.includes(firstIssue.name), 'パネルに課題名');
    ok(panel.querySelectorAll('.stat').length >= 3, 'パネルに統計>=3');
    ok(panel.querySelectorAll('a[href^="http"]').length >= 3, 'パネルに出典リンク>=3');
    ok(document.getElementById('app').classList.contains('focus'), '近傍フォーカス発動');

    // サブ課題へ遷移
    const subBtn = panel.querySelector('.subitem[data-goto]');
    subBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().selected === subBtn.getAttribute('data-goto'), 'サブ課題パネルへ遷移');

    // SVGノードクリック
    APP.clearSelection();
    const someNode = document.querySelector('.rnodes[data-region="' + R[0].id + '"] .node.major');
    someNode.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(APP.state().selected === someNode.getAttribute('data-id'), 'SVGノードクリックで選択');

    // 一覧テーブル (アクティブ地域のみ)
    document.getElementById('tableBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const rows = document.querySelectorAll('#modal tr.trow');
    ok(rows.length === R[0].issues.length, `一覧テーブル ${rows.length}行 (${R[0].id}のみ)`);
    const scores = [...rows].map(r => parseInt(r.querySelector('td.num strong').textContent, 10));
    ok(scores.every((s, i) => i === 0 || scores[i - 1] >= s), '一覧がスコア降順');
    rows[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(document.getElementById('modalWrap').hidden, '行クリックでモーダル閉');

    // 韓国へスライド飛行 (連続空間)
    APP.clearSelection();
    APP.flyTo(R[1].id);
    ok(APP.state().mode === 'web', 'flyToでもwebビューのまま (地球を経由しない)');
    ok(APP.state().region === R[1].id, `${R[1].id}へ切替`);
    // 隣国チップDOMが存在
    ok(document.querySelectorAll('#neighborChips .nchip').length === R.length, '隣国チップDOM');
    ok(document.getElementById('regionTitle').textContent.includes(R[1].name), 'タイトルが韓国に更新');
    const krIssue = R[1].issues[0];
    APP.selectNode(krIssue.id);
    ok(panel.textContent.includes(krIssue.name), '韓国課題のパネル表示');
    document.getElementById('tableBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok(document.querySelectorAll('#modal tr.trow').length === R[1].issues.length, `韓国の一覧 ${R[1].issues.length}行`);
    document.querySelector('#modal .mclose').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // 地域またぎselectNode (日本の課題を直接選択→地域も切替わる)
    APP.selectNode(firstIssue.id);
    ok(APP.state().region === R[0].id, '地域またぎselectNodeで地域切替');

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
