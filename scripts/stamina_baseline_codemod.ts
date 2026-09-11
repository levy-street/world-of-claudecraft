// One-time codemod for the stamina baseline model (src/sim/item_budget.ts): rewrite
// the `stats` literal of every content item that is under its free stamina floor
// or off its offense-and-resource line, so tests/item_stamina_baseline.test.ts goes
// green. Generated items (heroic variants, crucible collection pieces, rift bands)
// derive from the model and are never touched here.
//
// Rules, per item with a derivable line (expectedLineBudget):
//   - stamina rises to its baseline (never falls);
//   - a caster identity under its line fills the deficit with SPIRIT, never
//     Intellect, so no Spell Power moves anywhere;
//   - a physical identity over its line (the stamina-free necks, rings and
//     weapons) has Strength/Agility trimmed proportionally onto the line;
//   - an item on the drift allowlist (off budget before the model) gets the floor
//     only; its line is the drift cleanup's job.
// Items with no derivable tier get the floor from their own authored line (the
// same proxy the guard uses).
//
// Usage: npx tsx scripts/stamina_baseline_codemod.ts [--dry] [--allowlist <file>]
// Writes a receipt to stdout (id, before, after) and edits src/sim/content/*.ts in
// place; run biome on the touched files afterwards.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { ITEMS } from '../src/sim/data';
import {
  expectedLineBudget,
  isItemLevelEligible,
  normalizePrimaryStats,
  PRIMARY_STATS,
  STAMINA_PREMIUM,
  staminaBaseline,
  statIdentity,
} from '../src/sim/item_level';
import type { CoreStats, ItemDef } from '../src/sim/types';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const allowlistArg = args.indexOf('--allowlist');
const allowlistFile =
  allowlistArg >= 0 ? args[allowlistArg + 1] : 'tests/item_stamina_baseline.test.ts';

// The drift allowlist is read from the guard test itself so the two cannot drift.
function readAllowlist(file: string): Set<string> {
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf('STAT_DRIFT_ALLOWLIST');
  const open = text.indexOf('[', start);
  const close = text.indexOf(']);', open);
  const body = text.slice(open + 1, close);
  return new Set([...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
}
const DRIFT = readAllowlist(allowlistFile);

type Stats = Partial<CoreStats>;

function lineOf(stats: Stats, identity: 'caster' | 'physical'): number {
  return identity === 'caster'
    ? (stats.int ?? 0) + (stats.spi ?? 0)
    : (stats.str ?? 0) + (stats.agi ?? 0) + (stats.int ?? 0) + (stats.spi ?? 0);
}

function planFor(item: ItemDef): Stats | null {
  const stats: Stats = { ...(item.stats ?? {}) };
  const identity = statIdentity(stats);
  const line = expectedLineBudget(item);
  const before = JSON.stringify(stats);
  if (line === undefined) {
    const proxy =
      identity === 'caster'
        ? Math.round(lineOf(stats, 'caster') / 3)
        : Math.round(lineOf(stats, 'physical') / 2);
    if ((stats.sta ?? 0) >= proxy || proxy <= 0) return null;
    return { ...stats, sta: proxy };
  }
  const baseline = staminaBaseline(line);
  const sta = Math.max(stats.sta ?? 0, baseline);
  const extra = Math.max(0, sta - baseline);
  const out: Stats = { ...stats };
  if (sta > (stats.sta ?? 0)) out.sta = sta;
  const allow = DRIFT.has(item.id);
  const current = lineOf(stats, identity);
  if (identity === 'caster') {
    const expectedLine = line - STAMINA_PREMIUM * extra;
    if (!allow && current < expectedLine) out.spi = (stats.spi ?? 0) + (expectedLine - current);
  } else {
    const expectedLine = line - baseline - STAMINA_PREMIUM * extra;
    if (!allow && current > expectedLine) {
      const offense: Stats = {};
      for (const k of ['str', 'agi', 'int', 'spi'] as const) {
        if ((stats[k] ?? 0) > 0) offense[k] = stats[k];
      }
      const trimmed = normalizePrimaryStats(offense, expectedLine);
      for (const k of ['str', 'agi', 'int', 'spi'] as const) {
        if (k in offense) out[k] = trimmed[k] ?? 0;
      }
    }
  }
  return JSON.stringify(out) === before ? null : out;
}

// Render a stats literal in the catalog's house style, keeping the item's existing
// key order and appending any new keys after it.
function renderStats(before: Stats, after: Stats): string {
  const keys: string[] = [];
  for (const k of Object.keys(before)) keys.push(k);
  for (const k of ['sta', 'spi', 'str', 'agi', 'int', 'armor']) {
    if (k in after && !keys.includes(k)) keys.push(k);
  }
  const parts = keys
    .filter((k) => after[k as keyof Stats] !== undefined)
    .map((k) => `${k}: ${after[k as keyof Stats]}`);
  return `{ ${parts.join(', ')} }`;
}

function walkContent(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkContent(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.generated.ts')) out.push(full);
  }
  return out;
}

const plan = new Map<string, { before: Stats; after: Stats }>();
for (const item of Object.values(ITEMS) as ItemDef[]) {
  if (!isItemLevelEligible(item)) continue;
  const after = planFor(item);
  if (after) plan.set(item.id, { before: { ...(item.stats ?? {}) }, after });
}
console.log(`planned ${plan.size} rewrites (allowlist ${DRIFT.size} ids)`);

const files = walkContent('src/sim/content', []);
const applied = new Set<string>();
let touchedFiles = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      let id: string | undefined;
      let statsProp: ts.PropertyAssignment | undefined;
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text === 'id' && ts.isStringLiteral(prop.initializer))
          id = prop.initializer.text;
        if (prop.name.text === 'stats' && ts.isObjectLiteralExpression(prop.initializer))
          statsProp = prop;
      }
      if (id && statsProp && plan.has(id) && !applied.has(id)) {
        const entry = plan.get(id) as { before: Stats; after: Stats };
        edits.push({
          start: statsProp.initializer.getStart(sf),
          end: statsProp.initializer.getEnd(),
          text: renderStats(entry.before, entry.after),
        });
        applied.add(id);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (edits.length === 0) continue;
  edits.sort((a, b) => b.start - a.start);
  let next = source;
  for (const e of edits) next = next.slice(0, e.start) + e.text + next.slice(e.end);
  touchedFiles += 1;
  console.log(`${relative(process.cwd(), file)}: ${edits.length} items`);
  if (!dry) writeFileSync(file, next);
}
const unapplied = [...plan.keys()].filter((id) => !applied.has(id));
console.log(
  `applied ${applied.size} in ${touchedFiles} files; ${unapplied.length} planned ids had no literal (generated or non-literal):`,
);
console.log(unapplied.join(' '));
for (const [id, { before, after }] of plan) {
  if (applied.has(id))
    console.log(`  ${id}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
}
