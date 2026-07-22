// UI層: 地球ビュー⇄課題マップの描画・カメラ・操作 (エンジンはgraph.js)
'use strict';
(function () {
  const M = WORLD_MAP, D = ISSUE_DATA, G = GraphCore;
  const graph = G.buildGraph(D);
  const sim = G.createSim(graph);
  sim.settle(340);
  const cluster = G.clusterPositions(graph.nodes, M.japanCenter.x, M.japanCenter.y);

  const $ = id => document.getElementById(id);
  const app = $('app'), svg = $('stage'), defs = $('defs');
  const starLayer = $('starLayer'), mapLayer = $('mapLayer');
  const landG = $('landG'), japanG = $('japanG'), japanHalo = $('japanHalo');
  const edgeLayer = $('edgeLayer'), nodeLayer = $('nodeLayer');
  const panel = $('panel'), tooltip = $('tooltip');
  const modalWrap = $('modalWrap'), modal = $('modal'), modalBack = $('modalBack');
  const topbar = $('topbar'), legend = $('legend'), intro = $('intro');

  const SVGNS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : null;
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;

  let vw = window.innerWidth, vh = window.innerHeight;
  const isNarrow = () => vw < 720;

  // ===== defs: カテゴリ別ハロー・日本ハロー =====
  G.CAT_COLORS.forEach((c, i) => {
    const g = el('radialGradient', { id: 'halo-' + i }, defs);
    el('stop', { offset: '0%', 'stop-color': c, 'stop-opacity': 0.35 }, g);
    el('stop', { offset: '70%', 'stop-color': c, 'stop-opacity': 0.10 }, g);
    el('stop', { offset: '100%', 'stop-color': c, 'stop-opacity': 0 }, g);
  });
  {
    const g = el('radialGradient', { id: 'jhalo' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#6a93ff', 'stop-opacity': 0.34 }, g);
    el('stop', { offset: '100%', 'stop-color': '#6a93ff', 'stop-opacity': 0 }, g);
  }

  // ===== 星空 (画面座標・決定的) =====
  function buildStars() {
    starLayer.textContent = '';
    const rnd = G.mulberry32(777);
    for (let i = 0; i < 130; i++) {
      el('circle', {
        cx: (rnd() * vw).toFixed(1), cy: (rnd() * vh).toFixed(1),
        r: (rnd() < 0.85 ? 0.7 : 1.3), opacity: (0.15 + rnd() * 0.5).toFixed(2),
      }, starLayer);
    }
  }

  // ===== 地図 =====
  M.land.forEach(d => el('path', { d }, landG));
  M.japan.forEach(d => el('path', { d }, japanG));
  el('ellipse', { cx: M.japanCenter.x, cy: M.japanCenter.y, rx: 62, ry: 44, fill: 'url(#jhalo)' }, japanHalo);

  // ===== ノード/エッジDOM =====
  for (const e of graph.edges) {
    e.el = el('line', { class: e.kind === 'tree' ? 'edge-tree' : 'edge-link' }, edgeLayer);
  }
  // ノード構造: g(平行移動) > g.gfx(拡縮=セマンティックズーム) + ラベル(画面固定サイズ)
  const drawOrder = graph.nodes.slice().sort((a, b) => (a.type === 'major') - (b.type === 'major'));
  for (const nd of drawOrder) {
    const g = el('g', { class: 'node ' + nd.type, 'data-id': nd.id, tabindex: 0, role: 'button' }, nodeLayer);
    const gfx = el('g', { class: 'gfx' }, g);
    el('circle', { class: 'halo', r: nd.r * 1.75, fill: 'url(#halo-' + nd.catIndex + ')' }, gfx);
    el('circle', { class: 'core', r: nd.r, fill: nd.color, stroke: nd.color }, gfx);
    el('circle', { class: 'hit', r: nd.r + 12, fill: 'none', 'pointer-events': 'all' }, gfx);
    if (nd.type === 'major') {
      const em = el('text', { class: 'emoji', y: nd.r * 0.30 }, gfx);
      em.style.fontSize = (nd.r * 0.85).toFixed(0) + 'px';
      em.textContent = nd.issue.emoji || '●';
      nd.lbEl = el('text', { class: 'label' }, g);
      nd.lbEl.textContent = nd.issue.name;
      nd.scEl = el('text', { class: 'score' }, g);
      nd.scEl.textContent = '深刻度 ' + nd.score;
      g.setAttribute('aria-label', nd.issue.name + ' 深刻度' + nd.score);
    } else {
      nd.lbEl = el('text', { class: 'label' }, g);
      nd.lbEl.textContent = nd.sub.name;
      g.setAttribute('aria-label', nd.sub.name);
    }
    nd.el = g;
    nd.gfxEl = gfx;
  }

  // 隣接テーブル (フォーカス表示用)
  const adj = new Map();
  for (const nd of graph.nodes) adj.set(nd.id, new Set([nd.id]));
  for (const e of graph.edges) { adj.get(e.a.id).add(e.b.id); adj.get(e.b.id).add(e.a.id); }

  // ===== カメラ =====
  // graphCam: レイアウト空間→画面。mapCam: マップ座標→画面 (world⇄japanを遷移補間)
  const cam = { cx: 0, cy: 0, k: 1, tcx: 0, tcy: 0, tk: 1 };
  const worldCam = () => {
    const k = Math.min(vw / M.w, vh / M.h) * 0.96;
    return { cx: M.w / 2, cy: M.h / 2, k };
  };
  const japanCam = () => ({ cx: M.japanCenter.x, cy: M.japanCenter.y + 6, k: Math.min(vw, vh) / 34 });
  const mapCamAt = t => {
    const a = worldCam(), b = japanCam();
    return {
      cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t),
      k: Math.exp(lerp(Math.log(a.k), Math.log(b.k), t)),
    };
  };
  const mapToScreen = (mc, x, y) => [vw / 2 + (x - mc.cx) * mc.k, vh / 2 + (y - mc.cy) * mc.k];
  const layoutToScreen = (x, y) => [vw / 2 + (x - cam.cx) * cam.k, vh / 2 + (y - cam.cy) * cam.k];
  const screenToLayout = (sx, sy) => [(sx - vw / 2) / cam.k + cam.cx, (sy - vh / 2) / cam.k + cam.cy];

  function fitGraph() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const nd of graph.nodes) {
      x0 = Math.min(x0, nd.x - nd.r); y0 = Math.min(y0, nd.y - nd.r);
      x1 = Math.max(x1, nd.x + nd.r); y1 = Math.max(y1, nd.y + nd.r);
    }
    const pad = 70, topPad = 120;
    cam.tk = Math.max(0.28, Math.min((vw - pad * 2) / (x1 - x0), (vh - topPad - pad) / (y1 - y0), 1.25));
    cam.tcx = (x0 + x1) / 2;
    cam.tcy = (y0 + y1) / 2 - (topPad - pad) / 2 / cam.tk;
    return { x0, y0, x1, y1 };
  }

  // ===== 状態 =====
  let mode = 'world';           // 'world' | 'web'
  let trans = 0, transT = 0;    // 遷移補間
  let selected = null;
  let suppressClick = false;
  let ttNode = null;

  // ===== フレームループ =====
  let lastNow = null;
  function frame(now) {
    const dt = lastNow == null ? 16 : Math.min(48, now - lastNow);
    lastNow = now;

    // 遷移
    if (trans !== transT) {
      const step = dt / 620;
      trans = transT > trans ? Math.min(transT, trans + step) : Math.max(transT, trans - step);
      app.classList.add('moving');
      if (trans === transT) app.classList.remove('moving');
    }
    const t = easeIO(trans);

    // 物理
    if (mode === 'web' && sim.alpha > 0.004) sim.tick();

    // グラフカメラ追従
    cam.cx = lerp(cam.cx, cam.tcx, 0.13);
    cam.cy = lerp(cam.cy, cam.tcy, 0.13);
    cam.k = lerp(cam.k, cam.tk, 0.13);

    // マップ
    const mc = mapCamAt(t);
    mapLayer.setAttribute('transform',
      'translate(' + (vw / 2 - mc.cx * mc.k).toFixed(2) + ' ' + (vh / 2 - mc.cy * mc.k).toFixed(2) + ') scale(' + mc.k.toFixed(4) + ')');
    mapLayer.style.opacity = String(1 - t * 0.9);

    // ノード位置 (world: 日本上空クラスタ / web: 力学レイアウト を補間)
    // ノード本体はカメラ倍率で拡縮 (セマンティックズーム)、ラベルは画面固定サイズ
    nodeLayer.style.fontSize = (13 * Math.max(0.8, Math.min(1, cam.k))).toFixed(1) + 'px';
    for (const nd of graph.nodes) {
      const cp = cluster.get(nd.id);
      const [wx, wy] = mapToScreen(mc, cp.x, cp.y);
      const [gx, gy] = layoutToScreen(nd.x, nd.y);
      const x = lerp(wx, gx, t), y = lerp(wy, gy, t);
      const worldR = nd.type === 'major' ? (2.6 + nd.score / 100 * 4.6) : 1.1;
      const s = lerp(worldR / nd.r, cam.k, t);
      nd.sx = x; nd.sy = y;
      nd.el.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
      nd.gfxEl.setAttribute('transform', 'scale(' + s.toFixed(3) + ')');
      const edge = nd.r * s;
      nd.lbEl.setAttribute('y', (edge + (nd.type === 'major' ? 17 : 12)).toFixed(1));
      if (nd.scEl) nd.scEl.setAttribute('y', (edge + 31).toFixed(1));
    }
    for (const e of graph.edges) {
      e.el.setAttribute('x1', e.a.sx.toFixed(1)); e.el.setAttribute('y1', e.a.sy.toFixed(1));
      e.el.setAttribute('x2', e.b.sx.toFixed(1)); e.el.setAttribute('y2', e.b.sy.toFixed(1));
    }

    // ズーム段階でサブラベル表示
    app.classList.toggle('zoomed', cam.k > 1.02);

    // ツールチップ追従
    if (ttNode && !tooltip.hidden) positionTooltip();

    requestAnimationFrame(frame);
  }

  // ===== ビュー遷移 =====
  function enterWeb() {
    if (mode === 'web') return;
    mode = 'web';
    transT = 1;
    app.classList.remove('world');
    topbar.hidden = false;
    legend.hidden = false;
    sim.reheat(0.12);
    fitGraph();
  }
  function exitWeb() {
    if (mode === 'world') return;
    clearSelection();
    closeModal();
    mode = 'world';
    transT = 0;
    app.classList.add('world');
    topbar.hidden = true;
    legend.hidden = true;
    hideTooltip();
  }

  // ===== 選択 =====
  function setLit() {
    const litSet = selected ? adj.get(selected.id) : null;
    for (const nd of graph.nodes) nd.el.classList.toggle('lit', !!litSet && litSet.has(nd.id));
    for (const e of graph.edges) e.el.classList.toggle('edge-lit', !!selected && (e.a.id === selected.id || e.b.id === selected.id));
    for (const nd of graph.nodes) nd.el.classList.toggle('selected', !!selected && nd.id === selected.id);
  }
  function selectNode(id) {
    const nd = graph.byId.get(id);
    if (!nd) return;
    if (mode !== 'web') enterWeb();
    selected = nd;
    app.classList.add('focus');
    setLit();
    // パネルに隠れない位置へパン
    if (isNarrow()) {
      cam.tcx = nd.x;
      cam.tcy = nd.y + (vh * 0.16) / cam.tk;
    } else {
      cam.tcx = nd.x + 190 / cam.tk;
      cam.tcy = nd.y;
    }
    renderPanel(nd);
    panel.hidden = false;
    panel.scrollTop = 0;
    hideTooltip();
  }
  function clearSelection() {
    selected = null;
    app.classList.remove('focus');
    setLit();
    panel.hidden = true;
  }

  // ===== パネル =====
  const fmtMan = v => v >= 10000 ? (v / 10000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + '億人' : Math.round(v).toLocaleString() + '万人';
  const catChip = ci => '<span class="catchip"><i style="background:' + G.CAT_COLORS[ci] + '"></i>' + esc(G.CATEGORIES[ci]) + '</span>';
  const statRow = st => {
    const u = safeUrl(st.source_url);
    return '<div class="stat"><div class="kv"><div class="k">' + esc(st.label) + '</div>'
      + '<div class="v">' + esc(st.value) + '<small>' + esc(st.year) + '年・' + esc(st.source_name) + '</small></div></div>'
      + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">出典↗</a>' : '')
      + '</div>';
  };
  const sevDots = sev => '●'.repeat(Math.round(sev)) + '○'.repeat(5 - Math.round(sev));

  function renderPanel(nd) {
    if (nd.type === 'major') renderMajorPanel(nd);
    else renderSubPanel(nd);
  }

  function renderMajorPanel(nd) {
    const I = nd.issue, b = nd.breakdown, si = I.score_inputs;
    const conf = (D.meta && D.meta.confidences || []).find(c => c.id === I.id);
    const linkedEdges = graph.edges.filter(e => e.kind === 'link' && (e.a.id === nd.id || e.b.id === nd.id));
    panel.innerHTML =
      '<button class="pclose" data-act="close" aria-label="閉じる">✕</button>'
      + '<div class="phead"><div class="pemoji">' + esc(I.emoji) + '</div><div>'
      + '<h2>' + esc(I.name) + '</h2><div class="ptagline">' + esc(I.tagline) + '</div>' + catChip(nd.catIndex)
      + '</div></div>'
      + '<div class="scorebox">'
      + '<div class="shead"><span class="snum" style="color:' + nd.color + '">' + nd.score + '</span><span class="slabel">深刻度スコア /100 (円の大きさ)</span></div>'
      + sbar('影響人数', b.pop, fmtMan(si.affected_population_man))
      + sbar('経済', b.econ, '年約' + esc(si.econ_impact_trillion_yen) + '兆円')
      + sbar('緊急度', b.urg, esc(si.urgency) + ' / 5')
      + '<div class="snote">' + esc(si.affected_note) + ' / ' + esc(si.econ_note) + ' / ' + esc(si.urgency_rationale) + '</div>'
      + '</div>'
      + '<h3>現状</h3><p class="body">' + esc(I.overview) + '</p>'
      + '<h3>なぜ課題か</h3><p class="body">' + esc(I.why_problem) + '</p>'
      + '<h3>これから</h3><p class="body">' + esc(I.future_outlook) + '</p>'
      + '<h3>主要データ</h3>' + I.key_stats.map(statRow).join('')
      + '<h3>構成する課題 (' + I.sub_issues.length + ')</h3><div class="subgrid">'
      + I.sub_issues.map(s => {
        const sn = graph.byId.get(s.id);
        return '<button class="subitem" data-goto="' + esc(s.id) + '"><i style="background:' + nd.color + ';width:' + (7 + s.severity * 1.6) + 'px;height:' + (7 + s.severity * 1.6) + 'px"></i>'
          + '<span class="sname">' + esc(s.name) + '</span><span class="sev">' + sevDots(s.severity) + '</span></button>';
      }).join('') + '</div>'
      + (linkedEdges.length ? '<h3>つながる課題</h3><div class="subgrid">'
        + linkedEdges.map(e => {
          const other = e.a.id === nd.id ? e.b : e.a;
          return '<button class="subitem relitem" data-goto="' + esc(other.id) + '"><span><span class="relbadge">' + esc(e.relation) + '</span>'
            + '<span class="sname">' + esc(other.issue.emoji) + ' ' + esc(other.issue.name) + '</span></span>'
            + '<span class="rel">' + esc(e.description) + '</span></button>';
        }).join('') + '</div>' : '')
      + '<div class="pdisclaimer">公的統計・調査等の出典に基づく要約であり、特定の政治的立場を支持するものではありません。スコアは出典データからの機械的算出です（「大きさの根拠」参照）。'
      + (conf && conf.confidence === 'low' ? '<br>⚠ この課題の一部数値は推計・要再確認です。' : '')
      + '<br>データ時点: ' + esc(D.generated) + '</div>';
  }

  function sbar(name, ratio, val) {
    return '<div class="sbar"><span class="sname">' + esc(name) + '</span>'
      + '<span class="strack"><span class="sfill" style="width:' + Math.round(ratio * 100) + '%"></span></span>'
      + '<span class="sval">' + val + '</span></div>';
  }

  function renderSubPanel(nd) {
    const parent = graph.byId.get(nd.parentId);
    const S = nd.sub;
    const siblings = parent.issue.sub_issues.filter(s => s.id !== S.id);
    panel.innerHTML =
      '<button class="pclose" data-act="close" aria-label="閉じる">✕</button>'
      + '<div class="pparent">└ <button data-goto="' + esc(parent.id) + '">' + esc(parent.issue.emoji) + ' ' + esc(parent.issue.name) + '</button> の構成課題</div>'
      + '<div class="phead"><div>'
      + '<h2>' + esc(S.name) + '</h2>' + catChip(nd.catIndex)
      + '</div></div>'
      + '<div class="scorebox"><div class="shead"><span class="snum" style="color:' + nd.color + ';font-size:22px">' + sevDots(S.severity) + '</span><span class="slabel">深刻度 ' + esc(S.severity) + ' / 5</span></div></div>'
      + '<h3>概要</h3><p class="body">' + esc(S.description) + '</p>'
      + '<h3>キーデータ</h3>' + statRow(S.key_stat)
      + (siblings.length ? '<h3>同じ親の課題</h3><div class="subgrid">'
        + siblings.map(s => '<button class="subitem" data-goto="' + esc(s.id) + '"><i style="background:' + nd.color + ';width:' + (7 + s.severity * 1.6) + 'px;height:' + (7 + s.severity * 1.6) + 'px"></i><span class="sname">' + esc(s.name) + '</span><span class="sev">' + sevDots(s.severity) + '</span></button>').join('')
        + '</div>' : '')
      + '<div class="pdisclaimer">出典に基づく要約。データ時点: ' + esc(D.generated) + '</div>';
  }

  panel.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { selectNode(go.getAttribute('data-goto')); return; }
    if (e.target.closest('[data-act="close"]')) clearSelection();
  });

  // ===== ツールチップ =====
  let ttX = 0, ttY = 0;
  function positionTooltip() {
    const w = tooltip.offsetWidth || 180, h = tooltip.offsetHeight || 60;
    let x = ttX + 16, y = ttY + 14;
    if (x + w > vw - 8) x = ttX - w - 12;
    if (y + h > vh - 8) y = ttY - h - 12;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }
  function showTooltip(nd) {
    ttNode = nd;
    tooltip.innerHTML = nd.type === 'major'
      ? '<div class="tt-name">' + esc(nd.issue.emoji) + ' ' + esc(nd.issue.name) + '</div><div class="tt-sub">' + esc(nd.issue.tagline) + '</div><div class="tt-score">深刻度 ' + nd.score + ' / 100 ・ タップで詳細</div>'
      : '<div class="tt-name">' + esc(nd.sub.name) + '</div><div class="tt-score">深刻度 ' + sevDots(nd.sub.severity) + ' ・ タップで詳細</div>';
    tooltip.hidden = false;
    positionTooltip();
  }
  function hideTooltip() { tooltip.hidden = true; ttNode = null; }

  svg.addEventListener('mousemove', (e) => {
    if (mode !== 'web' || dragState) { return; }
    ttX = e.clientX; ttY = e.clientY;
    const g = e.target.closest && e.target.closest('.node');
    if (g) {
      const nd = graph.byId.get(g.getAttribute('data-id'));
      if (nd !== ttNode) showTooltip(nd);
      else positionTooltip();
    } else hideTooltip();
  });
  svg.addEventListener('mouseleave', hideTooltip);

  // ===== クリック =====
  svg.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; return; }
    if (mode === 'world') { enterWeb(); return; }
    const g = e.target.closest && e.target.closest('.node');
    if (g) selectNode(g.getAttribute('data-id'));
    else if (trans === 1) clearSelection();
  });
  nodeLayer.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest && e.target.closest('.node');
    if (g) { e.preventDefault(); selectNode(g.getAttribute('data-id')); }
  });

  // ===== ドラッグ / パン / ピンチ / ホイール =====
  let dragState = null;
  const pointers = new Map();
  let pinch = null;

  svg.addEventListener('pointerdown', (e) => {
    if (mode !== 'web' || trans < 1) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p2.x - p1.x, p2.y - p1.y), k: cam.tk };
      dragState = null;
      return;
    }
    const g = e.target.closest && e.target.closest('.node');
    if (g) {
      const nd = graph.byId.get(g.getAttribute('data-id'));
      dragState = { type: 'node', nd, moved: false, sx: e.clientX, sy: e.clientY };
    } else {
      dragState = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: cam.tcx, cy: cam.tcy, moved: false };
    }
    if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (_) { } }
  });

  svg.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (pinch && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      cam.tk = Math.max(0.25, Math.min(3, pinch.k * d / pinch.d));
      return;
    }
    if (!dragState) return;
    const dx = e.clientX - dragState.sx, dy = e.clientY - dragState.sy;
    if (!dragState.moved && Math.hypot(dx, dy) > 5) dragState.moved = true;
    if (!dragState.moved) return;
    hideTooltip();
    if (dragState.type === 'node') {
      const [lx, ly] = screenToLayout(e.clientX, e.clientY);
      dragState.nd.fx = lx;
      dragState.nd.fy = ly;
      sim.reheat(0.35);
    } else {
      cam.tcx = dragState.cx - dx / cam.k;
      cam.tcy = dragState.cy - dy / cam.k;
      cam.cx = cam.tcx; cam.cy = cam.tcy;
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!dragState) return;
    if (dragState.type === 'node') {
      dragState.nd.fx = null;
      dragState.nd.fy = null;
      sim.reheat(0.18);
    }
    if (dragState.moved) suppressClick = true;
    dragState = null;
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', (e) => {
    if (mode !== 'web') return;
    e.preventDefault();
    const k2 = Math.max(0.25, Math.min(3, cam.tk * Math.exp(-e.deltaY * 0.0016)));
    // カーソル位置を固定点にズーム
    const [lx, ly] = screenToLayout(e.clientX, e.clientY);
    cam.tcx = lx - (e.clientX - vw / 2) / k2;
    cam.tcy = ly - (e.clientY - vh / 2) / k2;
    cam.tk = k2;
  }, { passive: false });

  // ===== 凡例 =====
  function buildLegend() {
    const present = [...new Set(graph.nodes.filter(n => n.type === 'major').map(n => n.catIndex))].sort((a, b) => a - b);
    $('legendCats').innerHTML = present.map(ci =>
      '<span class="lchip"><i style="background:' + G.CAT_COLORS[ci] + '"></i>' + esc(G.CATEGORIES[ci]) + '</span>').join('');
  }

  // ===== モーダル =====
  function openModal(html) { modal.innerHTML = '<button class="mclose" aria-label="閉じる">✕</button>' + html; modalWrap.hidden = false; }
  function closeModal() { modalWrap.hidden = true; }
  modalBack.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target.closest('.mclose')) { closeModal(); return; }
    const tr = e.target.closest('tr[data-goto]');
    if (tr) { closeModal(); selectNode(tr.getAttribute('data-goto')); }
  });

  $('aboutBtn').addEventListener('click', () => openModal(
    '<h2>円の大きさ = 深刻度スコアの算出方法</h2>'
    + '<p>スコアは各課題の出典データから<strong>機械的に</strong>算出しており、編集上の主観による順位付けではありません。</p>'
    + '<p><code>スコア = 40% × 影響人数 + 35% × 経済インパクト + 25% × 緊急度</code></p>'
    + '<p>・<strong>影響人数</strong>: 直接・間接に影響を受ける人数（対数スケール、1.2億人=全国民で飽和）<br>'
    + '・<strong>経済インパクト</strong>: 年間の経済損失・財政負担等の兆円換算（対数スケール、年100兆円で飽和）<br>'
    + '・<strong>緊急度</strong>: 今後5年での不可逆性を1〜5で評価（出典の将来推計に基づく）</p>'
    + '<p>対数スケールを使うのは、影響人数や金額が桁で異なる課題を同じ地図に載せるためです。各数値の根拠と出典は、課題をタップすると出る詳細パネルに記載しています。</p>'
    + '<p>掲載課題の選定は、政府世論調査・省庁白書・国際機関の対日評価・主要シンクタンクの提言を横断して複数出典で挙がったものを採用しています。データ時点: ' + esc(D.generated) + '</p>'
  ));

  $('tableBtn').addEventListener('click', () => {
    const majors = graph.nodes.filter(n => n.type === 'major').sort((a, b) => b.score - a.score);
    openModal(
      '<h2>課題一覧（スコア順）</h2>'
      + '<table><thead><tr><th>課題</th><th>スコア</th><th>影響人数</th><th>経済/年</th><th>緊急度</th></tr></thead><tbody>'
      + majors.map(nd => '<tr class="trow" data-goto="' + esc(nd.id) + '">'
        + '<td><span class="tdot" style="background:' + nd.color + '"></span>' + esc(nd.issue.emoji) + ' ' + esc(nd.issue.name) + '</td>'
        + '<td class="num"><strong>' + nd.score + '</strong></td>'
        + '<td class="num">' + fmtMan(nd.issue.score_inputs.affected_population_man) + '</td>'
        + '<td class="num">' + esc(nd.issue.score_inputs.econ_impact_trillion_yen) + '兆円</td>'
        + '<td class="num">' + esc(nd.issue.score_inputs.urgency) + '/5</td>'
        + '</tr>').join('')
      + '</tbody></table>'
    );
  });

  $('backBtn').addEventListener('click', exitWeb);
  $('enterBtn').addEventListener('click', enterWeb);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalWrap.hidden) closeModal();
    else if (selected) clearSelection();
    else if (mode === 'web') exitWeb();
  });

  window.addEventListener('resize', () => {
    vw = window.innerWidth; vh = window.innerHeight;
    buildStars();
    if (mode === 'web' && !selected) fitGraph();
  });

  $('dataDate').textContent = 'データ時点 ' + D.generated + ' ・ 出典付き' + (D.placeholder ? ' ・ ⚠プレースホルダー' : '');

  // ===== 起動 =====
  buildStars();
  buildLegend();
  requestAnimationFrame(frame);

  // e2e用フック
  window.__APP__ = {
    graph, sim, selectNode, clearSelection, enterWeb, exitWeb,
    state: () => ({ mode, trans, selected: selected && selected.id }),
  };
})();
