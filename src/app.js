// UI層: 地球ビュー⇄連続課題空間の描画・カメラ・操作 (エンジンはgraph.js)
// 全地域のネットワークは地理方向を保った1つの空間に展開され、パンで隣国へ滑らかに移動できる
'use strict';
(function () {
  const M = WORLD_MAP, D = ISSUE_DATA, G = GraphCore;

  const $ = id => document.getElementById(id);
  const app = $('app'), svg = $('stage');
  const mapLayer = $('mapLayer');
  const landG = $('landG'), regionsG = $('regionsG');
  const worldLabels = $('worldLabels');
  const edgeLayer = $('edgeLayer'), nodeLayer = $('nodeLayer');
  const panel = $('panel'), tooltip = $('tooltip');
  const modalWrap = $('modalWrap'), modal = $('modal'), modalBack = $('modalBack');
  const topbar = $('topbar'), legend = $('legend'), chips = $('neighborChips');

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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let vw = window.innerWidth, vh = window.innerHeight;
  const isNarrow = () => vw < 720;

  // ===== 地域セットアップ =====
  const regions = D.regions.map((rd) => {
    const graph = G.buildGraph(rd);
    const sim = G.createSim(graph);
    // ビルド時ベイク済みレイアウト(位置+速度+alpha)があれば起動時のsettle計算を丸ごと省略
    const baked = (typeof PRECOMPUTED_LAYOUT !== 'undefined') && PRECOMPUTED_LAYOUT[rd.id];
    if (baked && graph.nodes.every(nd => baked.nodes[nd.id])) {
      for (const nd of graph.nodes) {
        const p = baked.nodes[nd.id];
        nd.x = p[0]; nd.y = p[1]; nd.vx = p[2]; nd.vy = p[3];
      }
      sim.setAlpha(baked.alpha);
    } else {
      sim.settle(340);
    }
    const map = M.regions[rd.id];
    if (!map) throw new Error('mapdataに地域なし: ' + rd.id);
    const spread = clamp(Math.min(map.bbox.w, map.bbox.h) * 0.33, 5, 14);
    const cluster = G.clusterPositions(graph.nodes, map.center.x, map.center.y, spread, G.hashCode(rd.id));
    let R = 0;
    for (const nd of graph.nodes) R = Math.max(R, Math.hypot(nd.x, nd.y) + nd.r);
    return { data: rd, graph, sim, map, spread, cluster, R: R + 80, anchor: { x: 0, y: 0 } };
  });
  const byId = new Map();
  for (const rn of regions) for (const nd of rn.graph.nodes) { nd.regionRef = rn; byId.set(nd.id, nd); }

  // ネットワーク空間のアンカー: 地理方向を保ち、ネットワーク同士が重ならない倍率Sで配置
  const geo0 = regions[0].map.center;
  let S = 40;
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i], b = regions[j];
    const gd = Math.hypot(a.map.center.x - b.map.center.x, a.map.center.y - b.map.center.y) || 1;
    S = Math.max(S, (a.R + b.R + 240) / gd);
  }
  for (const rn of regions) {
    rn.anchor.x = (rn.map.center.x - geo0.x) * S;
    rn.anchor.y = (rn.map.center.y - geo0.y) * S;
  }

  // ===== 地図 =====
  M.land.forEach(d => el('path', { d }, landG));
  for (const rn of regions) {
    rn.map.paths.forEach(d => el('path', { d, class: 'regionland' }, regionsG));
    rn.labelEl = el('text', { class: 'country-label' }, worldLabels);
    rn.labelEl.textContent = rn.data.flag + ' ' + rn.data.name;
  }

  // ===== ノード/エッジDOM (地域ごとにグループ化) =====
  for (const rn of regions) {
    rn.edgeG = el('g', { class: 'redges', 'data-region': rn.data.id }, edgeLayer);
    rn.nodeG = el('g', { class: 'rnodes', 'data-region': rn.data.id }, nodeLayer);
    for (const e of rn.graph.edges) {
      e.el = el('line', { class: e.kind === 'tree' ? 'edge-tree' : 'edge-link' }, rn.edgeG);
    }
    const drawOrder = rn.graph.nodes.slice().sort((a, b) => (a.type === 'major') - (b.type === 'major'));
    for (const nd of drawOrder) buildNodeDom(nd, rn.nodeG, rn.data.name);
  }

  function buildNodeDom(nd, parentG, regionName) {
    const g = el('g', { class: 'node ' + nd.type, 'data-id': nd.id, tabindex: 0, role: 'button' }, parentG);
    const gfx = el('g', { class: 'gfx' }, g);
    if (nd.type === 'shared') {
      el('circle', { class: 'ring', r: nd.r + 8 }, gfx);
    }
    el('circle', { class: 'plate', r: nd.r }, gfx); // 白下地: 海の上でも色が濁らない
    el('circle', { class: 'core', r: nd.r, fill: nd.color, stroke: nd.color }, gfx);
    el('circle', { class: 'hit', r: nd.r + 12, fill: 'none', 'pointer-events': 'all' }, gfx);
    if (nd.type !== 'sub') {
      const em = el('text', { class: 'emoji', y: nd.r * 0.30 }, gfx);
      em.style.fontSize = (nd.r * 0.85).toFixed(0) + 'px';
      em.textContent = nd.issue.emoji || '●';
      nd.lbEl = el('text', { class: 'label' }, g);
      nd.lbEl.textContent = nd.issue.name;
      nd.scEl = el('text', { class: 'score' }, g);
      nd.scEl.textContent = '深刻度 ' + nd.score;
      g.setAttribute('aria-label', (regionName || '国際共通課題') + ' ' + nd.issue.name + ' 深刻度' + nd.score);
    } else {
      nd.lbEl = el('text', { class: 'label' }, g);
      nd.lbEl.textContent = nd.sub.name;
      g.setAttribute('aria-label', nd.sub.name);
    }
    nd.el = g;
    nd.gfxEl = gfx;
  }

  // ===== 国際共通課題 (国と国の間の海上に配置し、各国の課題と太くつながる) =====
  const sharedNodes = [];
  const intlEdges = [];
  const sharedCluster = new Map();
  const sharedEdgeG = el('g', { class: 'redges shared' }, edgeLayer);
  const sharedNodeG = el('g', { class: 'rnodes shared' }, nodeLayer);
  if (D.shared && D.shared.issues) {
    const rnd = G.mulberry32(424242);
    for (const si of D.shared.issues) {
      const invRegions = (si.involved || []).map(v => regions.find(r => r.data.id === v.region)).filter(Boolean);
      if (invRegions.length < 2) continue;
      const { score, pop, econ, urg } = G.computeScore(si.score_inputs);
      const catIndex = Math.max(0, G.CATEGORIES.indexOf(si.category));
      let ax = 0, ay = 0, gx = 0, gy = 0;
      for (const r of invRegions) { ax += r.anchor.x; ay += r.anchor.y; gx += r.map.center.x; gy += r.map.center.y; }
      ax /= invRegions.length; ay /= invRegions.length; gx /= invRegions.length; gy /= invRegions.length;
      const a0 = rnd() * Math.PI * 2;
      const nd = {
        id: si.id, type: 'shared', issue: si, score,
        breakdown: { pop, econ, urg },
        catIndex, color: G.CAT_COLORS[catIndex],
        r: G.majorRadius(score) * 0.95,
        x: ax + Math.cos(a0) * 80, y: ay + Math.sin(a0) * 80,
        vx: 0, vy: 0, fx: null, fy: null,
        centroid: { x: ax, y: ay }, invRegions,
        regionRef: null, sx: 0, sy: 0,
      };
      sharedNodes.push(nd);
      byId.set(nd.id, nd);
      sharedCluster.set(nd.id, { x: gx + (rnd() - 0.5) * 6, y: gy + (rnd() - 0.5) * 5 });
    }
    // 配置緩和: 共通課題同士を離し、各国ネットワークの外側へ押し出し、関与国の重心へ弱く引き戻す (決定的)
    for (let it = 0; it < 140; it++) {
      for (const nd of sharedNodes) {
        nd.x += (nd.centroid.x - nd.x) * 0.02;
        nd.y += (nd.centroid.y - nd.y) * 0.02;
        for (const other of sharedNodes) {
          if (other === nd) continue;
          const dx = nd.x - other.x, dy = nd.y - other.y;
          const d = Math.hypot(dx, dy) || 1;
          const min = nd.r + other.r + 220;
          if (d < min) { nd.x += dx / d * (min - d) * 0.3; nd.y += dy / d * (min - d) * 0.3; }
        }
        for (const rn of regions) {
          const dx = nd.x - rn.anchor.x, dy = nd.y - rn.anchor.y;
          const d = Math.hypot(dx, dy) || 1;
          const min = rn.R + nd.r + 170;
          if (d < min) { nd.x += dx / d * (min - d) * 0.35; nd.y += dy / d * (min - d) * 0.35; }
        }
      }
    }
    for (const nd of sharedNodes) {
      for (const v of nd.issue.involved) {
        for (const rid of v.related_issue_ids || []) {
          const target = byId.get(rid);
          if (!target || target.type === 'shared') continue;
          intlEdges.push({ a: nd, b: target, kind: 'intl', el: el('line', { class: 'edge-intl' }, sharedEdgeG) });
        }
      }
      buildNodeDom(nd, sharedNodeG, null);
    }
  }

  // 隣接テーブル (フォーカス表示用)
  const adj = new Map();
  for (const [id] of byId) adj.set(id, new Set([id]));
  for (const rn of regions) for (const e of rn.graph.edges) { adj.get(e.a.id).add(e.b.id); adj.get(e.b.id).add(e.a.id); }
  for (const e of intlEdges) { adj.get(e.a.id).add(e.b.id); adj.get(e.b.id).add(e.a.id); }

  // ===== カメラ (ネットワーク空間の単一カメラ) =====
  const cam = { cx: 0, cy: 0, k: 1, tcx: 0, tcy: 0, tk: 1 };
  const worldCam = () => {
    const k = Math.min(vw / M.w, vh / M.h) * 0.96;
    return { cx: M.w / 2, cy: M.h / 2, k };
  };
  // 地図カメラはネットワークカメラからアフィン導出 (ネットワーク空間 = (地図座標 - geo0) × S)
  const derivedMapCam = () => ({
    cx: geo0.x + cam.cx / S,
    cy: geo0.y + cam.cy / S,
    k: cam.k * S,
  });
  const mapCamAt = (t) => {
    const a = worldCam();
    if (t === 0) return a;
    const b = derivedMapCam();
    return {
      cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t),
      k: Math.exp(lerp(Math.log(a.k), Math.log(b.k), t)),
    };
  };
  const mapToScreen = (mc, x, y) => [vw / 2 + (x - mc.cx) * mc.k, vh / 2 + (y - mc.cy) * mc.k];
  const netToScreen = (x, y) => [vw / 2 + (x - cam.cx) * cam.k, vh / 2 + (y - cam.cy) * cam.k];
  const screenToNet = (sx, sy) => [(sx - vw / 2) / cam.k + cam.cx, (sy - vh / 2) / cam.k + cam.cy];

  function regionFit(rn) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const nd of rn.graph.nodes) {
      x0 = Math.min(x0, rn.anchor.x + nd.x - nd.r); y0 = Math.min(y0, rn.anchor.y + nd.y - nd.r);
      x1 = Math.max(x1, rn.anchor.x + nd.x + nd.r); y1 = Math.max(y1, rn.anchor.y + nd.y + nd.r);
    }
    const pad = 70, topPad = 120;
    const k = clamp(Math.min((vw - pad * 2) / (x1 - x0), (vh - topPad - pad) / (y1 - y0)), 0.28, 1.25);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - (topPad - pad) / 2 / k, k };
  }

  // ===== 状態 =====
  let mode = 'world';           // 'world' | 'web'
  let curR = regions[0];        // カメラに最も近い地域 (UI表示用)
  let trans = 0, transT = 0;
  let selected = null;
  let suppressClickUntil = 0;
  let ttNode = null;
  let flight = null;            // Googleアース風フライト {t, dur, from, to, arc}

  // 長距離はズームアウト→巡航→ズームインの弧を描いて飛ぶ
  function startFlight(to, dur) {
    const from = { cx: cam.cx, cy: cam.cy, k: cam.k };
    const dist = Math.hypot(to.cx - from.cx, to.cy - from.cy);
    const arc = clamp(Math.log(1 + dist * Math.min(from.k, to.k) / (Math.max(vw, vh) * 0.9)), 0, 1.1);
    flight = { t: 0, dur: dur || (900 + clamp(dist * 0.12, 0, 600)), from, to, arc };
    cam.tcx = to.cx; cam.tcy = to.cy; cam.tk = to.k;
  }
  function cancelFlight() {
    if (!flight) return;
    flight = null;
    cam.tcx = cam.cx; cam.tcy = cam.cy; cam.tk = cam.k;
  }

  function setUIRegion(rn) {
    curR = rn;
    $('regionTitle').textContent = rn.data.flag + ' ' + rn.data.name + 'の課題マップ';
    buildLegend(rn);
  }

  // ===== 隣国チップ (画面外の地域への方向ガイド) =====
  for (const rn of regions) {
    const b = document.createElement('button');
    b.className = 'nchip';
    b.setAttribute('data-region', rn.data.id);
    chips.appendChild(b);
    rn.chipEl = b;
  }
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.nchip');
    if (b) flyTo(b.getAttribute('data-region'));
  });
  function updateChips(t) {
    const show = mode === 'web' && t > 0.95;
    chips.hidden = !show;
    if (!show) return;
    const placed = [];
    for (const rn of regions) {
      const [ax, ay] = netToScreen(rn.anchor.x, rn.anchor.y);
      const off = ax < -rn.R * cam.k * 0.3 || ax > vw + rn.R * cam.k * 0.3 || ay < -rn.R * cam.k * 0.3 || ay > vh + rn.R * cam.k * 0.3;
      const visible = off && rn !== curR;
      rn.chipEl.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const dx = ax - vw / 2, dy = ay - vh / 2;
      const arrow = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? '←' : '→') : (dy < 0 ? '↑' : '↓');
      const label = arrow + ' ' + rn.data.flag + ' ' + rn.data.name;
      if (rn.chipEl.textContent !== label) rn.chipEl.textContent = label;
      const cx2 = clamp(ax, 74, vw - 74);
      let cy2 = clamp(ay, 92, vh - 60);
      if (cx2 < 300 && cy2 > vh - 170) cy2 = vh - 170; // 左下の凡例を避ける
      for (const p of placed) { // チップ同士の重なりは縦にずらす
        if (Math.abs(cx2 - p.x) < 150 && Math.abs(cy2 - p.y) < 40) cy2 = p.y + 44;
      }
      placed.push({ x: cx2, y: cy2 });
      rn.chipEl.style.left = cx2 + 'px';
      rn.chipEl.style.top = cy2 + 'px';
    }
  }

  // ===== フレームループ =====
  // 静止時(遷移/フライト/ドラッグ/物理/カメラ移動が全て無い)は描画を1フレームだけ仕上げて眠る。
  // 差分書き込み: 前回書いた値と同じDOM属性はスキップ。画面外のノード/エッジも書き込みスキップ。
  let lastNow = null;
  let needFinal = true;
  const LABEL_UP = new Set(['kp']);
  let nodeLayerFS = '', mapCache = { t: '', o: '' }, wlCache = '';
  const wr = (el, cache, key, attr, val) => { if (cache[key] !== val) { cache[key] = val; el.setAttribute(attr, val); } };
  const MARG = 240;

  function frame(now) {
    const dt = lastNow == null ? 16 : Math.min(48, now - lastNow);
    lastNow = now;

    const simActive = mode === 'web' && regions.some(rn => rn.sim.alpha > 0.004);
    const camActive = Math.abs(cam.cx - cam.tcx) * cam.k > 0.05
      || Math.abs(cam.cy - cam.tcy) * cam.k > 0.05
      || Math.abs(cam.k / cam.tk - 1) > 0.0008;
    const active = trans !== transT || !!flight || !!dragState || !!pinch || simActive || camActive;
    if (!active && !needFinal) { requestAnimationFrame(frame); return; }

    if (trans !== transT) {
      const step = dt / 620;
      trans = transT > trans ? Math.min(transT, trans + step) : Math.max(transT, trans - step);
      app.classList.add('moving');
      if (trans === transT) app.classList.remove('moving');
    }
    const t = easeIO(trans);

    if (mode === 'web') for (const rn of regions) if (rn.sim.alpha > 0.004) rn.sim.tick();

    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.dur);
      const u = easeIO(flight.t);
      cam.cx = lerp(flight.from.cx, flight.to.cx, u);
      cam.cy = lerp(flight.from.cy, flight.to.cy, u);
      cam.k = Math.exp(lerp(Math.log(flight.from.k), Math.log(flight.to.k), u) - flight.arc * Math.sin(Math.PI * u));
      if (flight.t >= 1) flight = null;
    } else {
      cam.cx = lerp(cam.cx, cam.tcx, 0.13);
      cam.cy = lerp(cam.cy, cam.tcy, 0.13);
      cam.k = lerp(cam.k, cam.tk, 0.13);
    }

    // カメラ最寄りの地域を追跡 (パンで隣国へ入るとUIが切替わる)
    if (mode === 'web') {
      let best = curR, bd = Infinity;
      for (const rn of regions) {
        const d = Math.hypot(cam.cx - rn.anchor.x, cam.cy - rn.anchor.y) - rn.R * 0.25;
        if (d < bd) { bd = d; best = rn; }
      }
      if (best !== curR) setUIRegion(best);
    }

    const mc = mapCamAt(t);
    wr(mapLayer, mapCache, 't', 'transform',
      'translate(' + (vw / 2 - mc.cx * mc.k).toFixed(2) + ' ' + (vh / 2 - mc.cy * mc.k).toFixed(2) + ') scale(' + mc.k.toFixed(4) + ')');
    const mo = (1 - t * 0.55).toFixed(3);
    if (mapCache.o !== mo) { mapCache.o = mo; mapLayer.style.opacity = mo; }

    // 国ラベル (worldビューのみ・完全に消えたら座標更新もスキップ)
    const wlo = Math.max(0, 1 - t * 2.2).toFixed(3);
    if (wlCache !== wlo) { wlCache = wlo; worldLabels.style.opacity = wlo; }
    if (+wlo > 0) {
      for (const rn of regions) {
        // 巨大国はラベルを国内に収め、密集地(北朝鮮)は上側に出して重なりを避ける
        const dy = LABEL_UP.has(rn.data.id)
          ? -(Math.min(rn.map.bbox.h * 0.72, 14) + 6)
          : Math.min(rn.map.bbox.h * 0.72, 14) + 4;
        const [lx, ly] = mapToScreen(mc, rn.map.center.x, rn.map.center.y + dy);
        rn.labelEl.setAttribute('x', lx.toFixed(1));
        rn.labelEl.setAttribute('y', ly.toFixed(1));
      }
    }

    // ノード位置: world=各国上空クラスタ / web=連続ネットワーク空間 を補間
    const fsv = (13 * clamp(cam.k, 0.8, 1)).toFixed(1) + 'px';
    if (nodeLayerFS !== fsv) { nodeLayerFS = fsv; nodeLayer.style.fontSize = fsv; }
    for (const rn of regions) {
      for (const nd of rn.graph.nodes) {
        renderNodeDom(nd, rn.cluster.get(nd.id), rn.anchor.x + nd.x, rn.anchor.y + nd.y, t, mc);
      }
      for (const e of rn.graph.edges) renderEdgeDom(e);
    }
    for (const nd of sharedNodes) {
      renderNodeDom(nd, sharedCluster.get(nd.id), nd.x, nd.y, t, mc);
    }
    for (const e of intlEdges) renderEdgeDom(e);

    app.classList.toggle('zoomed', cam.k > 1.02);
    declutterTick = (declutterTick + 1) % 5;
    if ((declutterTick === 0 || !active) && t > 0.4) declutterLabels();
    updateChips(t);
    if (ttNode && !tooltip.hidden) positionTooltip();

    needFinal = active; // 動きが止まった直後に1フレームだけ最終描画してから眠る
    requestAnimationFrame(frame);
  }

  // ===== 描画ヘルパー (差分書き込み+画面外カリング) =====
  function renderNodeDom(nd, cp, netX, netY, t, mc) {
    const [wx, wy] = mapToScreen(mc, cp.x, cp.y);
    let x = wx, y = wy, s;
    const worldR = nd.type === 'sub' ? 1.1 : (2.6 + nd.score / 100 * 4.6);
    if (t > 0) {
      const [gx, gy] = netToScreen(netX, netY);
      x = lerp(wx, gx, t); y = lerp(wy, gy, t);
      s = lerp(worldR / nd.r, cam.k, t);
    } else {
      s = worldR / nd.r;
    }
    nd.sx = x; nd.sy = y;
    const vis = x > -MARG && x < vw + MARG && y > -MARG && y < vh + MARG;
    if (!vis && nd._vis === false) return; // 画面外→画面外はDOM書き込み不要
    if (nd._vis !== vis) nd.el.style.display = vis ? '' : 'none';
    nd._vis = vis;
    const c = nd._c || (nd._c = {});
    wr(nd.el, c, 't', 'transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')');
    wr(nd.gfxEl, c, 'g', 'transform', 'scale(' + s.toFixed(3) + ')');
    const edge = nd.r * s;
    wr(nd.lbEl, c, 'ly', 'y', (edge + (nd.type === 'sub' ? 12 : 17)).toFixed(1));
    if (nd.scEl) wr(nd.scEl, c, 'sy', 'y', (edge + 31).toFixed(1));
  }
  function renderEdgeDom(e) {
    const bx0 = Math.min(e.a.sx, e.b.sx), bx1 = Math.max(e.a.sx, e.b.sx);
    const by0 = Math.min(e.a.sy, e.b.sy), by1 = Math.max(e.a.sy, e.b.sy);
    const vis = bx1 > -MARG && bx0 < vw + MARG && by1 > -MARG && by0 < vh + MARG;
    if (!vis && e._vis === false) return;
    if (e._vis !== vis) e.el.style.display = vis ? '' : 'none';
    e._vis = vis;
    const c = e._c || (e._c = {});
    wr(e.el, c, 'x1', 'x1', e.a.sx.toFixed(1));
    wr(e.el, c, 'y1', 'y1', e.a.sy.toFixed(1));
    wr(e.el, c, 'x2', 'x2', e.b.sx.toFixed(1));
    wr(e.el, c, 'y2', 'y2', e.b.sy.toFixed(1));
  }

  // ===== ラベル自動間引き (Googleマップ式: 優先度順に衝突しないものだけ表示) =====
  let declutterTick = 0;
  function declutterLabels() {
    const litSet = selected ? adj.get(selected.id) : null;
    const kept = [];
    const cand = [];
    const consider = (nd) => {
      if (nd.type === 'sub' && cam.k <= 1.02 && !(litSet && litSet.has(nd.id))) { nd.el.classList.remove('lcull'); return; }
      cand.push(nd);
    };
    for (const rn of regions) for (const nd of rn.graph.nodes) consider(nd);
    for (const nd of sharedNodes) consider(nd);
    cand.sort((a, b) => {
      const pa = (litSet && litSet.has(a.id) ? 1000 : 0) + (a.type === 'sub' ? a.sub.severity * 4 : a.score);
      const pb = (litSet && litSet.has(b.id) ? 1000 : 0) + (b.type === 'sub' ? b.sub.severity * 4 : b.score);
      return pb - pa;
    });
    for (const nd of cand) {
      const fs = 13 * clamp(cam.k, 0.8, 1) * (nd.type === 'sub' ? 0.78 : 1);
      const name = nd.type === 'sub' ? nd.sub.name : nd.issue.name;
      const w = name.length * fs + 12;
      const y0 = nd.sy + nd.r * cam.k + 4;
      const h = nd.type === 'sub' ? 16 : 36;
      const rect = { x0: nd.sx - w / 2, x1: nd.sx + w / 2, y0, y1: y0 + h };
      let hit = false;
      for (const r of kept) {
        if (rect.x0 < r.x1 && rect.x1 > r.x0 && rect.y0 < r.y1 && rect.y1 > r.y0) { hit = true; break; }
      }
      const force = litSet && litSet.has(nd.id);
      if (!hit || force) { kept.push(rect); nd.el.classList.remove('lcull'); }
      else nd.el.classList.add('lcull');
    }
  }

  // ===== ビュー遷移 =====
  function enterWeb(regionId) {
    const rn = regions.find(r => r.data.id === regionId) || regions[0];
    const fromWorld = mode === 'world';
    mode = 'web';
    transT = 1;
    app.classList.remove('world');
    topbar.hidden = false;
    legend.hidden = false;
    setUIRegion(rn);
    rn.sim.reheat(0.12);
    const f = regionFit(rn);
    cam.tcx = f.cx; cam.tcy = f.cy; cam.tk = f.k;
    if (fromWorld) { cam.cx = f.cx; cam.cy = f.cy; cam.k = f.k; } // 世界からはその国の真上で展開
  }
  function flyTo(regionId) {
    if (mode !== 'web') { enterWeb(regionId); return; }
    const rn = regions.find(r => r.data.id === regionId);
    if (!rn) return;
    clearSelection();
    setUIRegion(rn);
    rn.sim.reheat(0.1);
    startFlight(regionFit(rn)); // 連続空間をスライド飛行
  }
  function exitWeb() {
    if (mode === 'world') return;
    cancelFlight();
    clearSelection();
    closeModal();
    mode = 'world';
    transT = 0;
    app.classList.add('world');
    topbar.hidden = true;
    legend.hidden = true;
    chips.hidden = true;
    hideTooltip();
  }

  // ===== 選択 =====
  function setLit() {
    const litSet = selected ? adj.get(selected.id) : null;
    for (const [, nd] of byId) {
      nd.el.classList.toggle('lit', !!litSet && litSet.has(nd.id));
      nd.el.classList.toggle('selected', !!selected && nd.id === selected.id);
    }
    for (const rn of regions) for (const e of rn.graph.edges) {
      e.el.classList.toggle('edge-lit', !!selected && (e.a.id === selected.id || e.b.id === selected.id));
    }
  }
  function selectNode(id) {
    const nd = byId.get(id);
    if (!nd) return;
    const homeRegion = nd.regionRef || (nd.invRegions && nd.invRegions[0]) || curR;
    if (mode !== 'web') enterWeb(homeRegion.data.id);
    else if (nd.regionRef && nd.regionRef !== curR) setUIRegion(nd.regionRef);
    selected = nd;
    app.classList.add('focus');
    setLit();
    cancelFlight();
    const gx = nd.regionRef ? nd.regionRef.anchor.x + nd.x : nd.x;
    const gy = nd.regionRef ? nd.regionRef.anchor.y + nd.y : nd.y;
    if (isNarrow()) {
      cam.tcx = gx;
      cam.tcy = gy + (vh * 0.16) / cam.tk;
    } else {
      cam.tcx = gx + 190 / cam.tk;
      cam.tcy = gy;
    }
    renderPanel(nd);
    panel.hidden = false;
    panel.scrollTop = 0;
    hideTooltip();
    needFinal = true;
  }
  function clearSelection() {
    selected = null;
    app.classList.remove('focus');
    setLit();
    panel.hidden = true;
    needFinal = true; // ラベル間引きの再計算のため1フレーム起こす
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
    else if (nd.type === 'shared') renderSharedPanel(nd);
    else renderSubPanel(nd);
  }

  function renderSharedPanel(nd) {
    const I = nd.issue, b = nd.breakdown, si = I.score_inputs;
    panel.innerHTML =
      '<button class="pclose" data-act="close" aria-label="閉じる">✕</button>'
      + '<div class="phead"><div class="pemoji">' + esc(I.emoji) + '</div><div>'
      + '<h2>' + esc(I.name) + '</h2><div class="ptagline">' + esc(I.tagline) + '</div>'
      + catChip(nd.catIndex) + '<span class="catchip intlchip">🌐 国際共通課題</span>'
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
      + I.involved.map(v => {
        const rn = regions.find(r => r.data.id === v.region);
        if (!rn) return '';
        const rel = (v.related_issue_ids || []).map(rid => byId.get(rid)).filter(Boolean);
        return '<h3><span class="cflag">' + esc(rn.data.flag) + '</span>' + esc(rn.data.name) + 'への影響</h3>'
          + '<p class="body">' + esc(v.note) + '</p>'
          + (rel.length ? '<div class="subgrid">' + rel.map(tn =>
            '<button class="subitem" data-goto="' + esc(tn.id) + '"><i style="background:' + tn.color + ';width:10px;height:10px"></i>'
            + '<span class="sname">' + esc(tn.issue.emoji) + ' ' + esc(tn.issue.name) + '</span><span class="sev">深刻度' + tn.score + '</span></button>').join('') + '</div>' : '');
      }).join('')
      + '<div class="pdisclaimer">公的統計・調査等の出典に基づく要約であり、特定の政治的立場を支持するものではありません。スコアは出典データからの機械的算出です。<br>データ時点: ' + esc(D.generated) + '</div>';
  }

  function renderMajorPanel(nd) {
    const I = nd.issue, b = nd.breakdown, si = I.score_inputs;
    const meta = nd.regionRef.data.meta || {};
    const conf = (meta.confidences || []).find(c => c.id === I.id);
    const linkedEdges = nd.regionRef.graph.edges.filter(e => e.kind === 'link' && (e.a.id === nd.id || e.b.id === nd.id));
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
      + I.sub_issues.map(s =>
        '<button class="subitem" data-goto="' + esc(s.id) + '"><i style="background:' + nd.color + ';width:' + (7 + s.severity * 1.6) + 'px;height:' + (7 + s.severity * 1.6) + 'px"></i>'
        + '<span class="sname">' + esc(s.name) + '</span><span class="sev">' + sevDots(s.severity) + '</span></button>'
      ).join('') + '</div>'
      + (linkedEdges.length ? '<h3>つながる課題</h3><div class="subgrid">'
        + linkedEdges.map(e => {
          const other = e.a.id === nd.id ? e.b : e.a;
          return '<button class="subitem relitem" data-goto="' + esc(other.id) + '"><span><span class="relbadge">' + esc(e.relation) + '</span>'
            + '<span class="sname">' + esc(other.issue.emoji) + ' ' + esc(other.issue.name) + '</span></span>'
            + '<span class="rel">' + esc(e.description) + '</span></button>';
        }).join('') + '</div>' : '')
      + (() => {
        const shared = intlEdges.filter(e => e.b.id === nd.id).map(e => e.a);
        return shared.length ? '<h3>🌐 関わる国際共通課題</h3><div class="subgrid">'
          + shared.map(sn => '<button class="subitem relitem" data-goto="' + esc(sn.id) + '"><span><span class="relbadge">国際</span>'
            + '<span class="sname">' + esc(sn.issue.emoji) + ' ' + esc(sn.issue.name) + '</span></span>'
            + '<span class="rel">' + esc(sn.issue.tagline) + '</span></button>').join('') + '</div>' : '';
      })()
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
    const parent = byId.get(nd.parentId);
    const S2 = nd.sub;
    const siblings = parent.issue.sub_issues.filter(s => s.id !== S2.id);
    panel.innerHTML =
      '<button class="pclose" data-act="close" aria-label="閉じる">✕</button>'
      + '<div class="pparent">└ <button data-goto="' + esc(parent.id) + '">' + esc(parent.issue.emoji) + ' ' + esc(parent.issue.name) + '</button> の構成課題</div>'
      + '<div class="phead"><div>'
      + '<h2>' + esc(S2.name) + '</h2>' + catChip(nd.catIndex)
      + '</div></div>'
      + '<div class="scorebox"><div class="shead"><span class="snum" style="color:' + nd.color + ';font-size:22px">' + sevDots(S2.severity) + '</span><span class="slabel">深刻度 ' + esc(S2.severity) + ' / 5</span></div></div>'
      + '<h3>概要</h3><p class="body">' + esc(S2.description) + '</p>'
      + '<h3>キーデータ</h3>' + statRow(S2.key_stat)
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
    tooltip.innerHTML = nd.type !== 'sub'
      ? '<div class="tt-name">' + esc(nd.issue.emoji) + ' ' + esc(nd.issue.name) + '</div><div class="tt-sub">' + esc(nd.issue.tagline) + '</div><div class="tt-score">' + (nd.type === 'shared' ? '🌐国際 ・ ' : '') + '深刻度 ' + nd.score + ' / 100 ・ タップで詳細</div>'
      : '<div class="tt-name">' + esc(nd.sub.name) + '</div><div class="tt-score">深刻度 ' + sevDots(nd.sub.severity) + ' ・ タップで詳細</div>';
    tooltip.hidden = false;
    positionTooltip();
  }
  function hideTooltip() { tooltip.hidden = true; ttNode = null; }

  svg.addEventListener('mousemove', (e) => {
    if (mode !== 'web' || dragState) return;
    ttX = e.clientX; ttY = e.clientY;
    const g = e.target.closest && e.target.closest('.node');
    if (g) {
      const nd = byId.get(g.getAttribute('data-id'));
      if (nd !== ttNode) showTooltip(nd);
      else positionTooltip();
    } else hideTooltip();
  });
  svg.addEventListener('mouseleave', hideTooltip);

  // ===== クリック =====
  function nearestRegionByScreen(sx, sy) {
    const mc = mapCamAt(easeIO(trans));
    let best = regions[0], bd = Infinity;
    for (const rn of regions) {
      const [x, y] = mapToScreen(mc, rn.map.center.x, rn.map.center.y);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) { bd = d; best = rn; }
    }
    return best;
  }
  svg.addEventListener('click', (e) => {
    if (performance.now() < suppressClickUntil) return;
    if (mode === 'world') { enterWeb(nearestRegionByScreen(e.clientX, e.clientY).data.id); return; }
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
    cancelFlight();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p2.x - p1.x, p2.y - p1.y), k: cam.tk };
      dragState = null;
      return;
    }
    const g = e.target.closest && e.target.closest('.node');
    if (g) {
      dragState = { type: 'node', nd: byId.get(g.getAttribute('data-id')), moved: false, sx: e.clientX, sy: e.clientY };
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
      cam.tk = clamp(pinch.k * d / pinch.d, 0.22, 3);
      return;
    }
    if (!dragState) return;
    const dx = e.clientX - dragState.sx, dy = e.clientY - dragState.sy;
    if (!dragState.moved && Math.hypot(dx, dy) > 5) dragState.moved = true;
    if (!dragState.moved) return;
    hideTooltip();
    if (dragState.type === 'node') {
      const [nx, ny] = screenToNet(e.clientX, e.clientY);
      if (dragState.nd.regionRef) {
        dragState.nd.fx = nx - dragState.nd.regionRef.anchor.x;
        dragState.nd.fy = ny - dragState.nd.regionRef.anchor.y;
        dragState.nd.regionRef.sim.reheat(0.35);
      } else {
        dragState.nd.x = nx; // 国際共通課題は物理なしで直接移動
        dragState.nd.y = ny;
        needFinal = true;
      }
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
    const ds = dragState;
    dragState = null;
    if (ds.type === 'node' && ds.nd.regionRef) {
      ds.nd.fx = null;
      ds.nd.fy = null;
      ds.nd.regionRef.sim.reheat(0.18);
    }
    if (e.type !== 'pointerup') return;
    // pointer capture中はclickイベントのtargetがSVG全体に再ターゲットされる環境があるため、
    // タップ(=移動なしのpointerup)はここで自前判定し、後続のclickは時限抑止する
    suppressClickUntil = performance.now() + 350;
    if (!ds.moved) {
      if (ds.type === 'node') selectNode(ds.nd.id);
      else if (trans === 1) clearSelection();
    }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', (e) => {
    if (mode !== 'web') return;
    e.preventDefault();
    cancelFlight();
    const k2 = clamp(cam.tk * Math.exp(-e.deltaY * 0.0016), 0.22, 3);
    const [nx, ny] = screenToNet(e.clientX, e.clientY);
    cam.tcx = nx - (e.clientX - vw / 2) / k2;
    cam.tcy = ny - (e.clientY - vh / 2) / k2;
    cam.tk = k2;
  }, { passive: false });

  // ===== 凡例 =====
  function buildLegend(rn) {
    const present = [...new Set(rn.graph.nodes.filter(n => n.type === 'major').map(n => n.catIndex))].sort((a, b) => a - b);
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
    + '<p>スコアは各課題の出典データから<strong>機械的に</strong>算出しており、編集上の主観による順位付けではありません。国をまたいで同一基準(絶対量)で算出しているため、国どうしの比較もできます。</p>'
    + '<p><code>スコア = 40% × 影響人数 + 35% × 経済インパクト + 25% × 緊急度</code></p>'
    + '<p>・<strong>影響人数</strong>: 直接・間接に影響を受ける人数（対数スケール、1.2億人で飽和）<br>'
    + '・<strong>経済インパクト</strong>: 年間の経済損失・財政負担等の兆円換算（対数スケール、年100兆円で飽和）<br>'
    + '・<strong>緊急度</strong>: 今後5年での不可逆性を1〜5で評価（出典の将来推計に基づく）</p>'
    + '<p>対数スケールを使うのは、影響人数や金額が桁で異なる課題を同じ地図に載せるためです。各数値の根拠と出典は、課題をタップすると出る詳細パネルに記載しています。</p>'
    + '<p>掲載課題の選定は、各国の政府世論調査・省庁白書・国際機関の評価・主要シンクタンクの提言を横断して複数出典で挙がったものを採用しています。データ時点: ' + esc(D.generated) + '</p>'
  ));

  $('tableBtn').addEventListener('click', () => {
    const rn = curR;
    const majors = rn.graph.nodes.filter(n => n.type === 'major').sort((a, b) => b.score - a.score);
    openModal(
      '<h2>' + esc(rn.data.flag + ' ' + rn.data.name) + 'の課題一覧（スコア順）</h2>'
      + '<table><thead><tr><th>課題</th><th>スコア</th><th>影響人数</th><th>経済/年</th><th>緊急度</th></tr></thead><tbody>'
      + majors.map(nd => '<tr class="trow" data-goto="' + esc(nd.id) + '">'
        + '<td><span class="tdot" style="background:' + nd.color + '"></span>' + esc(nd.issue.emoji) + ' ' + esc(nd.issue.name) + '</td>'
        + '<td class="num"><strong>' + nd.score + '</strong></td>'
        + '<td class="num">' + fmtMan(nd.issue.score_inputs.affected_population_man) + '</td>'
        + '<td class="num">' + esc(nd.issue.score_inputs.econ_impact_trillion_yen) + '兆円</td>'
        + '<td class="num">' + esc(nd.issue.score_inputs.urgency) + '/5</td>'
        + '</tr>').join('')
      + '</tbody></table>'
      + (sharedNodes.length ? '<h2 class="mh2">🌐 国際共通課題</h2>'
        + '<table><thead><tr><th>課題</th><th>スコア</th><th>関与</th></tr></thead><tbody>'
        + sharedNodes.slice().sort((a, b) => b.score - a.score).map(sn => '<tr class="trow" data-goto="' + esc(sn.id) + '">'
          + '<td><span class="tdot" style="background:' + sn.color + '"></span>' + esc(sn.issue.emoji) + ' ' + esc(sn.issue.name) + '</td>'
          + '<td class="num"><strong>' + sn.score + '</strong></td>'
          + '<td>' + sn.invRegions.map(r => esc(r.data.flag)).join(' ') + '</td>'
          + '</tr>').join('')
        + '</tbody></table>' : '')
    );
  });

  $('backBtn').addEventListener('click', exitWeb);
  $('introBtns').innerHTML = D.regions.map(rd =>
    '<button class="enterBtn" data-region="' + esc(rd.id) + '">' + esc(rd.flag) + ' ' + esc(rd.name) + 'の課題マップ</button>').join('');
  $('introBtns').addEventListener('click', (e) => {
    const b = e.target.closest('.enterBtn');
    if (b) enterWeb(b.getAttribute('data-region'));
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalWrap.hidden) closeModal();
    else if (selected) clearSelection();
    else if (mode === 'web') exitWeb();
  });

  window.addEventListener('resize', () => {
    vw = window.innerWidth; vh = window.innerHeight;
    needFinal = true;
    if (mode === 'web' && !selected) {
      const f = regionFit(curR);
      cam.tcx = f.cx; cam.tcy = f.cy; cam.tk = f.k;
    }
  });

  $('dataDate').textContent = 'データ時点 ' + D.generated + ' ・ 出典付き' + (D.placeholder ? ' ・ ⚠プレースホルダー' : '');

  // ===== 起動 =====
  requestAnimationFrame(frame);

  // e2e用フック
  window.__APP__ = {
    regions, byId, sharedNodes, intlEdges, selectNode, clearSelection, enterWeb, exitWeb, flyTo,
    state: () => ({ mode, trans, region: curR.data.id, selected: selected && selected.id }),
  };
})();
