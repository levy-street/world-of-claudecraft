import { describe, expect, it } from 'vitest';
import { DUNGEON_DEFS } from '../src/sim/content/dungeons';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { LootEntry } from '../src/sim/types';

// Gravewyrm Sanctum gold-farm fix: Korzul the Gravewyrm paid a guaranteed
// 50000c base, rolled to 3g to 7g per kill by the loot roller's 0.6x to 1.4x
// band, 10x the 5000c the other two Sanctum bosses pay, on a lockout-free,
// skip-pullable finale. (The instance-reset exploit itself was closed by
// issue #1600, tests/gravewyrm_farm_exploit.test.ts; this pins the payout
// that still made rate-limited repeat pops the prime farm target.) The base
// drops to 15000c: a 1.5g nominal payout whose rolled band (9000c to 21000c)
// is the closest fit to the intended 1g to 2g the fixed variance allows,
// still a 3x finale premium over the sibling bosses.
const KORZUL_BASE_COPPER = 15000;
const KORZUL_HEROIC_COPPER = 100000; // the shared 10g heroic finale base
const SIBLING_BOSS_COPPER = 5000;
const ROLLED_MIN_COPPER = 9000; // ceil(15000 * 0.6)
const ROLLED_MAX_COPPER = 21000; // ceil(15000 * 1.4)
const HEROIC_ROLLED_MIN_COPPER = 60000; // ceil(100000 * 0.6)
const HEROIC_ROLLED_MAX_COPPER = 140000; // ceil(100000 * 1.4)
// How close to each band edge the sampled rolls must reach. Over 2000 uniform
// draws the chance of missing a 100-wide edge window is about 2e-7 per edge,
// so this cannot flake, while a roller band narrowed by even ~0.7% fails.
const EDGE_SLACK_COPPER = 100;

// Presence filter for authored money rows. Broader than the roller's own
// truthiness gate (loot_roll.ts skips a copper: 0 row) ON PURPOSE: the test
// counts every authored copper field, so it over-reports rather than letting
// a zero-valued row sit unexamined.
function copperEntries(loot: LootEntry[] | undefined) {
  return (loot ?? []).filter((entry) => entry.copper !== undefined);
}

// Drives the authoritative roller (Sim.rollLoot) the same way combat death
// does, so the assertion covers the real payout path, not just the record.
function rolledKorzulCopper(seed: number, kills: number): number[] {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Looter');
  const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(pid);
  const template = MOBS.korzul_the_gravewyrm;
  const amounts: number[] = [];
  for (let i = 0; i < kills; i++) {
    const mob = createMob(-1, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    (sim as unknown as { rollLoot: (m: unknown, meta: unknown) => void }).rollLoot(mob, meta);
    amounts.push(mob.loot?.copper ?? 0);
  }
  return amounts;
}

// Kills the real spawned Korzul inside a real HEROIC instance through the
// real death path (dealDamage -> handleDeath -> rollLoot with a live heroic
// claim), mirroring the rig in tests/heroic_loot_flair.test.ts.
function heroicKillCopper(seed: number): number {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const s = sim as unknown as Record<string, any>;
  const pid = sim.addPlayer('warrior', 'Solo');
  sim.setDungeonDifficulty('heroic', pid);
  enterDungeon(s.ctx, 'gravewyrm_sanctum', pid);
  const inst = (s.instances as any[]).find(
    (i) => i.dungeonId === 'gravewyrm_sanctum' && i.difficulty === 'heroic' && i.partyKey !== null,
  );
  const korzul = inst.mobIds
    .map((id: number) => s.entities.get(id))
    .find((e: any) => e?.templateId === 'korzul_the_gravewyrm');
  const p = s.entities.get(pid);
  p.pos = { x: korzul.pos.x + 1, y: korzul.pos.y, z: korzul.pos.z };
  p.prevPos = { ...p.pos };
  s.rebucket(p);
  s.dealDamage(p, korzul, korzul.hp + 100, false, 'physical', null, 'hit');
  return korzul.loot?.copper ?? 0;
}

describe('Gravewyrm Sanctum end-boss gold (farm fix)', () => {
  it('pins Korzul to exactly one guaranteed money entry at the 15000c base', () => {
    // The roller ACCUMULATES copper across matching entries, so the count is
    // load-bearing: a second entry would reintroduce the payout with the
    // per-entry pin still green.
    const money = copperEntries(MOBS.korzul_the_gravewyrm.loot);
    expect(money).toHaveLength(1);
    expect(money[0].copper).toBe(KORZUL_BASE_COPPER);
    expect(money[0].heroicCopper).toBe(KORZUL_HEROIC_COPPER);
    expect(money[0].chance).toBe(1);
  });

  it('keeps the heroic append table free of money entries', () => {
    // Heroic Korzul pays through the same base money entry: the heroic
    // append loop handles itemId rows only and IGNORES a copper field, so a
    // copper row here would silently pay nothing while burning a chance
    // draw. This pins that no one authors one; the only live payout vector
    // is the base table's single money entry, pinned above.
    expect(copperEntries(HEROIC_BOSS_LOOT.korzul_the_gravewyrm)).toHaveLength(0);
  });

  it('keeps Korzul the only Sanctum money outlier (whole spawn list derived)', () => {
    // The two named mid-bosses hold the 5000c line (the 3x premium, not the
    // old 10x), pinned as literals.
    expect(copperEntries(MOBS.korgath_the_bound.loot)[0]?.copper).toBe(SIBLING_BOSS_COPPER);
    expect(copperEntries(MOBS.grand_necromancer_velkhar.loot)[0]?.copper).toBe(SIBLING_BOSS_COPPER);
    // Then the ceiling is derived over EVERY mob the Sanctum spawns
    // (summoned adds included), not a hand-picked id pair, so a future mob
    // authored above the mid-boss line fails here instead of silently
    // re-opening the farm this change closes. (Only the finale carries
    // boss: true, so a flag-filtered roster would cover one mob.)
    const mobIds = new Set(DUNGEON_DEFS.gravewyrm_sanctum.spawns.map((spawn) => spawn.mobId));
    for (const id of [...mobIds]) {
      const summoned = MOBS[id].summonAdds?.mobId;
      if (summoned) mobIds.add(summoned);
    }
    expect(mobIds.has('korzul_the_gravewyrm')).toBe(true);
    expect(mobIds.size).toBeGreaterThanOrEqual(5);
    for (const id of mobIds) {
      if (id === 'korzul_the_gravewyrm') continue;
      for (const entry of copperEntries(MOBS[id].loot)) {
        expect(entry.copper, id).toBeLessThanOrEqual(SIBLING_BOSS_COPPER);
      }
    }
  });

  it('every rolled payout lands inside the 9000c to 21000c band, edges reached', () => {
    const amounts = rolledKorzulCopper(1234, 2000);
    for (const copper of amounts) {
      expect(copper).toBeGreaterThanOrEqual(ROLLED_MIN_COPPER);
      expect(copper).toBeLessThanOrEqual(ROLLED_MAX_COPPER);
    }
    // Both band edges are approached within EDGE_SLACK_COPPER, so a roller
    // variance narrowed past ~0.7% fails rather than passing inside a wider
    // pin, and the spread really is a distribution, not two extremes.
    expect(Math.min(...amounts)).toBeLessThan(ROLLED_MIN_COPPER + EDGE_SLACK_COPPER);
    expect(Math.max(...amounts)).toBeGreaterThan(ROLLED_MAX_COPPER - EDGE_SLACK_COPPER);
    expect(new Set(amounts).size).toBeGreaterThan(1000);
  });

  it('heroic Korzul pays the 10g finale band through the real heroic death path', () => {
    // The daily-lockout heroic clear substitutes the 100000c finale base on
    // the same money entry (LootEntry.heroicCopper): every heroic kill pays
    // 60000c to 140000c. Both the normal band (9000c to 21000c) and the old
    // 50000c base (30000c to 70000c) are disjoint from parts of this band,
    // and no sample may fall outside it.
    for (let seed = 1; seed <= 8; seed++) {
      const copper = heroicKillCopper(seed);
      expect(copper, `seed ${seed}`).toBeGreaterThanOrEqual(HEROIC_ROLLED_MIN_COPPER);
      expect(copper, `seed ${seed}`).toBeLessThanOrEqual(HEROIC_ROLLED_MAX_COPPER);
    }
  });
});
