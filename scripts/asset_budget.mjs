import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const roots = ['models', 'textures', 'env', 'vfx'];

const DEFAULT_BUDGETS_MIB = {
  total: 95,
  largestFile: 8,
  groups: {
    'textures': 36,
    'env': 34,
    'models/chars': 18,
    'models/creatures': 4,
    'models/props': 4,
    'models/foliage': 4,
    'models/dungeon': 2,
    'models/weapons': 1,
    'vfx': 1,
  },
};

function readNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  return value;
}

function groupEnvName(group) {
  return `ASSET_BUDGET_${group.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_MIB`;
}

function budgets() {
  const groups = {};
  for (const [group, fallback] of Object.entries(DEFAULT_BUDGETS_MIB.groups)) {
    groups[group] = readNumberEnv(groupEnvName(group), fallback);
  }
  return {
    total: readNumberEnv('ASSET_BUDGET_TOTAL_MIB', DEFAULT_BUDGETS_MIB.total),
    largestFile: readNumberEnv('ASSET_BUDGET_LARGEST_FILE_MIB', DEFAULT_BUDGETS_MIB.largestFile),
    groups,
  };
}

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function mediaFiles() {
  const files = [];
  for (const rootName of roots) {
    const dir = path.join(publicDir, rootName);
    if (existsSync(dir)) files.push(...walk(dir));
  }
  return files.sort();
}

function classify(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'models') return `${parts[0]}/${parts[1] ?? 'misc'}`;
  return parts[0] ?? 'misc';
}

function mib(bytes) {
  return bytes / 1024 / 1024;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatMib(bytes) {
  return `${round(mib(bytes)).toFixed(3)} MiB`;
}

function buildReport() {
  const files = mediaFiles().map((file) => {
    const rel = path.relative(publicDir, file).split(path.sep).join('/');
    const bytes = statSync(file).size;
    return {
      path: rel,
      group: classify(rel),
      ext: path.extname(rel).slice(1).toLowerCase(),
      bytes,
      mib: round(mib(bytes)),
    };
  });
  const groups = new Map();
  for (const file of files) {
    const g = groups.get(file.group) ?? { group: file.group, count: 0, bytes: 0, mib: 0 };
    g.count++;
    g.bytes += file.bytes;
    g.mib = round(mib(g.bytes));
    groups.set(file.group, g);
  }
  const byExt = new Map();
  for (const file of files) {
    const e = byExt.get(file.ext) ?? { ext: file.ext, count: 0, bytes: 0, mib: 0 };
    e.count++;
    e.bytes += file.bytes;
    e.mib = round(mib(e.bytes));
    byExt.set(file.ext, e);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  const budget = budgets();
  const failures = [];
  if (mib(totalBytes) > budget.total) failures.push(`total ${formatMib(totalBytes)} > ${budget.total} MiB`);
  const largestFile = largest[0];
  if (largestFile && largestFile.mib > budget.largestFile) {
    failures.push(`largest file ${largestFile.path} ${largestFile.mib} MiB > ${budget.largestFile} MiB`);
  }
  for (const [group, maxMib] of Object.entries(budget.groups)) {
    const actual = groups.get(group)?.mib ?? 0;
    if (actual > maxMib) failures.push(`${group} ${actual} MiB > ${maxMib} MiB`);
  }
  return {
    generatedAt: new Date().toISOString(),
    roots,
    fileCount: files.length,
    totalBytes,
    totalMib: round(mib(totalBytes)),
    budgetsMib: budget,
    groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
    byExt: [...byExt.values()].sort((a, b) => b.bytes - a.bytes),
    largest,
    failures,
  };
}

function printText(report) {
  console.log(`assets: ${report.fileCount} files, ${report.totalMib.toFixed(3)} MiB total`);
  console.log('');
  console.log('By group:');
  for (const g of report.groups) {
    const budget = report.budgetsMib.groups[g.group];
    const suffix = budget === undefined ? '' : ` / ${budget} MiB`;
    console.log(`  ${g.group.padEnd(18)} ${String(g.count).padStart(4)}  ${g.mib.toFixed(3).padStart(9)} MiB${suffix}`);
  }
  console.log('');
  console.log('Largest files:');
  for (const f of report.largest.slice(0, 10)) {
    console.log(`  ${f.mib.toFixed(3).padStart(8)} MiB  ${f.path}`);
  }
  if (report.failures.length > 0) {
    console.error('');
    console.error('Asset budget failures:');
    for (const failure of report.failures) console.error(`  - ${failure}`);
  }
}

const args = new Set(process.argv.slice(2));
const report = buildReport();
if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printText(report);
}
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
if (outArg) writeFileSync(outArg.slice('--out='.length), `${JSON.stringify(report, null, 2)}\n`);
if (report.failures.length > 0) process.exitCode = 1;
