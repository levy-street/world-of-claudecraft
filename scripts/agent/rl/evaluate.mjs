// Score policies into a report the LLM agent reads to iterate. Combines:
//   - RL run metrics from rl/runs/*.json (offline training)
//   - live progress from the bot journals (logs/*.md `📊 PROGRESS kills=… levels=…`)
// Emits rl/report.json: a compact, comparable scoreboard so the agent's reward /
// intent edits have a measurable objective (otherwise the meta-loop is vibes).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');

function rlRuns() {
  const dir = join(HERE, 'runs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

function liveProgress() {
  const dir = join(REPO, 'logs');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const txt = readFileSync(join(dir, f), 'utf8');
    const beats = [...txt.matchAll(/📊 PROGRESS kills=(\d+) levels=(\d+)[^\n]*/g)];
    const last = beats.at(-1);
    if (last) out.push({ file: f, kills: +last[1], levels: +last[2] });
    const deaths = (txt.match(/☠️/g) ?? []).length;
    if (last) out.at(-1).deaths = deaths;
  }
  return out;
}

const report = {
  at: Date.now(),
  rl: rlRuns().map((r) => ({ runId: r.runId, exit: r.exit })),
  live: liveProgress(),
  // a single safety-weighted score per live source: throughput minus death tax
  scores: liveProgress().map((p) => ({ file: p.file, score: (p.kills ?? 0) + 3 * (p.levels ?? 0) - 8 * (p.deaths ?? 0) })),
};
writeFileSync(join(HERE, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
