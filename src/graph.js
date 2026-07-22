// 課題グラフ: 複合スコア計算・ノード/エッジ構築・力学シミュレーション (UI非依存・node直require可)
'use strict';

const GraphCore = (() => {
  const CATEGORIES = ['人口・社会', '経済・財政', '労働・雇用', '政治・制度', '安全保障・災害', '環境・エネルギー', '健康・教育'];
  // dataviz検証済みライトパレット (surface #eef2f7, 全項目PASS)
  const CAT_COLORS = ['#2a78d6', '#eda100', '#1baf7a', '#4a3aa7', '#e34948', '#008300', '#e87ba4'];

  const clamp01 = v => Math.max(0, Math.min(1, v));

  // 複合スコア: 影響人数(対数)40% + 経済インパクト(対数)35% + 緊急度25%
  // 対数スケール: 影響人数は1.2億人(全国民)、経済は年100兆円で飽和
  function computeScore(si) {
    const pop = clamp01(Math.log10(Math.max(1, si.affected_population_man)) / Math.log10(12000));
    const econ = clamp01(Math.log10(1 + Math.max(0, si.econ_impact_trillion_yen)) / Math.log10(101));
    const urg = clamp01((si.urgency - 1) / 4);
    const score = Math.round(100 * (0.40 * pop + 0.35 * econ + 0.25 * urg));
    return { score, pop, econ, urg };
  }

  // 面積が知覚量なので半径は√スコア比例
  const majorRadius = score => 26 + 34 * Math.sqrt(score / 100);
  const subRadius = sev => 9 + 2.2 * (Math.max(1, Math.min(5, sev)) - 1);

  // 決定的擬似乱数 (再現性のためMath.randomは使わない)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  function buildGraph(data) {
    const nodes = [], edges = [], byId = new Map();
    const issues = data.issues;
    const n = issues.length;

    issues.forEach((issue, i) => {
      const { score, pop, econ, urg } = computeScore(issue.score_inputs);
      const catIndex = Math.max(0, CATEGORIES.indexOf(issue.category));
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const node = {
        id: issue.id, type: 'major', issue, score,
        breakdown: { pop, econ, urg },
        catIndex, color: CAT_COLORS[catIndex],
        r: majorRadius(score),
        x: Math.cos(angle) * 380, y: Math.sin(angle) * 260,
        vx: 0, vy: 0, fx: null, fy: null,
      };
      nodes.push(node);
      byId.set(node.id, node);
    });

    issues.forEach((issue) => {
      const parent = byId.get(issue.id);
      const rnd = mulberry32(hashCode(issue.id));
      issue.sub_issues.forEach((sub, j) => {
        const a = (j / issue.sub_issues.length) * Math.PI * 2 + rnd() * 0.9;
        const dist = parent.r + 62 + rnd() * 26;
        const node = {
          id: sub.id, type: 'sub', sub, parentId: issue.id,
          catIndex: parent.catIndex, color: parent.color,
          r: subRadius(sub.severity),
          x: parent.x + Math.cos(a) * dist, y: parent.y + Math.sin(a) * dist,
          vx: 0, vy: 0, fx: null, fy: null,
        };
        nodes.push(node);
        byId.set(node.id, node);
        edges.push({ a: parent, b: node, kind: 'tree' });
      });
    });

    // 課題間リンク (双方向の重複を除去)
    const seen = new Set();
    issues.forEach((issue) => {
      (issue.links_to_other_issues || []).forEach((l) => {
        const t = byId.get(l.target_id);
        if (!t || l.target_id === issue.id) return;
        const key = [issue.id, l.target_id].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({
          a: byId.get(issue.id), b: t, kind: 'link',
          relation: l.relation, description: l.description,
        });
      });
    });

    return { nodes, edges, byId };
  }

  // 世界ビュー用: 対象国上空のクラスタ配置 (マップ座標系・決定的)
  function clusterPositions(nodes, cx, cy, spread, seed) {
    const rnd = mulberry32(seed || 20260722);
    const sp = spread || 21;
    const pos = new Map();
    nodes.filter(nd => nd.type === 'major').forEach((nd) => {
      const a = rnd() * Math.PI * 2;
      const d = sp * 0.15 + Math.sqrt(rnd()) * sp;
      pos.set(nd.id, { x: cx + Math.cos(a) * d * 1.3, y: cy - sp * 0.2 + Math.sin(a) * d * 0.8 });
    });
    nodes.forEach((nd) => {
      if (nd.type !== 'sub') return;
      const p = pos.get(nd.parentId);
      const a = rnd() * Math.PI * 2;
      const d = sp * (0.07 + rnd() * 0.12);
      pos.set(nd.id, { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d * 0.8 });
    });
    return pos;
  }

  function createSim(graph) {
    const { nodes, edges } = graph;
    let alpha = 1;

    function tick() {
      if (alpha < 0.003) return alpha;
      // 反発
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1e-4) { dx = 0.1; dy = 0.1; d2 = 0.02; }
          const bothMajor = a.type === 'major' && b.type === 'major';
          const q = bothMajor ? 7400
            : (a.type === 'sub' && b.type === 'sub')
              ? (a.parentId === b.parentId ? 340 : 220)
              : 900;
          const f = Math.min(alpha * q / d2, 6);
          const d = Math.sqrt(d2);
          const fx = f * dx / d, fy = f * dy / d;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      // ばね
      for (const e of edges) {
        const rest = e.kind === 'tree' ? e.a.r + e.b.r + 44 : e.a.r + e.b.r + 200;
        const k = e.kind === 'tree' ? 0.085 : 0.007;
        let dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = k * (d - rest) * alpha * 2;
        const fx = f * dx / d, fy = f * dy / d;
        e.a.vx += fx; e.a.vy += fy;
        e.b.vx -= fx; e.b.vy -= fy;
      }
      // 中心重力
      for (const nd of nodes) {
        const g = nd.type === 'major' ? 0.02 : 0.005;
        nd.vx -= nd.x * g * alpha;
        nd.vy -= nd.y * g * alpha;
      }
      // 速度適用
      for (const nd of nodes) {
        if (nd.fx != null) { nd.x = nd.fx; nd.y = nd.fy; nd.vx = 0; nd.vy = 0; continue; }
        nd.vx *= 0.82; nd.vy *= 0.82;
        const sp = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
        if (sp > 14) { nd.vx *= 14 / sp; nd.vy *= 14 / sp; }
        nd.x += nd.vx;
        nd.y += nd.vy;
      }
      // 衝突解決 (重い方=半径大が動きにくい)
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const pad = (a.type === 'major' && b.type === 'major') ? 54 : 8;
          const min = a.r + b.r + pad;
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d < 1e-3) { dx = 0.5; dy = 0.5; d = 0.7; }
          if (d >= min) continue;
          const ma = a.r * a.r, mb = b.r * b.r;
          const shareA = a.fx != null ? 0 : mb / (ma + mb);
          const shareB = b.fx != null ? 0 : ma / (ma + mb);
          const push = (min - d) * 0.55;
          a.x -= dx / d * push * shareA;
          a.y -= dy / d * push * shareA;
          b.x += dx / d * push * shareB;
          b.y += dy / d * push * shareB;
        }
      }
      alpha *= 0.994;
      return alpha;
    }

    return {
      tick,
      get alpha() { return alpha; },
      reheat(v) { alpha = Math.max(alpha, v); },
      setAlpha(v) { alpha = v; },
      settle(nTicks) { for (let i = 0; i < nTicks; i++) tick(); },
    };
  }

  return { CATEGORIES, CAT_COLORS, computeScore, majorRadius, subRadius, buildGraph, clusterPositions, createSim, mulberry32, hashCode };
})();

if (typeof module !== 'undefined') module.exports = { GraphCore };
