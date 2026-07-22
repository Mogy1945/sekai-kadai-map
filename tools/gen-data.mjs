// 調査ワークフローのjournal.jsonlから検証済みデータを抽出し src/data.js を生成する
// usage: node tools/gen-data.mjs jp=<journal.jsonl> kr=<journal.jsonl> [--date YYYY-MM-DD]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGION_INFO = {
  jp: { name: '日本', flag: '🇯🇵' },
  kr: { name: '韓国', flag: '🇰🇷' },
};

const args = process.argv.slice(2);
let genDate = null;
const journals = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--date') { genDate = args[++i]; continue; }
  const m = args[i].match(/^([a-z]+)=(.+)$/);
  if (!m || !REGION_INFO[m[1]]) { console.error('不明な引数:', args[i]); process.exit(1); }
  journals[m[1]] = m[2];
}
if (Object.keys(journals).length === 0) {
  console.error('usage: node tools/gen-data.mjs jp=<journal.jsonl> kr=<journal.jsonl> [--date YYYY-MM-DD]');
  process.exit(1);
}

function parseJournal(path) {
  const issues = new Map();   // id → {issue, changes, confidence} (後勝ち=補完ラウンド優先)
  let critic = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'result' || !j.result) continue;
    const r = j.result;
    if (r.corrected_issue && r.corrected_issue.id) {
      issues.set(r.corrected_issue.id, { issue: r.corrected_issue, changes: r.changes || [], confidence: r.confidence || 'medium' });
    } else if (Array.isArray(r.missing_issues)) {
      critic = r;
    }
  }
  return { issues: [...issues.values()], critic };
}

// 地域プレフィクスでIDを名前空間化 (地域間衝突の防止)
function namespaceIds(rid, all) {
  const px = rid + '-';
  const ns = id => id.startsWith(px) ? id : px + id;
  for (const r of all) {
    const I = r.issue;
    I.id = ns(I.id);
    for (const s of I.sub_issues) s.id = ns(s.id);
    for (const l of I.links_to_other_issues || []) l.target_id = ns(l.target_id);
  }
}

const regionsOut = [];
const allIds = new Set();
const summary = [];

for (const [rid, path] of Object.entries(journals)) {
  const { issues: all, critic } = parseJournal(path);
  if (all.length === 0) { console.error(`${rid}: 検証済みissueがjournalに見つからない`); process.exit(1); }
  namespaceIds(rid, all);

  const validIds = new Set(all.map(r => r.issue.id));
  let droppedLinks = 0;
  for (const r of all) {
    const before = (r.issue.links_to_other_issues || []).length;
    r.issue.links_to_other_issues = (r.issue.links_to_other_issues || [])
      .filter(l => validIds.has(l.target_id) && l.target_id !== r.issue.id);
    droppedLinks += before - r.issue.links_to_other_issues.length;
  }

  // サブ課題ID・地域間IDの一意性を保証
  for (const r of all) {
    for (const s of r.issue.sub_issues) {
      while (allIds.has(s.id) || validIds.has(s.id)) s.id += '-x';
      allIds.add(s.id);
    }
    if (allIds.has(r.issue.id)) { console.error('大課題ID衝突:', r.issue.id); process.exit(1); }
    allIds.add(r.issue.id);
  }

  regionsOut.push({
    id: rid,
    name: REGION_INFO[rid].name,
    flag: REGION_INFO[rid].flag,
    issues: all.map(r => r.issue),
    meta: {
      confidences: all.map(r => ({ id: r.issue.id, confidence: r.confidence, changes: r.changes.length })),
      critic_notes: critic ? critic.notes : '',
      method: '政府世論調査・省庁白書・国際機関・シンクタンクの複数出典を横断調査し、数値は独立エージェントが一次資料と突合検証済み',
    },
  });

  const nSubs = all.reduce((a, r) => a + r.issue.sub_issues.length, 0);
  const nLinks = all.reduce((a, r) => a + r.issue.links_to_other_issues.length, 0);
  const nChanges = all.reduce((a, r) => a + r.changes.length, 0);
  summary.push(`${rid}: 大課題${all.length} / サブ${nSubs} / リンク${nLinks}(無効${droppedLinks}除去) / 検証修正${nChanges}件 / low信頼=${all.filter(r => r.confidence === 'low').length}`);
}

// 地域の表示順を固定 (jp → kr)
regionsOut.sort((a, b) => Object.keys(REGION_INFO).indexOf(a.id) - Object.keys(REGION_INFO).indexOf(b.id));

const data = {
  generated: genDate || new Date().toISOString().slice(0, 10),
  regions: regionsOut,
};

const out = '// 実データ: 調査ワークフロー(3視点taxonomy→課題別調査→敵対的ファクトチェック)による生成\n'
  + '// 生成: ' + data.generated + ' / 全数値に出典付き・検証済み\n'
  + 'const ISSUE_DATA = ' + JSON.stringify(data, null, 1) + ';\n'
  + "if (typeof module !== 'undefined') module.exports = { ISSUE_DATA };\n";
writeFileSync(join(ROOT, 'src', 'data.js'), out);
console.log('data.js 生成:\n  ' + summary.join('\n  '));
