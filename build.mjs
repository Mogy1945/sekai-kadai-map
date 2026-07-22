// src/* → index.html (単一ファイル・オフライン動作)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(ROOT, 'src', f), 'utf8');

let html = read('template.html');
const inject = (marker, content) => {
  const tag = '/*__' + marker + '__*/';
  if (!html.includes(tag)) throw new Error('marker not found: ' + marker);
  html = html.replace(tag, () => content);
};

inject('STYLE', read('style.css'));
inject('MAPDATA', read('mapdata.js'));
inject('DATA', read('data.js'));
inject('GRAPH', read('graph.js'));
inject('APP', read('app.js'));

writeFileSync(join(ROOT, 'index.html'), html);
console.log('index.html: ' + (html.length / 1024).toFixed(0) + 'KB');
