// The one Consuming builder (src/sim/consuming.ts, ruling 11c-A2-BUILDER),
// driven directly as the pure leaf it is, plus the source-level acceptance:
// no writer outside the builder constructs a Consuming record. The defect
// class this closes is a hand-built copy of the shape dropping the wellFed
// carry (the feast bite shipped exactly that: the meal restored health,
// completed, and minted nothing, failing no test on either parent branch).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConsuming } from '../src/sim/consuming';
import { ITEMS } from '../src/sim/data';
import { CONSUME_DURATION, CONSUME_TICKS } from '../src/sim/types';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';
import { stripComments } from './helpers/strip_comments';

describe('buildConsuming', () => {
  it('builds a food meal: rates off CONSUME_TICKS, the full clock, the wellFed carry', () => {
    const dish = ITEMS.evergarden_braised_greens;
    expect(dish.kind).toBe('food');
    const c = buildConsuming('food', dish);
    expect(c).toEqual({
      itemId: 'evergarden_braised_greens',
      kind: 'food',
      hpPer2s: Math.round((dish.foodHp ?? 0) / CONSUME_TICKS),
      manaPer2s: 0,
      remaining: CONSUME_DURATION,
      ticksElapsed: 0,
      wellFed: dish.kind === 'food' ? dish.wellFed : undefined,
    });
    // The carry is a REFERENCE to the def's record, not a copy (house style,
    // the same as def.elixir): the grant is decided by what was eaten.
    expect(c.wellFed).toBe(dish.kind === 'food' ? dish.wellFed : undefined);
  });

  it('a plain food carries no payload key at all (spread-elided, not undefined)', () => {
    const c = buildConsuming('food', ITEMS.vale_hearth_loaf);
    expect('wellFed' in c).toBe(false);
    expect(c.hpPer2s).toBeGreaterThan(0);
    expect(c.manaPer2s).toBe(0);
  });

  it('builds a drink: mana rate, no hp, and the kind guard refuses any payload', () => {
    // The D15 food-only contract enforced at the ONE build site: even a
    // caller handing a payload-bearing def to the drink arm cannot smuggle a
    // buff into gulp completion.
    const c = buildConsuming('drink', {
      id: 'probe_drink',
      drinkMana: 90,
      wellFed: { aura: 'Well Fed', kind: 'buff_sta', value: 5, duration: 600 },
    });
    expect(c).toEqual({
      itemId: 'probe_drink',
      kind: 'drink',
      hpPer2s: 0,
      manaPer2s: Math.round(90 / CONSUME_TICKS),
      remaining: CONSUME_DURATION,
      ticksElapsed: 0,
    });
    expect('wellFed' in c).toBe(false);
  });
});

// The offender predicate the sweep below runs, named so its own reach is
// provable. It catches BOTH assignment shapes a hand-built record can take,
// the dotted slot (`p.eating = {`) and the COMPUTED slot (`p[slot] = {`, the
// exact shape items.ts used before the builder and therefore the exact shape
// a regression would take), on any receiver name; the computed arm is keyed
// on the Consuming SHAPE rather than the assignment alone, because a bare
// computed-key assignment is an everyday idiom this file must not police.
// `ticksElapsed` is the discriminator: it is Consuming's own field, carried
// by every hand-built record and by no other object literal in src/sim.
const CONSUMING_SHAPE_WINDOW = 400;

function hasHandBuiltConsumingWrite(code: string): number {
  let hits = 0;
  const opener = /(?:\.(?:eating|drinking)|\[\s*\w+\s*\])\s*=\s*\{/g;
  for (const m of code.matchAll(opener)) {
    const from = (m.index ?? 0) + m[0].length;
    if (code.slice(from, from + CONSUMING_SHAPE_WINDOW).includes('ticksElapsed')) hits++;
  }
  return hits;
}

describe('the builder is the ONE Consuming writer', () => {
  it('the offender predicate really catches both hand-built shapes (producer self-proof)', () => {
    // The sweep is only evidence if its needle can see the regression shape:
    // the pre-11c items.ts wrote through a COMPUTED slot, which a
    // dotted-only needle is structurally blind to.
    expect(hasHandBuiltConsumingWrite('p.eating = { itemId, ticksElapsed: 0 }')).toBe(1);
    expect(hasHandBuiltConsumingWrite('e.drinking = {\n  ticksElapsed: 0,\n}')).toBe(1);
    expect(hasHandBuiltConsumingWrite('p[slot] = {\n  itemId,\n  ticksElapsed: 0,\n}')).toBe(1);
    // Neither routed construction nor an ordinary computed-key assignment
    // (the idiom the shape discriminator keeps this guard away from).
    expect(hasHandBuiltConsumingWrite('p[slot] = buildConsuming(def.kind, def);')).toBe(0);
    expect(hasHandBuiltConsumingWrite("p.eating = buildConsuming('food', dish);")).toBe(0);
    expect(hasHandBuiltConsumingWrite('byId[key] = { name, count };')).toBe(0);
  });

  it('ITEMS keys equal their def ids (the builder names the meal by def.id)', () => {
    // The builder writes itemId: def.id where the old inline construction
    // wrote the caller's lookup key; equivalent only while no catalog entry
    // is keyed under an alias. Pin the premise so an aliased key cannot
    // silently change which item an eating slot names.
    for (const [key, def] of Object.entries(ITEMS)) {
      expect(def.id, `ITEMS['${key}'] id mismatch`).toBe(key);
    }
  });

  it('no src/sim site hand-builds an eating/drinking record outside the two dev freezes', () => {
    // The acceptance of ruling 11c-A2-BUILDER, held at the source level: a
    // THIRD hand-built copy of the shape is how the wellFed carry gets
    // forgotten again. The two deliberate non-writers are the dev-scenario
    // zero-rate meals in src/sim/sim.ts ('dev_cascade_freeze',
    // 'dev_sandbox_freeze'): no item def, a sentinel `remaining`, must never
    // mint, so they stay hand-built by design and are the ONLY object
    // literals this sweep tolerates, both in sim.ts. The sweep is scoped to
    // src/sim ON PURPOSE: the online mirror (src/net/online.ts) rebuilds
    // display-only eating/drinking shadows off the wire (empty itemId, zero
    // rates, the mirrored remaining, never a payload: the client never
    // mints), a different-host shape the builder must NOT produce.
    const offenders: string[] = [];
    let simTsLiterals = 0;
    for (const f of sourceFilesUnder(join(process.cwd(), 'src', 'sim'))) {
      const code = stripComments(readFileSync(f.full, 'utf8'));
      const hits = hasHandBuiltConsumingWrite(code);
      if (hits === 0) continue;
      if (f.file === 'sim.ts') {
        simTsLiterals += hits;
        continue;
      }
      offenders.push(`${f.file} (${hits})`);
    }
    expect(offenders, 'hand-built Consuming writers outside the builder').toEqual([]);
    expect(simTsLiterals, 'exactly the two dev-scenario freezes in sim.ts').toBe(2);
    // And the named non-writers really are the freeze sentinels, not meals.
    const simSrc = stripComments(readFileSync(join(process.cwd(), 'src', 'sim', 'sim.ts'), 'utf8'));
    expect(simSrc).toContain("itemId: 'dev_cascade_freeze'");
    expect(simSrc).toContain("itemId: 'dev_sandbox_freeze'");
  });

  it('both real writers construct through buildConsuming (positive pin)', () => {
    const itemsSrc = stripComments(
      readFileSync(join(process.cwd(), 'src', 'sim', 'items.ts'), 'utf8'),
    );
    expect(itemsSrc).toContain('p[slot] = buildConsuming(def.kind, def);');
    const feastSrc = stripComments(
      readFileSync(join(process.cwd(), 'src', 'sim', 'professions', 'feast.ts'), 'utf8'),
    );
    expect(feastSrc).toContain("p.eating = buildConsuming('food', dish);");
  });

  it('scan hygiene: this guard reads only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });
});
