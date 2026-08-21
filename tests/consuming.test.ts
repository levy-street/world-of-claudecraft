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

describe('the builder is the ONE Consuming writer', () => {
  it('no src/sim site hand-builds an eating/drinking record outside the two dev freezes', () => {
    // The acceptance of ruling 11c-A2-BUILDER, held at the source level: a
    // THIRD hand-built copy of the shape is how the wellFed carry gets
    // forgotten again. The two deliberate non-writers are the dev-scenario
    // zero-rate meals in src/sim/sim.ts ('dev_cascade_freeze',
    // 'dev_sandbox_freeze'): no item def, a sentinel `remaining`, must never
    // mint, so they stay hand-built by design and are the ONLY object
    // literals this sweep tolerates, both in sim.ts.
    const offenders: string[] = [];
    let simTsLiterals = 0;
    for (const f of sourceFilesUnder(join(process.cwd(), 'src', 'sim'))) {
      const code = stripComments(readFileSync(f.full, 'utf8'));
      const hits = code.match(/\.(?:eating|drinking)\s*=\s*\{/g) ?? [];
      if (hits.length === 0) continue;
      if (f.file === 'sim.ts') {
        simTsLiterals += hits.length;
        continue;
      }
      offenders.push(`${f.file} (${hits.length})`);
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
