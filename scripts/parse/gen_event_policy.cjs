// Regenerates server/parse/event_policy.ts from the SimEvent union.
//
// Reads the union through the TypeScript checker (so members declared as
// named aliases count, not just inline `{ type: '...' }` literals), keeps
// every classification already present in the file, and adds new types as
// 'skip' with a TODO marker so the diff shows exactly what needs a decision.
// Typecheck is the real guard (the map is a Record over the union); this
// script just saves the typing.
//
//   node scripts/parse/gen_event_policy.cjs
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..', '..');
const typesPath = path.join(root, 'src', 'sim', 'types.ts');
const policyPath = path.join(root, 'server', 'parse', 'event_policy.ts');

const program = ts.createProgram([typesPath], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(typesPath);
if (!source) throw new Error(`cannot load ${typesPath}`);

let simEventType = null;
ts.forEachChild(source, (node) => {
  if (ts.isTypeAliasDeclaration(node) && node.name.text === 'SimEvent') {
    simEventType = checker.getTypeAtLocation(node.name);
  }
});
if (!simEventType) throw new Error('SimEvent alias not found');

const names = new Set();
const members = simEventType.isUnion() ? simEventType.types : [simEventType];
for (const member of members) {
  const prop = member.getProperty('type');
  if (!prop) continue;
  const propType = checker.getTypeOfSymbol(prop);
  const literals = propType.isUnion() ? propType.types : [propType];
  for (const literal of literals) {
    if (literal.isStringLiteral()) names.add(literal.value);
  }
}
if (names.size === 0) throw new Error('no event type literals found');

// Keep existing decisions; only genuinely new types get the placeholder.
const existing = new Map();
if (fs.existsSync(policyPath)) {
  const current = fs.readFileSync(policyPath, 'utf8');
  for (const m of current.matchAll(/^  ([A-Za-z0-9_]+): '(routed|record|skip)',/gm)) {
    existing.set(m[1], m[2]);
  }
}

const sorted = [...names].sort();
const added = [];
const entries = sorted
  .map((name) => {
    const policy = existing.get(name);
    if (policy !== undefined) return `  ${name}: '${policy}',`;
    added.push(name);
    return `  ${name}: 'skip', // TODO(parse): classify (new event type)`;
  })
  .join('\n');
const removed = [...existing.keys()].filter((name) => !names.has(name));

const out = `// Recording policy for every SimEvent type the drain can carry.
//
// The recorder used to route a hand-picked handful of event types and let a
// bare \`default: break\` swallow the rest, which is how respawns and
// resurrection offers stayed invisible to the parse: nothing forced a
// decision when those events were added. This map is keyed by the FULL
// SimEvent type union, so adding a type to the sim fails typecheck here until
// someone classifies it. The classification is the decision record.
//
// - routed: the recorder has a bespoke handler (attribution, rollups, fight
//   opening) in recorder.ts.
// - record: shipped verbatim to the fight of the event's actor; no rollup.
//   Combat-meaningful state changes with no bespoke handling live here.
// - skip: cosmetic, UI-only, or non-combat (chat, loot, quests, cues, ...).
//   Volume or privacy, never "nobody asked yet".
//
// Regenerate the key list with scripts/parse/gen_event_policy.cjs when the
// union changes (existing decisions are kept, new types land as 'skip' with
// a TODO), or add the new key by hand; typecheck enforces completeness.
import type { SimEvent } from '../../src/sim/types';

export type EventRecordPolicy = 'routed' | 'record' | 'skip';

export const EVENT_RECORD_POLICY: Readonly<Record<SimEvent['type'], EventRecordPolicy>> = {
${entries}
};

/** Event types the generic \`record\` path ships; exported for tests. */
export const GENERIC_RECORDED_EVENT_TYPES: ReadonlySet<SimEvent['type']> = new Set(
  (Object.keys(EVENT_RECORD_POLICY) as SimEvent['type'][]).filter(
    (type) => EVENT_RECORD_POLICY[type] === 'record',
  ),
);

/**
 * The entity a generically recorded event belongs to, in the sim's own
 * precedence: a personal event's pid, else the acting entity, else the
 * target, else the source. Null when the event names nobody.
 */
export function eventActorId(ev: SimEvent): number | null {
  const fields = ev as Record<string, unknown>;
  for (const key of ['pid', 'entityId', 'targetId', 'sourceId']) {
    const value = fields[key];
    if (typeof value === 'number') return value;
  }
  return null;
}
`;
fs.writeFileSync(policyPath, out);
console.log(
  `event_policy.ts: ${sorted.length} types, ${added.length} new (${added.join(', ') || 'none'}), ${removed.length} stale (${removed.join(', ') || 'none'})`,
);
