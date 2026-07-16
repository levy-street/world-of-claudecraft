// The bespoke Book of Deeds site helpers (the exported on*ForDeeds functions in
// src/sim/deeds.ts) grant the 42 manual-trigger deeds directly from the gameplay
// modules. This suite drives each site through a real Sim's ctx (the deeds.test.ts
// idiom) with decisive positive AND negative cases: every grant is asserted through
// the player's earned set, every negative targets one exact gate condition.
import { describe, expect, it } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import {
  CRAFTING_HUB_MIN_LEVEL,
  CRAFTING_HUB_POS,
  CRAFTING_HUB_RADIUS,
} from '../src/sim/content/professions';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  type CupMatchForDeeds,
  onArenaMatchEndForDeeds,
  onBellContactForDeeds,
  onBloatDetonatedForDeeds,
  onBossAddsSummonedForDeeds,
  onBossSplashHitForDeeds,
  onChatRollForDeeds,
  onCheerForDeeds,
  onCompanionReviveForDeeds,
  onCupGoalForDeeds,
  onCupMatchEndForDeeds,
  onCupSaveForDeeds,
  onCupStandingForDeeds,
  onCupTouchForDeeds,
  onDamageDealtForDeeds,
  onDeathlessRageResolvedForDeeds,
  onDelveClearForDeeds,
  onFiestaTakedownForDeeds,
  onLockpickSuccessForDeeds,
  onMobKillCreditForDeeds,
  onNpcTalkedForDeeds,
  onPlayerDeathForDeeds,
  onRiteFinaleForDeeds,
  onWorldBossKilledForDeeds,
  updateDeeds,
} from '../src/sim/deeds';
import { createMob } from '../src/sim/entity';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { craftItem } from '../src/sim/professions/crafting';
import { type ArenaMatch, type InstanceSlot, type PlayerMeta, Sim } from '../src/sim/sim';
import { endArenaMatch } from '../src/sim/social/arena';
import { applyResurrectionSickness } from '../src/sim/spirit';
import type { DungeonDifficulty, Entity, Vec3 } from '../src/sim/types';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

// Add a fresh player and return its persisted meta.
function addMeta(sim: Sim, name: string): PlayerMeta {
  const pid = sim.addPlayer('warrior', name);
  return sim.players.get(pid)!;
}

function entityOf(sim: Sim, meta: PlayerMeta): Entity {
  return sim.entities.get(meta.entityId)!;
}

// Spawn a real mob entity from its content template. Level is irrelevant to the
// encounter-task branches (they never read it) but matters for the giantslayer gate.
function spawnMob(sim: Sim, templateId: string, pos: Vec3, level = 5): Entity {
  const e = createMob(sim.ctx.nextId++, MOBS[templateId], level, pos);
  sim.addEntity(e);
  return e;
}

// Build a boss encounter inside a claimed instance slot and seat the recipients in
// the instance band, so playersInInstance (the encounter-task recipient set) and
// instanceForMob both resolve to exactly these players.
function encounterInstance(
  sim: Sim,
  templateId: string,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  names: string[],
): { boss: Entity; inst: InstanceSlot; recipients: PlayerMeta[] } {
  const origin = instanceOrigin(DUNGEONS[dungeonId].index, 0);
  const boss = spawnMob(sim, templateId, { x: origin.x, y: 0, z: origin.z }, 30);
  const inst: InstanceSlot = {
    dungeonId,
    difficulty,
    slot: 0,
    partyKey: 'party:deeds-test',
    mobIds: [boss.id],
    objectIds: [],
    exitId: null,
    emptyFor: 0,
    resetAvailableAt: 0,
    clearedBy: new Set(),
    enteredBy: new Set(),
  };
  sim.ctx.instances.push(inst);
  const recipients = names.map((name) => {
    const meta = addMeta(sim, name);
    entityOf(sim, meta).pos = { x: origin.x, y: 0, z: origin.z };
    return meta;
  });
  return { boss, inst, recipients };
}

// A structural Cup match for the deed sites (vale_cup.ts owns the real VcMatch).
function cupMatch(opts: {
  id: number;
  bracket?: number;
  rated?: boolean;
  golden?: boolean;
  scoreA?: number;
  scoreB?: number;
  teamA?: number[];
  teamB?: number[];
  roles?: Record<number, string>;
  benched?: Set<number>;
  practice?: unknown | null;
}): CupMatchForDeeds {
  return {
    id: opts.id,
    bracket: opts.bracket ?? 1,
    rated: opts.rated ?? true,
    golden: opts.golden ?? false,
    scoreA: opts.scoreA ?? 0,
    scoreB: opts.scoreB ?? 0,
    teamA: opts.teamA ?? [],
    teamB: opts.teamB ?? [],
    roles: opts.roles ?? {},
    benched: opts.benched ?? new Set(),
    practice: opts.practice ?? null,
  };
}

function fiestaMatch(sim: Sim, teamA: number[], teamB: number[]): ArenaMatch {
  return {
    id: 1,
    format: 'fiesta',
    teamA,
    teamB,
    slot: 0,
    state: 'over',
    timer: 0,
    returns: new Map(),
    ratingA: 1500,
    ratingB: 1500,
    defeated: new Set(),
    fiesta: sim.ctx.createFiestaState(),
  };
}

describe('encounter mechanical arms (onMobKillCreditForDeeds)', () => {
  it('dgn_morthen_flawless: a clean heroic kill grants; a death taint or normal tier blocks', () => {
    const clean = makeSim();
    const c = encounterInstance(clean, 'morthen', 'hollow_crypt', 'heroic', ['Tank', 'Healer']);
    onMobKillCreditForDeeds(clean.ctx, c.boss, null, c.recipients[0], c.recipients);
    for (const m of c.recipients) expect(m.deedsEarned.has('dgn_morthen_flawless')).toBe(true);

    // A player death inside the engaged boss's heroic instance taints the window.
    const taint = makeSim();
    const t = encounterInstance(taint, 'morthen', 'hollow_crypt', 'heroic', ['Tank']);
    t.boss.threat.set(t.recipients[0].entityId, 100); // engaged: window open
    onPlayerDeathForDeeds(taint.ctx, entityOf(taint, t.recipients[0]));
    onMobKillCreditForDeeds(taint.ctx, t.boss, null, t.recipients[0], t.recipients);
    expect(t.recipients[0].deedsEarned.has('dgn_morthen_flawless')).toBe(false);

    // Same clean pull on Normal difficulty never satisfies the heroic-only gate.
    const normal = makeSim();
    const n = encounterInstance(normal, 'morthen', 'hollow_crypt', 'normal', ['Tank']);
    onMobKillCreditForDeeds(normal.ctx, n.boss, null, n.recipients[0], n.recipients);
    expect(n.recipients[0].deedsEarned.has('dgn_morthen_flawless')).toBe(false);
  });

  it('dgn_ysolei_flawless: a clean heroic kill grants; a death taint blocks', () => {
    const clean = makeSim();
    const c = encounterInstance(clean, 'ysolei', 'drowned_temple', 'heroic', ['Tank']);
    onMobKillCreditForDeeds(clean.ctx, c.boss, null, c.recipients[0], c.recipients);
    expect(c.recipients[0].deedsEarned.has('dgn_ysolei_flawless')).toBe(true);

    const taint = makeSim();
    const t = encounterInstance(taint, 'ysolei', 'drowned_temple', 'heroic', ['Tank']);
    t.boss.threat.set(t.recipients[0].entityId, 100);
    onPlayerDeathForDeeds(taint.ctx, entityOf(taint, t.recipients[0]));
    onMobKillCreditForDeeds(taint.ctx, t.boss, null, t.recipients[0], t.recipients);
    expect(t.recipients[0].deedsEarned.has('dgn_ysolei_flawless')).toBe(false);
  });

  it('dgn_korzul_flawless: a clean heroic kill grants; a death taint blocks', () => {
    const clean = makeSim();
    const c = encounterInstance(clean, 'korzul_the_gravewyrm', 'gravewyrm_sanctum', 'heroic', [
      'Tank',
    ]);
    onMobKillCreditForDeeds(clean.ctx, c.boss, null, c.recipients[0], c.recipients);
    expect(c.recipients[0].deedsEarned.has('dgn_korzul_flawless')).toBe(true);

    const taint = makeSim();
    const t = encounterInstance(taint, 'korzul_the_gravewyrm', 'gravewyrm_sanctum', 'heroic', [
      'Tank',
    ]);
    t.boss.threat.set(t.recipients[0].entityId, 100);
    onPlayerDeathForDeeds(taint.ctx, entityOf(taint, t.recipients[0]));
    onMobKillCreditForDeeds(taint.ctx, t.boss, null, t.recipients[0], t.recipients);
    expect(t.recipients[0].deedsEarned.has('dgn_korzul_flawless')).toBe(false);
  });

  it('dgn_nythraxis_deathless: a clean heroic kill grants; a death taint blocks', () => {
    const clean = makeSim();
    const c = encounterInstance(
      clean,
      'nythraxis_scourge_of_thornpeak',
      'nythraxis_boss_arena',
      'heroic',
      ['Tank'],
    );
    onMobKillCreditForDeeds(clean.ctx, c.boss, null, c.recipients[0], c.recipients);
    expect(c.recipients[0].deedsEarned.has('dgn_nythraxis_deathless')).toBe(true);

    const taint = makeSim();
    const t = encounterInstance(
      taint,
      'nythraxis_scourge_of_thornpeak',
      'nythraxis_boss_arena',
      'heroic',
      ['Tank'],
    );
    t.boss.threat.set(t.recipients[0].entityId, 100);
    onPlayerDeathForDeeds(taint.ctx, entityOf(taint, t.recipients[0]));
    onMobKillCreditForDeeds(taint.ctx, t.boss, null, t.recipients[0], t.recipients);
    expect(t.recipients[0].deedsEarned.has('dgn_nythraxis_deathless')).toBe(false);
  });

  it('dgn_nythraxis_deathless: the 260 yd room radius, not the instance band, bounds taint and credit', () => {
    // A raider parked in a side wing (arena walls reach local |x| 229) is a
    // full room member: their death must taint even though the generic 120 yd
    // band misses them.
    const taint = makeSim();
    const t = encounterInstance(
      taint,
      'nythraxis_scourge_of_thornpeak',
      'nythraxis_boss_arena',
      'heroic',
      ['Tank', 'Wing'],
    );
    const wing = entityOf(taint, t.recipients[1]);
    wing.pos = { x: wing.pos.x + 150, y: 0, z: wing.pos.z };
    t.boss.threat.set(t.recipients[1].entityId, 100); // engaged: window open
    onPlayerDeathForDeeds(taint.ctx, wing);
    onMobKillCreditForDeeds(taint.ctx, t.boss, null, t.recipients[0], t.recipients);
    expect(t.recipients[0].deedsEarned.has('dgn_nythraxis_deathless')).toBe(false);

    // On a clean kill the wing raider receives credit with everyone else,
    // while a player beyond the room radius neither taints nor receives.
    const clean = makeSim();
    const c = encounterInstance(
      clean,
      'nythraxis_scourge_of_thornpeak',
      'nythraxis_boss_arena',
      'heroic',
      ['Tank', 'Wing', 'Far'],
    );
    const cWing = entityOf(clean, c.recipients[1]);
    cWing.pos = { x: cWing.pos.x + 150, y: 0, z: cWing.pos.z };
    const far = entityOf(clean, c.recipients[2]);
    far.pos = { x: far.pos.x + 300, y: 0, z: far.pos.z };
    c.boss.threat.set(c.recipients[0].entityId, 100);
    onPlayerDeathForDeeds(clean.ctx, far); // outside the room: no taint
    onMobKillCreditForDeeds(clean.ctx, c.boss, null, c.recipients[0], c.recipients);
    expect(c.recipients[0].deedsEarned.has('dgn_nythraxis_deathless')).toBe(true);
    expect(c.recipients[1].deedsEarned.has('dgn_nythraxis_deathless')).toBe(true);
    expect(c.recipients[2].deedsEarned.has('dgn_nythraxis_deathless')).toBe(false);
  });

  it('dgn_nythraxis_deathless: the room circle never crosses into the adjacent arena slot', () => {
    // Arena slots sit 500 apart in z, so the raw 260 yd circle around this
    // slot's boss overlaps the next slot's territory. A raider who belongs to
    // the ADJACENT slot and stands at their own back wall is inside that raw
    // circle; they must neither taint this slot's attempt nor receive its
    // deeds.
    const sim = makeSim();
    const a = encounterInstance(
      sim,
      'nythraxis_scourge_of_thornpeak',
      'nythraxis_boss_arena',
      'heroic',
      ['Tank', 'Healer'],
    );
    const originB = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, 1);
    const neighbor = addMeta(sim, 'Neighbor');
    // Inside slot B's own band (245 < 250 from its origin) and inside slot
    // A's raw circle (500 - 245 = 255 <= 260 from A's boss spawn).
    entityOf(sim, neighbor).pos = { x: originB.x, y: 0, z: originB.z - 245 };

    a.boss.threat.set(a.recipients[0].entityId, 100); // engaged: window open
    onPlayerDeathForDeeds(sim.ctx, entityOf(sim, neighbor)); // must not taint slot A
    onMobKillCreditForDeeds(sim.ctx, a.boss, null, a.recipients[0], a.recipients);
    expect(a.recipients[0].deedsEarned.has('dgn_nythraxis_deathless')).toBe(true);
    expect(a.recipients[1].deedsEarned.has('dgn_nythraxis_deathless')).toBe(true);
    expect(neighbor.deedsEarned.has('dgn_nythraxis_deathless')).toBe(false);
  });

  it('dgn_morthen_trio: at most three participants grants; a fourth blocks', () => {
    const ok = makeSim();
    const boss = spawnMob(ok, 'morthen', { x: 5, y: 0, z: -5 });
    const three = ['A', 'B', 'C'].map((n) => addMeta(ok, n));
    for (const m of three) onDamageDealtForDeeds(ok.ctx, entityOf(ok, m), boss, 10, false, 'hit');
    onMobKillCreditForDeeds(ok.ctx, boss, null, three[0], three);
    for (const m of three) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(true);

    const over = makeSim();
    const boss2 = spawnMob(over, 'morthen', { x: 5, y: 0, z: -5 });
    const four = ['A', 'B', 'C', 'D'].map((n) => addMeta(over, n));
    for (const m of four)
      onDamageDealtForDeeds(over.ctx, entityOf(over, m), boss2, 10, false, 'hit');
    onMobKillCreditForDeeds(over.ctx, boss2, null, four[0], four);
    for (const m of four) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(false);
  });

  it('dgn_morthen_trio: the attempt roster is the union of damagers and the recipient envelope', () => {
    // Five players inside the instance with only three damaging still field a
    // five-player attempt: nobody earns the trio deed.
    const five = makeSim();
    const f = encounterInstance(five, 'morthen', 'hollow_crypt', 'normal', [
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
    for (const m of f.recipients.slice(0, 3)) {
      onDamageDealtForDeeds(five.ctx, entityOf(five, m), f.boss, 10, false, 'hit');
    }
    onMobKillCreditForDeeds(five.ctx, f.boss, null, f.recipients[0], f.recipients);
    for (const m of f.recipients) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(false);

    // A genuine trio with a present non-attacker (a dedicated healer) still
    // earns it for all three.
    const trio = makeSim();
    const t = encounterInstance(trio, 'morthen', 'hollow_crypt', 'normal', ['A', 'B', 'C']);
    for (const m of t.recipients.slice(0, 2)) {
      onDamageDealtForDeeds(trio.ctx, entityOf(trio, m), t.boss, 10, false, 'hit');
    }
    onMobKillCreditForDeeds(trio.ctx, t.boss, null, t.recipients[0], t.recipients);
    for (const m of t.recipients) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(true);

    // A fourth damager who leaves the recipient envelope before the kill
    // still counts against the cap: an envelope-only count would see three.
    const left = makeSim();
    const l = encounterInstance(left, 'morthen', 'hollow_crypt', 'normal', ['A', 'B', 'C']);
    const fourth = addMeta(left, 'D');
    const fourthEnt = entityOf(left, fourth);
    fourthEnt.pos = { ...entityOf(left, l.recipients[0]).pos };
    for (const m of [...l.recipients, fourth]) {
      onDamageDealtForDeeds(left.ctx, entityOf(left, m), l.boss, 10, false, 'hit');
    }
    fourthEnt.pos = { x: fourthEnt.pos.x + 500, y: 0, z: fourthEnt.pos.z };
    onMobKillCreditForDeeds(left.ctx, l.boss, null, l.recipients[0], l.recipients);
    for (const m of l.recipients) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(false);
  });

  it('dgn_morthen_trio: a heal-only member who dies inside the envelope and releases still counts', () => {
    // A four-player attempt whose heal-only member never damages the boss:
    // recording damagers alone would size the roster at three and wrongly grant
    // the trio deed. The death-scan arm folds the dying non-damager, inside the
    // engaged room, into the durable roster before the released spirit exits.
    const sim = makeSim();
    const s = encounterInstance(sim, 'morthen', 'hollow_crypt', 'normal', ['A', 'B', 'C']);
    for (const m of s.recipients) {
      onDamageDealtForDeeds(sim.ctx, entityOf(sim, m), s.boss, 10, false, 'hit');
    }
    // A heal-only fourth member, standing in the room while the boss is engaged.
    const healer = addMeta(sim, 'D');
    const healerEnt = entityOf(sim, healer);
    healerEnt.pos = { ...entityOf(sim, s.recipients[0]).pos };
    s.boss.threat.set(s.recipients[0].entityId, 100); // the attempt is live
    // The healer dies inside the envelope, then releases out of the instance.
    onPlayerDeathForDeeds(sim.ctx, healerEnt);
    healerEnt.pos = { x: healerEnt.pos.x + 500, y: 0, z: healerEnt.pos.z };
    onMobKillCreditForDeeds(sim.ctx, s.boss, null, s.recipients[0], s.recipients);
    for (const m of s.recipients) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(false);
  });

  it('dgn_morthen_trio: a heal-only member captured by the 1 Hz sweep counts even after leaving', () => {
    // The departed-non-damager hole: a healer generates threat, is folded into
    // the roster by the 1 Hz sweep, then walks out and drops off the hate table
    // before the kill. An envelope-only count would see three at the kill.
    const sim = makeSim();
    const s = encounterInstance(sim, 'morthen', 'hollow_crypt', 'normal', ['A', 'B', 'C']);
    for (const m of s.recipients) {
      onDamageDealtForDeeds(sim.ctx, entityOf(sim, m), s.boss, 10, false, 'hit');
    }
    const healer = addMeta(sim, 'D');
    s.boss.threat.set(healer.entityId, 50); // healing put the healer on the hate table
    sim.tickCount = 20; // cross a 1 Hz sweep boundary
    updateDeeds(sim.ctx);
    // The healer leaves and drops off the hate table before the boss falls.
    s.boss.threat.delete(healer.entityId);
    onMobKillCreditForDeeds(sim.ctx, s.boss, null, s.recipients[0], s.recipients);
    for (const m of s.recipients) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(false);
  });

  it('dgn_morthen_trio: a fourth member present only through their PET on the hate table counts', () => {
    // The sweep fold owner-resolves the threat table: a pet entry credits the
    // owning player, so a healer whose only hate-table presence is their pet
    // still lands in the roster and the trio restriction holds.
    const sim = makeSim();
    const s = encounterInstance(sim, 'morthen', 'hollow_crypt', 'normal', ['A', 'B', 'C']);
    for (const m of s.recipients) {
      onDamageDealtForDeeds(sim.ctx, entityOf(sim, m), s.boss, 10, false, 'hit');
    }
    const healer = addMeta(sim, 'D');
    const pet = spawnMob(sim, 'webwood_spider', { x: 6, y: 0, z: -6 });
    pet.ownerId = healer.entityId;
    s.boss.threat.set(pet.id, 50); // only the PET ever touched the hate table
    sim.tickCount = 20; // cross a 1 Hz sweep boundary
    updateDeeds(sim.ctx);
    s.boss.threat.delete(pet.id);
    onMobKillCreditForDeeds(sim.ctx, s.boss, null, s.recipients[0], s.recipients);
    for (const m of s.recipients) expect(m.deedsEarned.has('dgn_morthen_trio')).toBe(false);
  });

  it('dgn_vael_thralls: every summoned add dead grants; a live add blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'vael_the_mistcaller', { x: 5, y: 0, z: -5 });
    const deadAdd = spawnMob(clean, 'webwood_spider', { x: 6, y: 0, z: -6 });
    deadAdd.dead = true;
    onBossAddsSummonedForDeeds(clean.ctx, boss, [deadAdd.id]);
    const slayer = addMeta(clean, 'Slayer');
    onMobKillCreditForDeeds(clean.ctx, boss, null, slayer, [slayer]);
    expect(slayer.deedsEarned.has('dgn_vael_thralls')).toBe(true);

    const live = makeSim();
    const boss2 = spawnMob(live, 'vael_the_mistcaller', { x: 5, y: 0, z: -5 });
    const liveAdd = spawnMob(live, 'webwood_spider', { x: 6, y: 0, z: -6 }); // still alive
    onBossAddsSummonedForDeeds(live.ctx, boss2, [liveAdd.id]);
    const slayer2 = addMeta(live, 'Slayer');
    onMobKillCreditForDeeds(live.ctx, boss2, null, slayer2, [slayer2]);
    expect(slayer2.deedsEarned.has('dgn_vael_thralls')).toBe(false);
  });

  it('dgn_ysolei_moonspawn: every summoned add dead grants; a live add blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'ysolei', { x: 5, y: 0, z: -5 });
    const deadAdd = spawnMob(clean, 'webwood_spider', { x: 6, y: 0, z: -6 });
    deadAdd.dead = true;
    onBossAddsSummonedForDeeds(clean.ctx, boss, [deadAdd.id]);
    const slayer = addMeta(clean, 'Slayer');
    onMobKillCreditForDeeds(clean.ctx, boss, null, slayer, [slayer]);
    expect(slayer.deedsEarned.has('dgn_ysolei_moonspawn')).toBe(true);

    const live = makeSim();
    const boss2 = spawnMob(live, 'ysolei', { x: 5, y: 0, z: -5 });
    const liveAdd = spawnMob(live, 'webwood_spider', { x: 6, y: 0, z: -6 });
    onBossAddsSummonedForDeeds(live.ctx, boss2, [liveAdd.id]);
    const slayer2 = addMeta(live, 'Slayer');
    onMobKillCreditForDeeds(live.ctx, boss2, null, slayer2, [slayer2]);
    expect(slayer2.deedsEarned.has('dgn_ysolei_moonspawn')).toBe(false);
  });

  it('dgn_velkhar_bonewalkers: every summoned add dead grants; a live add blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'grand_necromancer_velkhar', { x: 5, y: 0, z: -5 });
    const deadAdd = spawnMob(clean, 'webwood_spider', { x: 6, y: 0, z: -6 });
    deadAdd.dead = true;
    onBossAddsSummonedForDeeds(clean.ctx, boss, [deadAdd.id]);
    const slayer = addMeta(clean, 'Slayer');
    onMobKillCreditForDeeds(clean.ctx, boss, null, slayer, [slayer]);
    expect(slayer.deedsEarned.has('dgn_velkhar_bonewalkers')).toBe(true);

    const live = makeSim();
    const boss2 = spawnMob(live, 'grand_necromancer_velkhar', { x: 5, y: 0, z: -5 });
    const liveAdd = spawnMob(live, 'webwood_spider', { x: 6, y: 0, z: -6 });
    onBossAddsSummonedForDeeds(live.ctx, boss2, [liveAdd.id]);
    const slayer2 = addMeta(live, 'Slayer');
    onMobKillCreditForDeeds(live.ctx, boss2, null, slayer2, [slayer2]);
    expect(slayer2.deedsEarned.has('dgn_velkhar_bonewalkers')).toBe(false);
  });

  it('dgn_olen_arc: a clean positioning attempt grants; a splash taint blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'knight_commander_olen', { x: 5, y: 0, z: -5 });
    const dancer = addMeta(clean, 'Dancer');
    onMobKillCreditForDeeds(clean.ctx, boss, null, dancer, [dancer]);
    expect(dancer.deedsEarned.has('dgn_olen_arc')).toBe(true);

    const taint = makeSim();
    const boss2 = spawnMob(taint, 'knight_commander_olen', { x: 5, y: 0, z: -5 });
    onBossSplashHitForDeeds(taint.ctx, boss2); // Reaping Arc caught a non-target
    const dancer2 = addMeta(taint, 'Dancer');
    onMobKillCreditForDeeds(taint.ctx, boss2, null, dancer2, [dancer2]);
    expect(dancer2.deedsEarned.has('dgn_olen_arc')).toBe(false);
  });

  it('dgn_nythraxis_gravebreaker: a clean arc grants; a splash taint blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'nythraxis_scourge_of_thornpeak', { x: 5, y: 0, z: -5 });
    const dancer = addMeta(clean, 'Dancer');
    onMobKillCreditForDeeds(clean.ctx, boss, null, dancer, [dancer]);
    expect(dancer.deedsEarned.has('dgn_nythraxis_gravebreaker')).toBe(true);

    const taint = makeSim();
    const boss2 = spawnMob(taint, 'nythraxis_scourge_of_thornpeak', { x: 5, y: 0, z: -5 });
    onBossSplashHitForDeeds(taint.ctx, boss2);
    const dancer2 = addMeta(taint, 'Dancer');
    onMobKillCreditForDeeds(taint.ctx, boss2, null, dancer2, [dancer2]);
    expect(dancer2.deedsEarned.has('dgn_nythraxis_gravebreaker')).toBe(false);
  });

  it('dlv_nhalia_bells: no bell contact grants; a bell taint blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'sister_nhalia_drowned_canticle', { x: 5, y: 0, z: -5 });
    const nimble = addMeta(clean, 'Nimble');
    onMobKillCreditForDeeds(clean.ctx, boss, null, nimble, [nimble]);
    expect(nimble.deedsEarned.has('dlv_nhalia_bells')).toBe(true);

    const taint = makeSim();
    const boss2 = spawnMob(taint, 'sister_nhalia_drowned_canticle', { x: 5, y: 0, z: -5 });
    onBellContactForDeeds(taint.ctx, boss2);
    const nimble2 = addMeta(taint, 'Nimble');
    onMobKillCreditForDeeds(taint.ctx, boss2, null, nimble2, [nimble2]);
    expect(nimble2.deedsEarned.has('dlv_nhalia_bells')).toBe(false);
  });

  it('dgn_nythraxis_wardens: an interrupted Deathless Rage grants; a resolved cast blocks', () => {
    const clean = makeSim();
    const boss = spawnMob(clean, 'nythraxis_scourge_of_thornpeak', { x: 5, y: 0, z: -5 });
    const warden = addMeta(clean, 'Warden');
    onMobKillCreditForDeeds(clean.ctx, boss, null, warden, [warden]);
    expect(warden.deedsEarned.has('dgn_nythraxis_wardens')).toBe(true);

    const resolved = makeSim();
    const boss2 = spawnMob(resolved, 'nythraxis_scourge_of_thornpeak', { x: 5, y: 0, z: -5 });
    onDeathlessRageResolvedForDeeds(resolved.ctx, boss2); // the cast went off
    const warden2 = addMeta(resolved, 'Warden');
    onMobKillCreditForDeeds(resolved.ctx, boss2, null, warden2, [warden2]);
    expect(warden2.deedsEarned.has('dgn_nythraxis_wardens')).toBe(false);
  });

  it('dgn_sanctum_speed: a kill inside the speed window grants; a slow kill blocks', () => {
    const fast = makeSim();
    fast.time = 100;
    const f = encounterInstance(fast, 'korzul_the_gravewyrm', 'gravewyrm_sanctum', 'normal', [
      'Racer',
    ]);
    f.inst.claimedAt = 0; // 100 - 0 = 100s, inside the 900s window
    onMobKillCreditForDeeds(fast.ctx, f.boss, null, f.recipients[0], f.recipients);
    expect(f.recipients[0].deedsEarned.has('dgn_sanctum_speed')).toBe(true);

    const slow = makeSim();
    slow.time = 1000;
    const s = encounterInstance(slow, 'korzul_the_gravewyrm', 'gravewyrm_sanctum', 'normal', [
      'Racer',
    ]);
    s.inst.claimedAt = 0; // 1000s, past the window
    onMobKillCreditForDeeds(slow.ctx, s.boss, null, s.recipients[0], s.recipients);
    expect(s.recipients[0].deedsEarned.has('dgn_sanctum_speed')).toBe(false);
  });

  it('world boss: every contributor earns cmb_thunzharr; only the unbroken survivor earns the record', () => {
    const sim = makeSim();
    const boss = spawnMob(sim, 'thunzharr_waking_peak', { x: 5, y: 0, z: -5 }, 30);
    const diver = addMeta(sim, 'Diver');
    const survivor = addMeta(sim, 'Survivor');
    boss.bossDamagers.add(diver.entityId);
    boss.bossDamagers.add(survivor.entityId);
    // The diver falls mid-fight while on the boss's damager roster.
    onPlayerDeathForDeeds(sim.ctx, entityOf(sim, diver));
    onWorldBossKilledForDeeds(sim.ctx, boss, [diver, survivor]);
    expect(diver.deedsEarned.has('cmb_thunzharr')).toBe(true);
    expect(survivor.deedsEarned.has('cmb_thunzharr')).toBe(true);
    expect(diver.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(false);
    expect(survivor.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(true);
  });

  it('cmb_thunzharr_unbroken: a relog after dying does not launder the death', () => {
    // The record keys on the stable character id, not the transient pid a relog
    // mints, so dying, relogging (new pid, same character), and re-hitting the
    // boss cannot earn the unbroken record.
    const sim = makeSim();
    const boss = spawnMob(sim, 'thunzharr_waking_peak', { x: 5, y: 0, z: -5 }, 30);
    const diverChar = 8801;
    const diverPid = sim.addPlayer('warrior', 'Diver', { characterId: diverChar });
    const diver = sim.players.get(diverPid)!;
    const survivor = sim.players.get(sim.addPlayer('warrior', 'Survivor', { characterId: 8802 }))!;
    boss.bossDamagers.add(diver.entityId);
    boss.bossDamagers.add(survivor.entityId);
    // The diver falls mid-fight while on the boss's damager roster.
    onPlayerDeathForDeeds(sim.ctx, entityOf(sim, diver));
    // Relog: the old entity leaves the world, the same character rejoins with a
    // fresh pid and re-hits the boss (rejoining the damager roster).
    sim.removePlayer(diverPid);
    const diver2 = sim.players.get(sim.addPlayer('warrior', 'Diver', { characterId: diverChar }))!;
    boss.bossDamagers.add(diver2.entityId);
    onWorldBossKilledForDeeds(sim.ctx, boss, [diver2, survivor]);
    expect(diver2.deedsEarned.has('cmb_thunzharr')).toBe(true);
    // The relog did not launder the death: the record stays unearned.
    expect(diver2.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(false);
    // A distinct character who never died still earns it on the same kill.
    expect(survivor.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(true);
  });

  it('cmb_thunzharr_unbroken: a heal-only contributor who dies keeps the kill but loses the record', () => {
    // Regression: a heal-only contributor lands no damage, so is absent from
    // bossDamagers; their only proof of engagement is the live hate table. The
    // death taint must be recorded from that pre-death threat, which means the
    // death hook must run BEFORE handleDeath clears the dying player off threat.
    const sim = makeSim();
    const boss = spawnMob(sim, 'thunzharr_waking_peak', { x: 5, y: 0, z: -5 }, 30);
    boss.hostile = true;
    boss.inCombat = true;
    const healer = sim.players.get(sim.addPlayer('warrior', 'Healer', { characterId: 9001 }))!;
    const damager = sim.players.get(sim.addPlayer('warrior', 'Damager', { characterId: 9002 }))!;
    // Heal-only: threat but never a damage hit. The damager is on the roster.
    boss.threat.set(healer.entityId, 30);
    boss.bossDamagers.add(damager.entityId);
    // The boss kills the heal-only healer mid-fight (the real death path).
    handleDeath(sim.ctx, entityOf(sim, healer), boss);
    expect(boss.threat.has(healer.entityId)).toBe(false); // handleDeath cleared threat
    // The healer resurrects and heals again, rejoining the boss's hate table so
    // they are still a loot contributor when it finally falls.
    entityOf(sim, healer).dead = false;
    boss.threat.set(healer.entityId, 20);
    onWorldBossKilledForDeeds(sim.ctx, boss, [healer, damager]);
    expect(healer.deedsEarned.has('cmb_thunzharr')).toBe(true);
    expect(healer.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(false);
    // A never-died damager on the same kill still earns the record.
    expect(damager.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(true);
  });

  it('cmb_thunzharr_unbroken: a returning healer who lands one hit after dying still loses it', () => {
    // Even after the healer re-enters the fight and deals damage (joining
    // bossDamagers), the character-keyed death taint already stands.
    const sim = makeSim();
    const boss = spawnMob(sim, 'thunzharr_waking_peak', { x: 5, y: 0, z: -5 }, 30);
    boss.hostile = true;
    boss.inCombat = true;
    const healer = sim.players.get(sim.addPlayer('warrior', 'Healer', { characterId: 9101 }))!;
    boss.threat.set(healer.entityId, 30); // heal-only when they die
    handleDeath(sim.ctx, entityOf(sim, healer), boss);
    entityOf(sim, healer).dead = false;
    boss.bossDamagers.add(healer.entityId); // returns and lands a melee hit
    onWorldBossKilledForDeeds(sim.ctx, boss, [healer]);
    expect(healer.deedsEarned.has('cmb_thunzharr')).toBe(true);
    expect(healer.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(false);
  });

  it('cmb_thunzharr_unbroken: a damager dying through the real death path taints same-tick', () => {
    // Guards the reorder for the ordinary damager arm: routing the death through
    // handleDeath (not the direct hook) still records the taint before the kill.
    const sim = makeSim();
    const boss = spawnMob(sim, 'thunzharr_waking_peak', { x: 5, y: 0, z: -5 }, 30);
    boss.hostile = true;
    boss.inCombat = true;
    const diver = sim.players.get(sim.addPlayer('warrior', 'Diver', { characterId: 9201 }))!;
    boss.bossDamagers.add(diver.entityId);
    boss.threat.set(diver.entityId, 40);
    handleDeath(sim.ctx, entityOf(sim, diver), boss);
    onWorldBossKilledForDeeds(sim.ctx, boss, [diver]);
    expect(diver.deedsEarned.has('cmb_thunzharr')).toBe(true);
    expect(diver.deedsEarned.has('cmb_thunzharr_unbroken')).toBe(false);
  });
});

describe('Vale Cup sites', () => {
  it('chr_vale_cup_debut: a queued bout and a non-bot toucher grants; practice and bots block', () => {
    const sim = makeSim();
    const striker = addMeta(sim, 'Striker');
    // Practice bout: never counts.
    onCupTouchForDeeds(
      sim.ctx,
      cupMatch({ id: 1, teamA: [striker.entityId], practice: {} }),
      striker.entityId,
    );
    expect(striker.deedsEarned.has('chr_vale_cup_debut')).toBe(false);
    // Queued bout, but the toucher is a backfill bot: skipped.
    const bot = addMeta(sim, 'Bot');
    sim.ctx.vcup.botPids.push(bot.entityId);
    onCupTouchForDeeds(sim.ctx, cupMatch({ id: 2, teamA: [bot.entityId] }), bot.entityId);
    expect(bot.deedsEarned.has('chr_vale_cup_debut')).toBe(false);
    // Queued bout, human toucher: debut. (The queued gate reads practice, not rated,
    // so even an unrated bot-backfilled bout counts for a human's debut.)
    onCupTouchForDeeds(
      sim.ctx,
      cupMatch({ id: 3, rated: false, teamA: [striker.entityId] }),
      striker.entityId,
    );
    expect(striker.deedsEarned.has('chr_vale_cup_debut')).toBe(true);
  });

  it('pvp_vcup_first_match: needs a personal touch, a seat, and a queued bout', () => {
    const sim = makeSim();
    const seated = addMeta(sim, 'Starter');
    const untouched = addMeta(sim, 'Idle');
    const benched = addMeta(sim, 'Sub');
    const queued = cupMatch({
      id: 1,
      teamA: [seated.entityId, untouched.entityId, benched.entityId],
      benched: new Set([benched.entityId]),
    });
    onCupTouchForDeeds(sim.ctx, queued, seated.entityId);
    onCupTouchForDeeds(sim.ctx, queued, benched.entityId); // benched can still touch, stays ineligible
    // untouched never touches the ball.
    onCupMatchEndForDeeds(sim.ctx, queued);
    expect(seated.deedsEarned.has('pvp_vcup_first_match')).toBe(true);
    expect(untouched.deedsEarned.has('pvp_vcup_first_match')).toBe(false);
    expect(benched.deedsEarned.has('pvp_vcup_first_match')).toBe(false);

    // A practice bout never counts even for a seated toucher.
    const prac = makeSim();
    const toucher = addMeta(prac, 'Practicer');
    const practice = cupMatch({ id: 2, teamA: [toucher.entityId], practice: {} });
    onCupTouchForDeeds(prac.ctx, practice, toucher.entityId);
    onCupMatchEndForDeeds(prac.ctx, practice);
    expect(toucher.deedsEarned.has('pvp_vcup_first_match')).toBe(false);
  });

  it('onCupGoalForDeeds: gates goals on rating and a real scorer, and stacks golden', () => {
    // Unrated bout: no goal credit.
    const unrated = makeSim();
    const u = addMeta(unrated, 'Scorer');
    onCupGoalForDeeds(
      unrated.ctx,
      cupMatch({ id: 1, rated: false, teamA: [u.entityId] }),
      'A',
      u.entityId,
    );
    expect(u.deedsEarned.has('pvp_vcup_first_goal')).toBe(false);

    // Own goal (null scorer): credits nobody.
    const own = makeSim();
    const o = addMeta(own, 'Scorer');
    onCupGoalForDeeds(own.ctx, cupMatch({ id: 1, rated: true, teamA: [o.entityId] }), 'A', null);
    expect(o.deedsEarned.has('pvp_vcup_first_goal')).toBe(false);

    // Rated golden goal: first goal AND golden goal.
    const golden = makeSim();
    const g = addMeta(golden, 'Scorer');
    onCupGoalForDeeds(
      golden.ctx,
      cupMatch({ id: 1, rated: true, golden: true, teamA: [g.entityId] }),
      'A',
      g.entityId,
    );
    expect(g.deedsEarned.has('pvp_vcup_first_goal')).toBe(true);
    expect(g.deedsEarned.has('pvp_vcup_golden_goal')).toBe(true);

    // A non-golden rated goal never earns the golden deed.
    const plain = makeSim();
    const p = addMeta(plain, 'Scorer');
    onCupGoalForDeeds(
      plain.ctx,
      cupMatch({ id: 1, rated: true, golden: false, teamA: [p.entityId] }),
      'A',
      p.entityId,
    );
    expect(p.deedsEarned.has('pvp_vcup_first_goal')).toBe(true);
    expect(p.deedsEarned.has('pvp_vcup_golden_goal')).toBe(false);
  });

  it('pvp_vcup_hat_trick: three goals in a bracket-3+ bout; bracket 2 and two goals fall short', () => {
    // Bracket 2: three goals never make a hat trick.
    const low = makeSim();
    const l = addMeta(low, 'Hatless');
    const lowMatch = cupMatch({ id: 1, rated: true, bracket: 2, teamA: [l.entityId] });
    for (let i = 0; i < 3; i++) onCupGoalForDeeds(low.ctx, lowMatch, 'A', l.entityId);
    expect(l.deedsEarned.has('pvp_vcup_hat_trick')).toBe(false);

    // Bracket 3: two goals short, the third completes it.
    const hi = makeSim();
    const h = addMeta(hi, 'Hatful');
    const hiMatch = cupMatch({ id: 1, rated: true, bracket: 3, teamA: [h.entityId] });
    onCupGoalForDeeds(hi.ctx, hiMatch, 'A', h.entityId);
    onCupGoalForDeeds(hi.ctx, hiMatch, 'A', h.entityId);
    expect(h.deedsEarned.has('pvp_vcup_hat_trick')).toBe(false);
    onCupGoalForDeeds(hi.ctx, hiMatch, 'A', h.entityId);
    expect(h.deedsEarned.has('pvp_vcup_hat_trick')).toBe(true);
  });

  it('pvp_vcup_first_save: fires only in a rated bout', () => {
    const sim = makeSim();
    const keeper = addMeta(sim, 'Keeper');
    onCupSaveForDeeds(
      sim.ctx,
      cupMatch({ id: 1, rated: false, teamA: [keeper.entityId] }),
      keeper.entityId,
    );
    expect(keeper.deedsEarned.has('pvp_vcup_first_save')).toBe(false);
    onCupSaveForDeeds(
      sim.ctx,
      cupMatch({ id: 1, rated: true, teamA: [keeper.entityId] }),
      keeper.entityId,
    );
    expect(keeper.deedsEarned.has('pvp_vcup_first_save')).toBe(true);
  });

  it('pvp_vcup_clean_sheet: a winning, seated keeper who conceded nothing; each field flips it off', () => {
    const sheet = (meta: PlayerMeta, over: Partial<CupMatchForDeeds>): CupMatchForDeeds =>
      cupMatch({
        id: 1,
        teamA: [meta.entityId],
        roles: { [meta.entityId]: 'keeper' },
        scoreA: 3,
        scoreB: 0,
        ...over,
      });

    // Loser: winner !== team.
    const loseSim = makeSim();
    const lose = addMeta(loseSim, 'Keeper');
    onCupStandingForDeeds(loseSim.ctx, sheet(lose, {}), lose.entityId, 'A', 'B');
    expect(lose.deedsEarned.has('pvp_vcup_clean_sheet')).toBe(false);

    // Not a keeper.
    const roleSim = makeSim();
    const outfield = addMeta(roleSim, 'Striker');
    onCupStandingForDeeds(
      roleSim.ctx,
      sheet(outfield, { roles: { [outfield.entityId]: 'striker' } }),
      outfield.entityId,
      'A',
      'A',
    );
    expect(outfield.deedsEarned.has('pvp_vcup_clean_sheet')).toBe(false);

    // Benched keeper.
    const benchSim = makeSim();
    const bench = addMeta(benchSim, 'Keeper');
    onCupStandingForDeeds(
      benchSim.ctx,
      sheet(bench, { benched: new Set([bench.entityId]) }),
      bench.entityId,
      'A',
      'A',
    );
    expect(bench.deedsEarned.has('pvp_vcup_clean_sheet')).toBe(false);

    // Conceded a goal: opposing score != 0.
    const concedeSim = makeSim();
    const concede = addMeta(concedeSim, 'Keeper');
    onCupStandingForDeeds(
      concedeSim.ctx,
      sheet(concede, { scoreB: 1 }),
      concede.entityId,
      'A',
      'A',
    );
    expect(concede.deedsEarned.has('pvp_vcup_clean_sheet')).toBe(false);

    // All four satisfied: clean sheet.
    const winSim = makeSim();
    const win = addMeta(winSim, 'Keeper');
    onCupStandingForDeeds(winSim.ctx, sheet(win, {}), win.entityId, 'A', 'A');
    expect(win.deedsEarned.has('pvp_vcup_clean_sheet')).toBe(true);
  });
});

describe('Fiesta sites', () => {
  it('onArenaMatchEndForDeeds: awards the fiesta bout, win, and full-build tiers', () => {
    const sim = makeSim();
    const winner = addMeta(sim, 'Champ');
    const loser = addMeta(sim, 'Runner');
    winner.fiestaAugments = ['a', 'b', 'c']; // one pick per wave, three waves
    onArenaMatchEndForDeeds(
      sim.ctx,
      fiestaMatch(sim, [winner.entityId], [loser.entityId]),
      'A',
      true,
    );
    expect(winner.deedsEarned.has('pvp_fiesta_first_bout')).toBe(true);
    expect(loser.deedsEarned.has('pvp_fiesta_first_bout')).toBe(true);
    expect(winner.deedsEarned.has('pvp_fiesta_first_win')).toBe(true);
    expect(loser.deedsEarned.has('pvp_fiesta_first_win')).toBe(false);
    expect(winner.deedsEarned.has('pvp_fiesta_full_build')).toBe(true);

    // A winner one pick short earns the win but not the full build.
    const short = makeSim();
    const w2 = addMeta(short, 'Champ');
    const l2 = addMeta(short, 'Runner');
    w2.fiestaAugments = ['a', 'b'];
    onArenaMatchEndForDeeds(short.ctx, fiestaMatch(short, [w2.entityId], [l2.entityId]), 'A', true);
    expect(w2.deedsEarned.has('pvp_fiesta_first_win')).toBe(true);
    expect(w2.deedsEarned.has('pvp_fiesta_full_build')).toBe(false);
  });

  it('a forfeit-ended bout grants the full-bout deed to nobody but keeps the win family', () => {
    const sim = makeSim();
    const winner = addMeta(sim, 'Champ');
    const loser = addMeta(sim, 'Quitter');
    winner.fiestaAugments = ['a', 'b', 'c'];
    onArenaMatchEndForDeeds(
      sim.ctx,
      fiestaMatch(sim, [winner.entityId], [loser.entityId]),
      'A',
      false,
    );
    // The bout never ran to completion: no one fought a full bout.
    expect(winner.deedsEarned.has('pvp_fiesta_first_bout')).toBe(false);
    expect(loser.deedsEarned.has('pvp_fiesta_first_bout')).toBe(false);
    // The win family still counts (mirrors the ranked ladder on forfeits).
    expect(winner.deedsEarned.has('pvp_fiesta_first_win')).toBe(true);
    expect(winner.deedsEarned.has('pvp_fiesta_full_build')).toBe(true);
    expect(loser.deedsEarned.has('pvp_fiesta_first_win')).toBe(false);

    // A forfeit winner one pick short keeps the win but not the full build.
    const short = makeSim();
    const w2 = addMeta(short, 'Champ');
    const l2 = addMeta(short, 'Quitter');
    w2.fiestaAugments = ['a', 'b'];
    onArenaMatchEndForDeeds(
      short.ctx,
      fiestaMatch(short, [w2.entityId], [l2.entityId]),
      'A',
      false,
    );
    expect(w2.deedsEarned.has('pvp_fiesta_first_win')).toBe(true);
    expect(w2.deedsEarned.has('pvp_fiesta_full_build')).toBe(false);
  });

  it('endArenaMatch drives the forfeit-vs-completed-bout distinction end to end', () => {
    // The helper cases above pin onArenaMatchEndForDeeds directly; this drives the
    // REAL endArenaMatch so the reason -> completedBout wiring (arena.ts: the fourth
    // argument is reason !== 'forfeit') is exercised end to end. A forfeit reaches the
    // helper with completedBout false: nobody fought a full bout, but the winner still
    // banks the win family.
    const forfeit = makeSim();
    const winner = addMeta(forfeit, 'Champ');
    const loser = addMeta(forfeit, 'Quitter');
    endArenaMatch(
      forfeit.ctx,
      fiestaMatch(forfeit, [winner.entityId], [loser.entityId]),
      'A',
      'forfeit',
    );
    expect(winner.deedsEarned.has('pvp_fiesta_first_bout')).toBe(false);
    expect(loser.deedsEarned.has('pvp_fiesta_first_bout')).toBe(false);
    expect(winner.deedsEarned.has('pvp_fiesta_first_win')).toBe(true);

    // A timeout is a completed bout (it ran its full clock): both fighters bank the
    // full-bout deed. Hardcoding the fourth argument to a constant true would grant it
    // on the forfeit arm above; a constant false would drop it here.
    const timeout = makeSim();
    const w2 = addMeta(timeout, 'Champ');
    const l2 = addMeta(timeout, 'Runner');
    endArenaMatch(timeout.ctx, fiestaMatch(timeout, [w2.entityId], [l2.entityId]), 'A', 'timeout');
    expect(w2.deedsEarned.has('pvp_fiesta_first_bout')).toBe(true);
    expect(l2.deedsEarned.has('pvp_fiesta_first_bout')).toBe(true);
    expect(w2.deedsEarned.has('pvp_fiesta_first_win')).toBe(true);
  });

  it('a ranked forfeit still grants the first-match deed', () => {
    const sim = makeSim();
    const stayer = addMeta(sim, 'Stayer');
    const quitter = addMeta(sim, 'Quitter');
    const match: ArenaMatch = {
      id: 1,
      format: '1v1',
      teamA: [stayer.entityId],
      teamB: [quitter.entityId],
      slot: 0,
      state: 'active',
      timer: 0,
      returns: new Map(),
      ratingA: 1500,
      ratingB: 1500,
      defeated: new Set(),
    };
    onArenaMatchEndForDeeds(sim.ctx, match, 'A', false);
    expect(stayer.deedsEarned.has('pvp_arena_first_match')).toBe(true);
    expect(quitter.deedsEarned.has('pvp_arena_first_match')).toBe(true);
  });

  it('a bot-seated bout blocks all fiesta end-of-bout credit', () => {
    const sim = makeSim();
    const human = addMeta(sim, 'Human');
    const bot = addMeta(sim, 'Bot');
    sim.ctx.fiestaBotPids.push(bot.entityId);
    onArenaMatchEndForDeeds(sim.ctx, fiestaMatch(sim, [human.entityId], [bot.entityId]), 'A', true);
    expect(human.deedsEarned.has('pvp_fiesta_first_bout')).toBe(false);
    expect(human.deedsEarned.has('pvp_fiesta_first_win')).toBe(false);
  });

  it('pvp_fiesta_double: needs a rapid takedown', () => {
    const sim = makeSim();
    const killer = addMeta(sim, 'Ender');
    const victim = addMeta(sim, 'Fed');
    const match = fiestaMatch(sim, [killer.entityId], [victim.entityId]);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: false,
      victimStreak: 0,
      killerKills: 0,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_double')).toBe(false);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: true,
      victimStreak: 0,
      killerKills: 0,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_double')).toBe(true);
  });

  it('pvp_fiesta_shutdown: needs a victim streak of at least three', () => {
    const sim = makeSim();
    const killer = addMeta(sim, 'Ender');
    const victim = addMeta(sim, 'Fed');
    const match = fiestaMatch(sim, [killer.entityId], [victim.entityId]);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: false,
      victimStreak: 2,
      killerKills: 0,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_shutdown')).toBe(false);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: false,
      victimStreak: 3,
      killerKills: 0,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_shutdown')).toBe(true);
  });

  it('pvp_fiesta_five_kills: needs at least five kills in the bout', () => {
    const sim = makeSim();
    const killer = addMeta(sim, 'Ender');
    const victim = addMeta(sim, 'Fed');
    const match = fiestaMatch(sim, [killer.entityId], [victim.entityId]);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: false,
      victimStreak: 0,
      killerKills: 4,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_five_kills')).toBe(false);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: false,
      victimStreak: 0,
      killerKills: 5,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_five_kills')).toBe(true);
  });

  it('a bot-seated bout blocks all fiesta takedown credit', () => {
    const sim = makeSim();
    const killer = addMeta(sim, 'Ender');
    const bot = addMeta(sim, 'Bot');
    sim.ctx.fiestaBotPids.push(bot.entityId);
    const match = fiestaMatch(sim, [killer.entityId], [bot.entityId]);
    onFiestaTakedownForDeeds(sim.ctx, match, killer.entityId, {
      rapid: true,
      victimStreak: 3,
      killerKills: 5,
    });
    expect(killer.deedsEarned.has('pvp_fiesta_double')).toBe(false);
    expect(killer.deedsEarned.has('pvp_fiesta_shutdown')).toBe(false);
    expect(killer.deedsEarned.has('pvp_fiesta_five_kills')).toBe(false);
  });
});

describe('hidden, delve, and chronicle simple sites', () => {
  it('hid_keepers_toll_twice: needs the resurrection-sickness aura at death', () => {
    const sim = makeSim();
    const clean = addMeta(sim, 'Fresh');
    onPlayerDeathForDeeds(sim.ctx, entityOf(sim, clean));
    expect(clean.deedsEarned.has('hid_keepers_toll_twice')).toBe(false);

    const sick = addMeta(sim, 'Sick');
    applyResurrectionSickness(sim.ctx, entityOf(sim, sick), 600);
    onPlayerDeathForDeeds(sim.ctx, entityOf(sim, sick));
    expect(sick.deedsEarned.has('hid_keepers_toll_twice')).toBe(true);
  });

  it('hid_roll_hundred: fires only on a 1..100 roll landing exactly 100', () => {
    const sim = makeSim();
    const roller = addMeta(sim, 'Roller');
    onChatRollForDeeds(sim.ctx, roller.entityId, 2, 100, 100); // lo != 1
    onChatRollForDeeds(sim.ctx, roller.entityId, 1, 99, 100); // hi != 100
    onChatRollForDeeds(sim.ctx, roller.entityId, 1, 100, 99); // result != 100
    expect(roller.deedsEarned.has('hid_roll_hundred')).toBe(false);
    onChatRollForDeeds(sim.ctx, roller.entityId, 1, 100, 100);
    expect(roller.deedsEarned.has('hid_roll_hundred')).toBe(true);
  });

  it('hid_yumi_cheer: needs a living Yumi inside the cheer range', () => {
    const sim = makeSim();
    const fan = addMeta(sim, 'Fan');
    const e = entityOf(sim, fan);
    e.pos = { x: 0, y: 0, z: 0 };
    spawnMob(sim, 'yumi_cat', { x: 10, y: 0, z: 0 }, 20); // ten yards away
    onCheerForDeeds(sim.ctx, fan, e, 'yumi_cat', 5); // range 5 < 10
    expect(fan.deedsEarned.has('hid_yumi_cheer')).toBe(false);
    onCheerForDeeds(sim.ctx, fan, e, 'yumi_cat', 15); // range 15 >= 10
    expect(fan.deedsEarned.has('hid_yumi_cheer')).toBe(true);
  });

  it('onLockpickSuccessForDeeds: the premium ante and the coffer flag gate independently', () => {
    const both = makeSim();
    const p = addMeta(both, 'Picker');
    onLockpickSuccessForDeeds(both.ctx, p.entityId, 0, false); // no premium, no coffer
    expect(p.deedsEarned.has('dlv_tumbler_premium')).toBe(false);
    expect(p.deedsEarned.has('hid_bountiful_coffer')).toBe(false);
    onLockpickSuccessForDeeds(both.ctx, p.entityId, 1, true);
    expect(p.deedsEarned.has('dlv_tumbler_premium')).toBe(true);
    expect(p.deedsEarned.has('hid_bountiful_coffer')).toBe(true);

    // A premium ante on a non-coffer lock earns only the ante deed.
    const anteOnly = makeSim();
    const q = addMeta(anteOnly, 'Picker');
    onLockpickSuccessForDeeds(anteOnly.ctx, q.entityId, 1, false);
    expect(q.deedsEarned.has('dlv_tumbler_premium')).toBe(true);
    expect(q.deedsEarned.has('hid_bountiful_coffer')).toBe(false);
  });

  it('dlv_rite_flawless: requires a mistake-free rite finale', () => {
    const sim = makeSim();
    const cantor = addMeta(sim, 'Cantor');
    onRiteFinaleForDeeds(sim.ctx, cantor.entityId, 1); // one mistake
    expect(cantor.deedsEarned.has('dlv_rite_flawless')).toBe(false);
    onRiteFinaleForDeeds(sim.ctx, cantor.entityId, 0);
    expect(cantor.deedsEarned.has('dlv_rite_flawless')).toBe(true);
  });

  it('dlv_solo_heroic: needs a heroic tier AND a solo party watermark', () => {
    const sim = makeSim();
    const grouped = addMeta(sim, 'Grouped');
    onDelveClearForDeeds(sim.ctx, grouped, { tierId: 'heroic', deedMaxParty: 2 }); // grouped
    expect(grouped.deedsEarned.has('dlv_solo_heroic')).toBe(false);

    const normal = addMeta(sim, 'Normal');
    onDelveClearForDeeds(sim.ctx, normal, { tierId: 'normal', deedMaxParty: 1 }); // not heroic
    expect(normal.deedsEarned.has('dlv_solo_heroic')).toBe(false);

    const solo = addMeta(sim, 'Solo');
    onDelveClearForDeeds(sim.ctx, solo, { tierId: 'heroic', deedMaxParty: 1 });
    expect(solo.deedsEarned.has('dlv_solo_heroic')).toBe(true);
  });

  it('hid_companion_save: grants the save to a real owner, and is a no-op for an unknown pid', () => {
    const sim = makeSim();
    const saved = addMeta(sim, 'Saved');
    onCompanionReviveForDeeds(sim.ctx, 999999); // unknown pid: no meta, no throw, no grant
    onCompanionReviveForDeeds(sim.ctx, saved.entityId);
    expect(saved.deedsEarned.has('hid_companion_save')).toBe(true);
  });

  it('chr_marsh_hush_the_mending: needs a warded cultist inside the mending radius', () => {
    // A cultist beyond the 14 yd Grave Mending radius does not count.
    const far = makeSim();
    const killerFar = addMeta(far, 'Reaper');
    const menderFar = spawnMob(far, 'gravecaller_mender', { x: 0, y: 0, z: 0 }, 3);
    spawnMob(far, 'gravecaller_cultist', { x: 20, y: 0, z: 0 }, 3);
    onMobKillCreditForDeeds(far.ctx, menderFar, entityOf(far, killerFar), killerFar, [killerFar]);
    expect(killerFar.deedsEarned.has('chr_marsh_hush_the_mending')).toBe(false);

    // A cultist inside the radius grants.
    const near = makeSim();
    const killerNear = addMeta(near, 'Reaper');
    const menderNear = spawnMob(near, 'gravecaller_mender', { x: 0, y: 0, z: 0 }, 3);
    spawnMob(near, 'gravecaller_cultist', { x: 6, y: 0, z: 0 }, 3);
    onMobKillCreditForDeeds(near.ctx, menderNear, entityOf(near, killerNear), killerNear, [
      killerNear,
    ]);
    expect(killerNear.deedsEarned.has('chr_marsh_hush_the_mending')).toBe(true);
  });

  it('chr_marsh_hush_the_mending: killing a tended cultist first taints the mender', () => {
    // The deed is an ORDER requirement: slay the mender BEFORE any cultist it
    // tends. Felling a cultist inside the radius first must block a later kill of
    // that mender even though another warded cultist still lives.
    const sim = makeSim();
    const killer = addMeta(sim, 'Reaper');
    const mender = spawnMob(sim, 'gravecaller_mender', { x: 0, y: 0, z: 0 }, 3);
    const cultist1 = spawnMob(sim, 'gravecaller_cultist', { x: 5, y: 0, z: 0 }, 3);
    spawnMob(sim, 'gravecaller_cultist', { x: -5, y: 0, z: 0 }, 3); // still alive at the mender kill
    cultist1.dead = true; // the credited kill sets this before the deed hook runs
    onMobKillCreditForDeeds(sim.ctx, cultist1, entityOf(sim, killer), killer, [killer]);
    onMobKillCreditForDeeds(sim.ctx, mender, entityOf(sim, killer), killer, [killer]);
    expect(killer.deedsEarned.has('chr_marsh_hush_the_mending')).toBe(false);
  });

  it('chr_marsh_hush_the_mending: killing the mender first with both cultists alive grants', () => {
    const sim = makeSim();
    const killer = addMeta(sim, 'Reaper');
    const mender = spawnMob(sim, 'gravecaller_mender', { x: 0, y: 0, z: 0 }, 3);
    spawnMob(sim, 'gravecaller_cultist', { x: 5, y: 0, z: 0 }, 3);
    spawnMob(sim, 'gravecaller_cultist', { x: -5, y: 0, z: 0 }, 3);
    onMobKillCreditForDeeds(sim.ctx, mender, entityOf(sim, killer), killer, [killer]);
    expect(killer.deedsEarned.has('chr_marsh_hush_the_mending')).toBe(true);
  });

  it('chr_marsh_hush_the_mending: a cultist slain OUTSIDE the radius is no false taint', () => {
    const sim = makeSim();
    const killer = addMeta(sim, 'Reaper');
    const mender = spawnMob(sim, 'gravecaller_mender', { x: 0, y: 0, z: 0 }, 3);
    const farCultist = spawnMob(sim, 'gravecaller_cultist', { x: 40, y: 0, z: 0 }, 3);
    spawnMob(sim, 'gravecaller_cultist', { x: 6, y: 0, z: 0 }, 3); // in-radius, alive
    farCultist.dead = true;
    onMobKillCreditForDeeds(sim.ctx, farCultist, entityOf(sim, killer), killer, [killer]);
    onMobKillCreditForDeeds(sim.ctx, mender, entityOf(sim, killer), killer, [killer]);
    expect(killer.deedsEarned.has('chr_marsh_hush_the_mending')).toBe(true);
  });

  it('chr_marsh_hush_the_mending: an in-place respawn clears the taint an uncredited death left', () => {
    // A tainted mender that dies UNCREDITED (untapped, no player killer) never
    // reaches the credited-kill taint consumption, and respawnMob REUSES the
    // entity id, so without the respawn-time clear the fresh spawn would deny
    // a clean mender-first kill forever.
    const sim = makeSim();
    const killer = addMeta(sim, 'Reaper');
    const mender = spawnMob(sim, 'gravecaller_mender', { x: 0, y: 0, z: 0 }, 3);
    const cultist1 = spawnMob(sim, 'gravecaller_cultist', { x: 5, y: 0, z: 0 }, 3);
    spawnMob(sim, 'gravecaller_cultist', { x: -5, y: 0, z: 0 }, 3); // alive across both mender lives
    cultist1.dead = true; // the credited kill sets this before the deed hook runs
    onMobKillCreditForDeeds(sim.ctx, cultist1, entityOf(sim, killer), killer, [killer]); // taints the mender
    // Uncredited death: no tap, no player killer, so handleDeath never reaches
    // the credited block and the taint is not consumed.
    handleDeath(sim.ctx, mender, null);
    respawnMob(sim.ctx, mender);
    expect(mender.dead).toBe(false); // the same entity id lives again
    // A clean mender-first kill of the fresh spawn (a warded cultist still
    // lives in radius) must grant: the respawn dropped the stale taint.
    onMobKillCreditForDeeds(sim.ctx, mender, entityOf(sim, killer), killer, [killer]);
    expect(killer.deedsEarned.has('chr_marsh_hush_the_mending')).toBe(true);
  });

  it('hid_saul_footnote: nine consecutive Saul talks grant; another NPC mid-streak resets', () => {
    const streak = makeSim();
    const scholar = addMeta(streak, 'Scholar');
    for (let i = 0; i < 9; i++) onNpcTalkedForDeeds(streak.ctx, scholar, 'chronicler_saul');
    expect(scholar.deedsEarned.has('hid_saul_footnote')).toBe(true);

    // Eight Saul talks, a different NPC, then eight more Saul talks: never nine in a row.
    const reset = makeSim();
    const q = addMeta(reset, 'Scholar');
    for (let i = 0; i < 8; i++) onNpcTalkedForDeeds(reset.ctx, q, 'chronicler_saul');
    onNpcTalkedForDeeds(reset.ctx, q, 'the_merchant'); // resets the consecutive counter
    for (let i = 0; i < 8; i++) onNpcTalkedForDeeds(reset.ctx, q, 'chronicler_saul');
    expect(q.deedsEarned.has('hid_saul_footnote')).toBe(false);
  });

  it('chr_marsh_unburst: onBloatDetonatedForDeeds counts only blast-clean kills', () => {
    const sim = makeSim();
    const popper = addMeta(sim, 'Popper');
    // A blast that damaged the credited player is not a clean kill.
    const corpse = spawnMob(sim, 'bog_bloat', { x: 0, y: 0, z: 0 });
    onMobKillCreditForDeeds(sim.ctx, corpse, null, popper, [popper]); // arms the pending credit
    onBloatDetonatedForDeeds(sim.ctx, corpse, [popper.entityId]);
    expect(popper.deedStats.counters.bloatCleanKills).toBe(0);
    // A blast that harmed nobody is a clean kill.
    const corpse2 = spawnMob(sim, 'bog_bloat', { x: 0, y: 0, z: 0 });
    onMobKillCreditForDeeds(sim.ctx, corpse2, null, popper, [popper]);
    onBloatDetonatedForDeeds(sim.ctx, corpse2, []);
    expect(popper.deedStats.counters.bloatCleanKills).toBe(1);
  });

  it('chr_marsh_unburst: unlocks at eight clean bog_bloat kills, not seven', () => {
    const sim = makeSim();
    const marsh = addMeta(sim, 'Marsh');
    const cleanKill = (): void => {
      const corpse = spawnMob(sim, 'bog_bloat', { x: 0, y: 0, z: 0 });
      onMobKillCreditForDeeds(sim.ctx, corpse, null, marsh, [marsh]);
      onBloatDetonatedForDeeds(sim.ctx, corpse, []);
    };
    for (let i = 0; i < 7; i++) cleanKill();
    sim.tick();
    expect(marsh.deedsEarned.has('chr_marsh_unburst')).toBe(false);
    cleanKill();
    sim.tick();
    expect(marsh.deedStats.counters.bloatCleanKills).toBe(8);
    expect(marsh.deedsEarned.has('chr_marsh_unburst')).toBe(true);
  });
});

describe('kill-credit negatives (onMobKillCreditForDeeds)', () => {
  it('cmb_giantslayer: needs a five-level gap and excludes dummies and world bosses', () => {
    // A kill only four levels up does not grant (boundary).
    const near = makeSim();
    const killer = addMeta(near, 'Ant');
    const kEnt = entityOf(near, killer);
    kEnt.level = 10;
    const mob4 = spawnMob(near, 'wild_boar', { x: 1, y: 0, z: 1 }, 14); // +4
    onMobKillCreditForDeeds(near.ctx, mob4, kEnt, killer, [killer]);
    expect(killer.deedsEarned.has('cmb_giantslayer')).toBe(false);
    // Five levels up grants.
    const mob5 = spawnMob(near, 'wild_boar', { x: 1, y: 0, z: 1 }, 15); // +5
    onMobKillCreditForDeeds(near.ctx, mob5, kEnt, killer, [killer]);
    expect(killer.deedsEarned.has('cmb_giantslayer')).toBe(true);

    // A training dummy far above the killer is excluded.
    const dummySim = makeSim();
    const dKiller = addMeta(dummySim, 'Ant');
    entityOf(dummySim, dKiller).level = 10;
    const dummy = spawnMob(dummySim, 'training_dummy', { x: 1, y: 0, z: 1 }, 30);
    onMobKillCreditForDeeds(dummySim.ctx, dummy, entityOf(dummySim, dKiller), dKiller, [dKiller]);
    expect(dKiller.deedsEarned.has('cmb_giantslayer')).toBe(false);

    // The world boss is excluded.
    const wbSim = makeSim();
    const wKiller = addMeta(wbSim, 'Ant');
    entityOf(wbSim, wKiller).level = 10;
    const wb = spawnMob(wbSim, 'thunzharr_waking_peak', { x: 1, y: 0, z: 1 }, 30);
    onMobKillCreditForDeeds(wbSim.ctx, wb, entityOf(wbSim, wKiller), wKiller, [wKiller]);
    expect(wKiller.deedsEarned.has('cmb_giantslayer')).toBe(false);
  });

  it('chr_vale_packbreaker: three forest_wolf kills inside the ten-second window', () => {
    const wolfKill = (sim: Sim, meta: PlayerMeta): void => {
      const wolf = spawnMob(sim, 'forest_wolf', { x: 1, y: 0, z: 1 });
      onMobKillCreditForDeeds(sim.ctx, wolf, null, meta, [meta]);
    };

    // Only two kills in the window: short of the pack.
    const two = makeSim();
    two.time = 5;
    const p2 = addMeta(two, 'Ranger');
    wolfKill(two, p2);
    wolfKill(two, p2);
    expect(p2.deedsEarned.has('chr_vale_packbreaker')).toBe(false);

    // Three kills, but the first is more than ten seconds stale and gets pruned.
    const gap = makeSim();
    gap.time = 5;
    const pg = addMeta(gap, 'Ranger');
    wolfKill(gap, pg);
    gap.time = 20; // fifteen seconds later, past the ten-second window
    wolfKill(gap, pg);
    wolfKill(gap, pg);
    expect(pg.deedsEarned.has('chr_vale_packbreaker')).toBe(false);

    // Three kills inside the window: the pack breaks.
    const ok = makeSim();
    ok.time = 5;
    const po = addMeta(ok, 'Ranger');
    wolfKill(ok, po);
    wolfKill(ok, po);
    wolfKill(ok, po);
    expect(po.deedsEarned.has('chr_vale_packbreaker')).toBe(true);
  });
});

describe('hub-station craft counter (prog_tools_of_the_trade)', () => {
  // The station-bound tool recipe and a free-field common recipe (recipes.ts).
  const HUB_RECIPE = 'recipe_thorium_mining_pick';
  const FIELD_RECIPE = 'recipe_eastbrook_arming_sword';

  function hubCrafter(sim: Sim, level = CRAFTING_HUB_MIN_LEVEL): PlayerMeta {
    const meta = addMeta(sim, 'Crafter');
    const e = entityOf(sim, meta);
    e.level = level;
    e.pos.x = CRAFTING_HUB_POS.x;
    e.pos.z = CRAFTING_HUB_POS.z;
    sim.ctx.addItem('thorium_ore', 4, meta.entityId);
    sim.ctx.addItem('mithril_mining_pick', 1, meta.entityId);
    return meta;
  }

  it('a station-bound craft at the hub bumps the counter and grants after the tick', () => {
    const sim = makeSim();
    const meta = hubCrafter(sim);
    const result = craftItem(sim.ctx, HUB_RECIPE, meta.entityId);
    expect(result.ok).toBe(true);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(1);
    expect(meta.deedStats.counters.craftsPerformed).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(true);
  });

  it('one step outside the hub circle denies, and the denied attempt counts nothing', () => {
    const sim = makeSim();
    const meta = hubCrafter(sim);
    const e = entityOf(sim, meta);
    e.pos.z = CRAFTING_HUB_POS.z + CRAFTING_HUB_RADIUS + 1;
    const denied = craftItem(sim.ctx, HUB_RECIPE, meta.entityId);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('not_at_hub');
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(0);
    expect(meta.deedStats.counters.craftsPerformed).toBe(0);
    // One step back inside the boundary, the same craft resolves and counts.
    e.pos.z = CRAFTING_HUB_POS.z + CRAFTING_HUB_RADIUS - 1;
    expect(craftItem(sim.ctx, HUB_RECIPE, meta.entityId).ok).toBe(true);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(1);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(true);
  });

  it('below the hub level gate the same on-the-spot craft denies and counts nothing', () => {
    const sim = makeSim();
    const meta = hubCrafter(sim, CRAFTING_HUB_MIN_LEVEL - 1);
    const denied = craftItem(sim.ctx, HUB_RECIPE, meta.entityId);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('not_at_hub');
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(0);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(false);
  });

  it('an ordinary field recipe crafted while standing at the hub never counts', () => {
    const sim = makeSim();
    const meta = hubCrafter(sim);
    sim.ctx.addItem('bone_fragments', 2, meta.entityId);
    sim.ctx.addItem('linen_scrap', 1, meta.entityId);
    const result = craftItem(sim.ctx, FIELD_RECIPE, meta.entityId);
    expect(result.ok).toBe(true);
    expect(meta.deedStats.counters.craftsPerformed).toBe(1);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(0);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(false);
    expect(meta.deedsEarned.has('prog_first_craft')).toBe(true);
  });
});

// Enchanting's two skill-gain sites (professions/enchanting.ts) raise
// craftSkills.enchanting, which the craftSkill triggers read, so each site
// must mark the player dirty itself (the crafting.ts craftItem contract):
// the grant may not depend on some unrelated site dirtying the player later.
describe('enchanting skill-gain sites', () => {
  // Pre-discover every item the action touches and drain the dirty set first:
  // addItem marks the player dirty on FIRST discovery of an item id, which
  // would mask a missing site mark (a veteran who long since discovered the
  // dust gets no discovery mark from the disenchant yield).
  function stagedAt74(sim: Sim): PlayerMeta {
    const meta = sim.players.get(sim.playerId)!;
    sim.addItem('eastbrook_arming_sword', 1, sim.playerId);
    sim.addItem('arcane_dust', 5, sim.playerId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(false);
    meta.craftSkills.enchanting = 74;
    return meta;
  }

  it('a disenchant that lifts enchanting skill over a craftSkill threshold grants after the tick', () => {
    const sim = makeSim();
    const meta = stagedAt74(sim);
    sim.disenchantItem('eastbrook_arming_sword');
    expect(sim.lastDisenchantResult?.ok).toBe(true);
    expect(meta.craftSkills.enchanting).toBe(75);
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(true);
  });

  it('an apply-enchant that lifts enchanting skill over the threshold grants after the tick', () => {
    const sim = makeSim();
    const meta = stagedAt74(sim);
    sim.applyEnchant('eastbrook_arming_sword', 'enchant_weapon_might');
    expect(sim.lastEnchantResult?.ok).toBe(true);
    expect(meta.craftSkills.enchanting).toBe(75);
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(true);
  });
});
