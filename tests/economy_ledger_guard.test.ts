// The CI guard the Economy Watch design rests on.
//
// `src/sim/economy_events.ts` claims that a new faucet CANNOT skip the ledger,
// because writing the purse and emitting the audit event are the same call. That
// claim is only true while it is enforced: nothing in TypeScript stops someone
// adding `meta.copper += reward` beside a comment saying they will book it
// later. This file is the enforcement, and both source modules name it in their
// headers as such.
//
// Three separate rules, because three different mistakes each silently break a
// different half of the system:
//
//   1. NO RAW PURSE MUTATION. A `.copper +=` outside `applyMoneyDelta` is coin
//      that moved with no row to explain it, which the reconciler then reports
//      as a conservation violation against an innocent player.
//   2. NO DEAD VOCABULARY. A kind with no emit site is a promise the ledger
//      does not keep: it shows up in the admin filter and the Prometheus label
//      set as a category that can never have data, and it hides the fact that
//      the movement it names is going unbooked somewhere.
//   3. TOTAL CLASSIFICATION. Every kind must be exactly one of faucet, sink or
//      transfer. An unclassified kind is invisible to the supply identity, so
//      coin minted under it would look to the reconciler like a duplication,
//      and coin burned under it like a theft.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ECONOMY_EVENT_KINDS,
  FAUCET_KINDS,
  RESERVED_KINDS,
  SINK_KINDS,
  TRANSFER_KINDS,
} from '../src/sim/economy_event_kinds';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SIM_ROOT = join(repoRoot, 'src', 'sim');

function simSources(dir = SIM_ROOT, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      simSources(full, out);
      continue;
    }
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const SOURCES = simSources().map((file) => ({
  file: file.slice(repoRoot.length).replace(/\\/g, '/'),
  text: readFileSync(file, 'utf8'),
}));

// -------------------------------------------------------------------------
// Rule 1: no raw purse mutation.
// -------------------------------------------------------------------------

// A mutation through a RECEIVER (`something.copper += n`), which is what a purse
// write looks like. A bare `copper += n` is a local accumulator in some caller's
// own arithmetic and is not a mutation of anything the ledger tracks.
const RECEIVER_MUTATION = /\b([A-Za-z_$][\w$]*)\.copper\s*(?:\+=|-=|=(?!=))/g;

// Writes that are NOT a character's purse changing hands, allowed by EXACT
// source line so that editing one still has to come back through here. A
// per-file or per-variable exemption would quietly cover the next line someone
// adds beside it, which is the line this gate exists to catch.
const ALLOWED: Record<string, { code: string; why: string }[]> = {
  'src/sim/sim.ts': [
    {
      code: 'meta.copper = s.copper;',
      why: 'the LOAD path. Restoring a saved purse is not a movement: the coin was already booked when it was earned, and emitting a row here would mint the character their whole balance again on every login.',
    },
    {
      code: 'this.primary.copper = v;',
      why: 'the legacy `sim.copper` facade setter. Its only callers are test fixtures seeding a purse; a production caller would be a silent bypass, so a new one belongs in applyMoneyDelta instead.',
    },
  ],
  'src/sim/market.ts': [
    {
      code: 'col.copper += proceeds;',
      why: "the seller's collection box, a pool. The movement is booked on the emitPoolMovement lines beside it.",
    },
    {
      code: 'to.copper += from.copper;',
      why: 'merging one collection box into another when a seller key is rekeyed. Pool to pool, same owner, no coin created or destroyed.',
    },
    {
      code: 'col.copper = 0;',
      why: 'emptying the box the market_escrow_release row above just described.',
    },
  ],
  'src/sim/mail/post_office.ts': [
    {
      code: 'm.copper = 0;',
      why: "clearing the letter's escrowed coin, which the mail_claim pair immediately above already booked.",
    },
  ],
  'src/sim/loot/loot_roll.ts': [
    {
      code: 'mob.loot.copper = 0;',
      why: 'a corpse loot bundle, not a purse. Nothing holds this coin until it is awarded, and the award goes through applyMoneyDelta.',
    },
  ],
  'src/sim/rift/progression.ts': [
    {
      code: 'loot.copper = (loot.copper ?? 0) + RIFT_COIN_BONUS_C;',
      why: 'a loot bundle being sized before it is awarded; the award books it.',
    },
    {
      code: 'loot.copper = (loot.copper ?? 0) + coinBonus;',
      why: 'a loot bundle being sized before it is awarded; the award books it.',
    },
    {
      code: 'loot.copper = Math.round(loot.copper * Math.max(0.5, Math.min(2, lootMultiplier)));',
      why: 'a loot bundle being scaled before it is awarded; the award books it.',
    },
  ],
};

describe('no purse moves without a ledger row', () => {
  it('keeps every raw .copper write inside applyMoneyDelta or a documented exemption', () => {
    const offenders: string[] = [];
    for (const { file, text } of SOURCES) {
      // The one module allowed to write a purse; that is its entire job.
      if (file === 'src/sim/economy_events.ts') continue;
      const allowed = new Set((ALLOWED[file] ?? []).map((e) => e.code));
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const code = lines[i].trim();
        // A comment naming a mutation is prose about one, not one. Only a line
        // that OPENS as a comment is skipped, so a real write with a trailing
        // `// booked elsewhere` still has to answer for itself.
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue;
        if (!RECEIVER_MUTATION.test(code)) continue;
        RECEIVER_MUTATION.lastIndex = 0; // the regex is /g; do not carry state
        if (allowed.has(code)) continue;
        offenders.push(`${file}:${i + 1} ${code}`);
      }
    }
    // A failure here is NOT fixed by adding a line to ALLOWED unless the write
    // genuinely is not a character's purse gaining or losing coin. The fix for a
    // purse is applyMoneyDelta, which writes the purse and emits the row in one
    // call so the two cannot come apart.
    expect(offenders).toEqual([]);
  });

  it('has no stale exemptions', () => {
    // An exemption whose line no longer exists is a rule nobody is following any
    // more, and it would silently re-allow that exact text if it came back.
    const stale: string[] = [];
    for (const [file, entries] of Object.entries(ALLOWED)) {
      const text = SOURCES.find((s) => s.file === file)?.text ?? '';
      const lines = new Set(text.split('\n').map((l) => l.trim()));
      for (const e of entries) if (!lines.has(e.code)) stale.push(`${file}: ${e.code}`);
    }
    expect(stale).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// Rule 2: no dead vocabulary, and no reserved kind quietly going live.
// -------------------------------------------------------------------------

// Where a kind is USED as a movement, i.e. passed to one of the two emitters.
// Matching the emitter call rather than the bare string keeps a kind named only
// in a comment, a test fixture, or its own classification list from counting as
// an emit site.
function emitsKind(kind: string): boolean {
  const quoted = `'${kind}'`;
  return SOURCES.some(
    ({ file, text }) =>
      file !== 'src/sim/economy_event_kinds.ts' &&
      file !== 'src/sim/economy_events.ts' &&
      (text.includes(`applyMoneyDelta(`) || text.includes(`emitPoolMovement(`)) &&
      text.includes(quoted),
  );
}

describe('the kind allowlist stays honest', () => {
  it('has an emit site for every kind that is not deliberately reserved', () => {
    const reserved = new Set<string>(RESERVED_KINDS);
    const dead = ECONOMY_EVENT_KINDS.filter((k) => !reserved.has(k) && !emitsKind(k));
    // Add the emit site, or move the kind into RESERVED_KINDS with a reason in
    // the source saying why the movement it names cannot happen yet.
    expect(dead).toEqual([]);
  });

  it('keeps reserved kinds genuinely unemitted', () => {
    // The other direction, and the one that rots silently: a reserved kind that
    // gains an emit site is no longer reserved, and leaving it listed tells the
    // next reader that a live faucet does not exist.
    const live = RESERVED_KINDS.filter((k) => emitsKind(k));
    expect(live).toEqual([]);
  });
});

// -------------------------------------------------------------------------
// Rule 3: every kind is classified exactly once.
// -------------------------------------------------------------------------

describe('the supply identity can see every kind', () => {
  it('classifies each kind as exactly one of faucet, sink or transfer', () => {
    const misfiled: string[] = [];
    for (const kind of ECONOMY_EVENT_KINDS) {
      const memberships = [
        FAUCET_KINDS.includes(kind) ? 'faucet' : null,
        SINK_KINDS.includes(kind) ? 'sink' : null,
        TRANSFER_KINDS.includes(kind) ? 'transfer' : null,
      ].filter((m): m is string => m !== null);
      // Unclassified coin is invisible to the identity: a mint nobody counted
      // reads as a duplication and a burn nobody counted reads as a theft.
      if (memberships.length !== 1) {
        misfiled.push(
          `${kind}: ${memberships.length === 0 ? 'unclassified' : memberships.join('+')}`,
        );
      }
    }
    expect(misfiled).toEqual([]);
  });

  it('classifies nothing that is not a kind', () => {
    const known = new Set<string>(ECONOMY_EVENT_KINDS);
    const stray = [...FAUCET_KINDS, ...SINK_KINDS, ...TRANSFER_KINDS].filter((k) => !known.has(k));
    expect(stray).toEqual([]);
  });
});
