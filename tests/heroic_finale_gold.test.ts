import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { LootEntry, MobTemplate } from '../src/sim/types';

// Heroic finale gold (LootEntry.heroicCopper; bases in
// src/sim/content/dungeon_difficulty.ts, ladder doc in
// docs/design/dungeon-gold.md): a heroic-claim kill of a dungeon's final
// boss substitutes a raised money base on the SAME single rng draw.
// Five-man finales pay 10g nominal (100000c, rolls 60000c to 140000c); a
// raid finale pays 20g (200000c, rolls 120000c to 280000c).
// Normal-mode kills keep the modest per-dungeon bases: heroic sits behind
// the per-dungeon daily lockout, so the raise rewards the legitimate clear
// without re-opening the repeat farms the normal-mode nerfs closed
// (tests/gravewyrm_boss_gold.test.ts).
const FIVE_MAN_HEROIC_COPPER = 100000;
const RAID_HEROIC_COPPER = 200000;
const HEROIC_ROLL_MIN = 60000; // ceil(100000 * 0.6)
const HEROIC_ROLL_MAX = 140000; // ceil(100000 * 1.4)
const RAID_ROLL_MIN = 120000; // ceil(200000 * 0.6)
const RAID_ROLL_MAX = 280000; // ceil(200000 * 1.4)
const NORMAL_ROLL_MIN = 9000; // ceil(15000 * 0.6)
const NORMAL_ROLL_MAX = 21000; // ceil(15000 * 1.4)
// The raid-tier finales: both pay the shared 20g heroic base and the 15g
// normal base (the Ignivar development raid mirrors the Nythraxis wiring).
const RAID_FINALE_DUNGEON_IDS = new Set([
  'nythraxis_boss_arena',
  'ignivar_raid_arena',
  'ignivar_inner_crucible',
]);
// The full normal-mode finale money ladder, pinned so a single-boss retune
// (up or down) is a deliberate edit here, not a drive-by.
const NORMAL_FINALE_COPPER: Record<string, number> = {
  hollow_crypt: 2500,
  sunken_bastion: 5000,
  drowned_temple: 6000,
  gravewyrm_sanctum: 15000,
  wildheart_basin: 15000,
  nythraxis_boss_arena: 150000,
  ignivar_raid_arena: 150000,
  ignivar_inner_crucible: 200000,
};

function copperEntries(loot: LootEntry[] | undefined) {
  return (loot ?? []).filter((entry) => entry.copper !== undefined);
}

function heroicBandFor(dungeonId: string): { min: number; max: number } {
  return RAID_FINALE_DUNGEON_IDS.has(dungeonId)
    ? { min: RAID_ROLL_MIN, max: RAID_ROLL_MAX }
    : { min: HEROIC_ROLL_MIN, max: HEROIC_ROLL_MAX };
}

// Kills the real spawned finale boss inside a real instance through the real
// death path (dealDamage -> handleDeath -> rollLoot with a live claim), the
// tests/heroic_loot_flair.test.ts rig.
function instanceKillCopper(
  dungeonId: string,
  bossTemplateId: string,
  seed: number,
  difficulty: 'normal' | 'heroic',
): number {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const s = sim as unknown as Record<string, any>;
  const pid = sim.addPlayer('warrior', 'Solo');
  if (difficulty === 'heroic') sim.setDungeonDifficulty('heroic', pid);
  enterDungeon(s.ctx, dungeonId, pid);
  const inst = (s.instances as any[]).find(
    (i) => i.dungeonId === dungeonId && i.difficulty === difficulty && i.partyKey !== null,
  );
  const boss = inst.mobIds
    .map((id: number) => s.entities.get(id))
    .find((e: any) => e?.templateId === bossTemplateId);
  const p = s.entities.get(pid);
  p.pos = { x: boss.pos.x + 1, y: boss.pos.y, z: boss.pos.z };
  p.prevPos = { ...p.pos };
  s.rebucket(p);
  s.dealDamage(p, boss, boss.hp + 100, false, 'physical', null, 'hit');
  return boss.loot?.copper ?? 0;
}

// Drives the roller directly, optionally under a SYNTHETIC heroic claim (a
// minimal instance record covering the mob id: the same three fields the
// roller's heroicClaim predicate reads). Returns the rolled copper plus one
// post-roll rng draw as a stream-position probe.
function rollWithClaim(
  template: MobTemplate,
  heroic: boolean,
  seed: number,
): { copper: number; probe: number } {
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true });
  const s = sim as unknown as Record<string, any>;
  const pid = sim.addPlayer('warrior', 'Looter');
  const meta = s.players.get(pid);
  const mob = createMob(-1, template, template.maxLevel, { x: 0, y: 0, z: 0 });
  if (heroic) {
    (s.instances as any[]).push({
      dungeonId: 'synthetic_probe',
      difficulty: 'heroic',
      partyKey: 'probe',
      mobIds: [mob.id],
    });
  }
  s.rollLoot(mob, meta);
  return { copper: mob.loot?.copper ?? 0, probe: s.ctx.rng.next() };
}

describe('heroic finale gold policy', () => {
  it('every heroic dungeon finale carries the heroic money base, raid at 20g', () => {
    const tunings = Object.values(HEROIC_DUNGEON_TUNING);
    // Vacuity floor: the live registry holds the five 5-mans plus the raid.
    expect(tunings.length).toBeGreaterThanOrEqual(6);
    for (const tuning of tunings) {
      const money = copperEntries(MOBS[tuning.finalBossId].loot);
      expect(money, tuning.id).toHaveLength(1);
      expect(money[0].chance, tuning.id).toBe(1);
      expect(money[0].copper, tuning.id).toBe(NORMAL_FINALE_COPPER[tuning.id]);
      // The roller's money arm gates on a truthy copper, so a heroicCopper
      // riding a zero base would silently pay nothing on heroic.
      expect(money[0].copper, tuning.id).toBeGreaterThan(0);
      const expectedHeroic = RAID_FINALE_DUNGEON_IDS.has(tuning.id)
        ? RAID_HEROIC_COPPER
        : FIVE_MAN_HEROIC_COPPER;
      expect(money[0].heroicCopper, tuning.id).toBe(expectedHeroic);
    }
    // The ladder table covers exactly the live registry (a new heroic
    // dungeon must take a deliberate row here).
    expect(Object.keys(NORMAL_FINALE_COPPER).sort()).toEqual(tunings.map((t) => t.id).sort());
  });

  it('no mob outside the heroic finale set carries the heroic money base', () => {
    const finaleBossIds = new Set(
      Object.values(HEROIC_DUNGEON_TUNING).map((tuning) => tuning.finalBossId),
    );
    const carriers = Object.values(MOBS)
      .filter((mob) => (mob.loot ?? []).some((entry) => entry.heroicCopper !== undefined))
      .map((mob) => mob.id)
      .sort();
    expect(carriers).toEqual([...finaleBossIds].sort());
  });

  it('no heroic append table anywhere carries money entries', () => {
    // The heroic append loop handles itemId rows only and IGNORES a copper
    // field, so a copper row in any HEROIC_BOSS_LOOT table would silently
    // pay nothing while burning a chance draw.
    const tables = Object.entries(HEROIC_BOSS_LOOT);
    expect(tables.length).toBeGreaterThanOrEqual(6);
    for (const [bossId, rows] of tables) {
      expect(copperEntries(rows), bossId).toHaveLength(0);
    }
  });

  it('every finale rolls its heroic band under a live heroic claim', () => {
    // Covers all six finales through the roller, the 20g raid value
    // included, via the synthetic-claim rig (the real-rig kills below prove
    // the claim plumbing end to end for one dungeon per difficulty).
    for (const tuning of Object.values(HEROIC_DUNGEON_TUNING)) {
      const { min, max } = heroicBandFor(tuning.id);
      for (let seed = 1; seed <= 3; seed++) {
        const { copper } = rollWithClaim(MOBS[tuning.finalBossId], true, seed * 101);
        expect(copper, `${tuning.id} seed ${seed}`).toBeGreaterThanOrEqual(min);
        expect(copper, `${tuning.id} seed ${seed}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it('the heroic substitution keeps the rng stream position identical', () => {
    // Same seed, same synthetic template (registered into MOBS because the
    // roller resolves the table by templateId, and absent from
    // HEROIC_BOSS_LOOT so the heroic-only item append cannot add draws),
    // rolled once without and once with a heroic claim: the payouts land in
    // different bands but the post-roll rng probe must match exactly,
    // proving the substitution is a value swap and never an extra draw.
    const template: MobTemplate = {
      ...MOBS.sanctum_boneguard,
      id: 'synthetic_gold_probe',
      loot: [{ copper: 1000, heroicCopper: 5000, chance: 1 }],
    };
    (MOBS as Record<string, MobTemplate>).synthetic_gold_probe = template;
    try {
      const normal = rollWithClaim(template, false, 424242);
      const heroic = rollWithClaim(template, true, 424242);
      expect(normal.copper).toBeGreaterThanOrEqual(600);
      expect(normal.copper).toBeLessThanOrEqual(1400);
      expect(heroic.copper).toBeGreaterThanOrEqual(3000);
      expect(heroic.copper).toBeLessThanOrEqual(7000);
      expect(heroic.probe).toBe(normal.probe);
    } finally {
      delete (MOBS as Record<string, MobTemplate>).synthetic_gold_probe;
    }
  });

  it('heroic Zulgar pays the 10g finale band through the real heroic death path', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const copper = instanceKillCopper('wildheart_basin', 'wildheart_high_priest', seed, 'heroic');
      expect(copper, `seed ${seed}`).toBeGreaterThanOrEqual(HEROIC_ROLL_MIN);
      expect(copper, `seed ${seed}`).toBeLessThanOrEqual(HEROIC_ROLL_MAX);
    }
  });

  it('a live NORMAL instance claim still pays the normal base', () => {
    // Pins the difficulty clause of the claim predicate: a refactor that
    // widened heroicClaim to ANY live claim would pay the heroic base here.
    for (let seed = 1; seed <= 4; seed++) {
      const copper = instanceKillCopper('wildheart_basin', 'wildheart_high_priest', seed, 'normal');
      expect(copper, `seed ${seed}`).toBeGreaterThanOrEqual(NORMAL_ROLL_MIN);
      expect(copper, `seed ${seed}`).toBeLessThanOrEqual(NORMAL_ROLL_MAX);
    }
  });

  it('normal-mode Zulgar ignores the heroic base (the farm nerf holds)', () => {
    // A bare mob outside any instance carries no claim at all, so the roller
    // must use the 15000c normal base: every payout inside 9000c to 21000c.
    // Under the old 55000c base every roll paid at least 33000c.
    const sim = new Sim({ seed: 77, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Looter');
    const meta = (sim as unknown as { players: Map<number, unknown> }).players.get(pid);
    const template = MOBS.wildheart_high_priest;
    for (let i = 0; i < 500; i++) {
      const mob = createMob(-1, template, template.maxLevel, { x: 0, y: 0, z: 0 });
      (sim as unknown as { rollLoot: (m: unknown, meta: unknown) => void }).rollLoot(mob, meta);
      const copper = mob.loot?.copper ?? 0;
      expect(copper).toBeGreaterThanOrEqual(NORMAL_ROLL_MIN);
      expect(copper).toBeLessThanOrEqual(NORMAL_ROLL_MAX);
    }
  });
});
