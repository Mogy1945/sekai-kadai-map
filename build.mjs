// src/* → index.html (単一ファイル・オフライン動作)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(ROOT, 'src', f), 'utf8');

// レイアウト事前計算: シムは決定的なので、実行時のsettle(340)と完全に同じ結果をベイクできる
// (位置+速度+alphaを保存するため、実行時の続きの挙動も従来と同一)
const require2 = createRequire(import.meta.url);
const { GraphCore } = require2(join(ROOT, 'src', 'graph.js'));
const { ISSUE_DATA } = require2(join(ROOT, 'src', 'data.js'));
const layout = {};
for (const rd of ISSUE_DATA.regions) {
  const g = GraphCore.buildGraph(rd);
  const sim = GraphCore.createSim(g);
  sim.settle(340);
  const nodes = {};
  for (const nd of g.nodes) nodes[nd.id] = [nd.x, nd.y, nd.vx, nd.vy];
  layout[rd.id] = { alpha: sim.alpha, nodes };
}

let html = read('template.html');
const inject = (marker, content) => {
  const tag = '/*__' + marker + '__*/';
  if (!html.includes(tag)) throw new Error('marker not found: ' + marker);
  html = html.replace(tag, () => content);
};

inject('STYLE', read('style.css'));
inject('MAPDATA', read('mapdata.js'));
inject('DATA', read('data.js'));
inject('LAYOUT', 'var PRECOMPUTED_LAYOUT = ' + JSON.stringify(layout) + ';');
inject('GRAPH', read('graph.js'));
inject('APP', read('app.js'));

writeFileSync(join(ROOT, 'index.html'), html);
console.log('index.html: ' + (html.length / 1024).toFixed(0) + 'KB');
