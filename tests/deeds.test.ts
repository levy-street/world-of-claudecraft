// Book of Deeds evaluator behavior: per-trigger grants with negative cases,
// the meta fixpoint, Fiesta standardization safety, retro-on-join credit,
// milestone unification, persistence round-trips, and determinism.
import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { emptyAllocation, type TalentAllocation } from '../src/sim/content/talents';
import { ITEMS, MOBS, QUESTS, ZONES } from '../src/sim/data';
import {
  bumpDeedStat,
  checkDeedTrigger,
  evaluateDeedsFor,
  grantDeed,
  markItemDiscovered,
  markVisited,
  onDamageDealtForDeeds,
  onDelveClearForDeeds,
  onDungeonFinalBossKilledForDeeds,
  onFishCaughtForDeeds,
  restoreDeedStats,
  updateDeeds,
} from '../src/sim/deeds';
import { BATTLEFIELD_XP_TRICKLE } from '../src/sim/professions/battlefield_xp';
import { queueGatheringGrant } from '../src/sim/professions/gathering';
import { turnInQuestCore } from '../src/sim/quests/quest_commands';
import { type ArenaMatch, type CharacterState, Sim } from '../src/sim/sim';
import * as duelMod from '../src/sim/social/duel';
import { type Entity, MAX_LEVEL, MILESTONES, type SimEvent } from '../src/sim/types';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function primary(sim: Sim) {
  const meta = sim.players.get(sim.playerId)!;
  const e = sim.entities.get(sim.playerId)!;
  return { meta, e };
}

function deedEvents(evs: SimEvent[]): Extract<SimEvent, { type: 'deedUnlocked' }>[] {
  return evs.filter((ev): ev is Extract<SimEvent, { type: 'deedUnlocked' }> => {
    return ev.type === 'deedUnlocked';
  });
}

// Seat a live 2v2 Fiesta bout (four solo-queuers, countdown run out) so the
// fiesta-takedown arm of dealDamage can be driven directly. Mirrors the
// startFiesta harness in tests/fiesta.test.ts.
function startFiestaBout(): { sim: Sim; match: ArenaMatch } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pids = [
    sim.addPlayer('warrior', 'P0'),
    sim.addPlayer('mage', 'P1'),
    sim.addPlayer('rogue', 'P2'),
    sim.addPlayer('priest', 'P3'),
  ];
  for (const p of pids) sim.arenaQueueJoin(p, 'fiesta');
  sim.tick(); // matchmake
  for (let i = 0; i < 20 * 8; i++) {
    const m = sim.arenaMatchFor(pids[0]);
    if (m && m.state === 'active') break;
    sim.tick();
  }
  return { sim, match: sim.arenaMatchFor(pids[0])! };
}

// Seat a live 3v3 Protect Yumi bout (six solo-queuers, countdown run out) so
// the yumi player-down arm of dealDamage can be driven directly. Mirrors the
// startYumi3 harness in tests/yumi_match.test.ts.
function startYumiBout(): { sim: Sim; match: ArenaMatch } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pids = [
    sim.addPlayer('warrior', 'P0'),
    sim.addPlayer('mage', 'P1'),
    sim.addPlayer('rogue', 'P2'),
    sim.addPlayer('priest', 'P3'),
    sim.addPlayer('hunter', 'P4'),
    sim.addPlayer('druid', 'P5'),
  ];
  for (const p of pids) sim.arenaQueueJoin(p, 'yumi3');
  sim.tick(); // matchmake
  for (let i = 0; i < 20 * 8; i++) {
    const m = sim.arenaMatchFor(pids[0]);
    if (m && m.state === 'active') break;
    sim.tick();
  }
  return { sim, match: sim.arenaMatchFor(pids[0])! };
}

describe('trigger kinds grant once, with negatives', () => {
  it('level: threshold minus one does not grant; the grant fires exactly once', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    e.level = 4;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_finding_your_feet')).toBe(false);
    expect(meta.deedsEarned.has('prog_first_steps')).toBe(true); // level 4 >= 2

    e.level = 5;
    sim.ctx.markDeedsDirty(meta.entityId);
    const evs = sim.tick();
    expect(meta.deedsEarned.has('prog_finding_your_feet')).toBe(true);
    expect(deedEvents(evs).filter((ev) => ev.deedId === 'prog_finding_your_feet').length).toBe(1);

    // Already earned: never re-fires.
    sim.ctx.markDeedsDirty(meta.entityId);
    const evs2 = sim.tick();
    expect(deedEvents(evs2).filter((ev) => ev.deedId === 'prog_finding_your_feet').length).toBe(0);
  });

  it('stat: the lifetime counter grants at the threshold, not below it', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.ctx.bumpDeedStat(meta, 'duelsWon', 0);
    sim.tick();
    expect(meta.deedsEarned.has('pvp_duel_first_win')).toBe(false);
    sim.ctx.bumpDeedStat(meta, 'duelsWon', 1);
    sim.tick();
    expect(meta.deedsEarned.has('pvp_duel_first_win')).toBe(true);
    expect(meta.deedStats.counters.duelsWon).toBe(1);
  });

  it('visits with count: partial coverage does not grant', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.ctx.markVisited(meta, 'npc:bursar_fernando');
    sim.ctx.markVisited(meta, 'npc:bursar_petra_vell');
    sim.tick();
    expect(meta.deedsEarned.has('hid_gilded_tour')).toBe(false);
    expect(meta.deedsEarned.has('soc_meet_bursar')).toBe(true); // single-mark visit deed
    sim.ctx.markVisited(meta, 'npc:bursar_aldous_crane');
    sim.tick();
    expect(meta.deedsEarned.has('hid_gilded_tour')).toBe(true);
  });

  it('collectItems: quality marks and the item set land through the discovery ledger', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.ctx.markItemDiscovered(meta, 'glimmerfin_koi');
    sim.tick();
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(true);
    // Effective-quality mark: an instanced rolled quality beats the def.
    sim.ctx.markItemDiscovered(meta, 'raw_mirror_trout', 'rare');
    sim.tick();
    expect(meta.deedsEarned.has('col_first_rare')).toBe(true);
    expect(meta.deedsEarned.has('col_first_epic')).toBe(false);
  });

  it('dungeonClears: a normal clear never satisfies the heroic deed', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.deedStats.dungeonClears.hollow_crypt = 1;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('dgn_hollow_crypt')).toBe(true);
    expect(meta.deedsEarned.has('dgn_hollow_crypt_heroic')).toBe(false);
    meta.deedStats.dungeonClears['hollow_crypt:heroic'] = 1;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('dgn_hollow_crypt_heroic')).toBe(true);
  });

  it('delveClears: the all-delves total sums every key; the per-delve heroic tier filters', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.delveClears['collapsed_reliquary:normal'] = 1;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('dlv_reliquary')).toBe(true);
    expect(meta.deedsEarned.has('dlv_reliquary_heroic')).toBe(false);
    meta.delveClears['collapsed_reliquary:heroic'] = 24;
    meta.delveClears['drowned_litany:normal'] = 25;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('dlv_reliquary_heroic')).toBe(true);
    expect(meta.deedsEarned.has('dlv_clears_50')).toBe(true); // 1 + 24 + 25
  });

  it('arenaRating: a one-way unlock survives the rating falling back', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.arenaRating = 1599;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('pvp_arena_1v1_1600')).toBe(false);
    meta.arenaRating = 1600;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('pvp_arena_1v1_1600')).toBe(true);
    meta.arenaRating = 100;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('pvp_arena_1v1_1600')).toBe(true);
  });

  it('arenaRating: the 2v2 bracket reads the 2v2 rating, never the 1v1 rating', () => {
    // A 2v2 rating alone grants only the 2v2 deed; a collapsed or swapped
    // bracket ternary (reading arenaRating for both) would fail this.
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.arena2v2Rating = 1600; // arenaRating stays at the 1500 base
    sim.ctx.markDeedsDirty(meta.entityId);
    const evs = sim.tick();
    expect(meta.deedsEarned.has('pvp_arena_2v2_1600')).toBe(true);
    expect(meta.deedsEarned.has('pvp_arena_1v1_1600')).toBe(false);
    expect(deedEvents(evs).filter((ev) => ev.deedId === 'pvp_arena_2v2_1600').length).toBe(1);
    // Already earned: never re-fires.
    sim.ctx.markDeedsDirty(meta.entityId);
    expect(deedEvents(sim.tick()).filter((ev) => ev.deedId === 'pvp_arena_2v2_1600').length).toBe(
      0,
    );

    // The mirror: a 1v1 rating alone never leaks into a 2v2 deed.
    const sim2 = makeSim();
    const p2 = primary(sim2);
    p2.meta.arenaRating = 1900; // arena2v2Rating stays at the 1500 base
    sim2.ctx.markDeedsDirty(p2.meta.entityId);
    sim2.tick();
    expect(p2.meta.deedsEarned.has('pvp_arena_1v1_1600')).toBe(true);
    expect(p2.meta.deedsEarned.has('pvp_arena_2v2_1600')).toBe(false);
  });

  it('lifetimeXp: the milestone predicate grants at the threshold, not one below', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.lifetimeXp = MILESTONES[0].lifetimeXp - 1; // 249,999
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_veteran')).toBe(false);
    meta.lifetimeXp = MILESTONES[0].lifetimeXp; // exactly 250,000
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_veteran')).toBe(true);
  });

  it('gathering: a proficiency one below the threshold does not grant', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.gatheringProficiency.mining = 99;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(false);
    meta.gatheringProficiency.mining = 100;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(true);
  });

  it('quest: an unrelated questsDone set does not grant; the exact quest does', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.questsDone.add('q_some_other_quest');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('hid_codfather')).toBe(false);
    meta.questsDone.add('q_the_codfather');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('hid_codfather')).toBe(true);
  });

  it('quests (plural): every listed quest must be done', () => {
    // The chain deeds below drive the shipped evaluator path; keep the direct
    // branch check for arbitrary id lists too.
    const sim = makeSim();
    const { meta, e } = primary(sim);
    meta.questsDone.add('qa');
    expect(checkDeedTrigger(meta, e, { kind: 'quests', questIds: ['qa', 'qb'] })).toBe(false);
    meta.questsDone.add('qb');
    expect(checkDeedTrigger(meta, e, { kind: 'quests', questIds: ['qa', 'qb'] })).toBe(true);
  });

  it('quests (plural): the Thornpeak chain needs all five, the crypt deed its one', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.questsDone.add('q_nythraxis_restless_dead');
    meta.questsDone.add('q_nythraxis_graves');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    // The certifying crypt quest is not among them yet.
    expect(meta.deedsEarned.has('dgn_nythraxis_crypt')).toBe(false);
    expect(meta.deedsEarned.has('prog_crown_below')).toBe(false);

    meta.questsDone.add('q_nythraxis_sealed_crypt');
    meta.questsDone.add('q_nythraxis_bound_guardian');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    // Four of five: the chain boundary negative; the crypt deed lands alone.
    expect(meta.deedsEarned.has('dgn_nythraxis_crypt')).toBe(true);
    expect(meta.deedsEarned.has('prog_crown_below')).toBe(false);

    meta.questsDone.add('q_nythraxis_scourges_end');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_crown_below')).toBe(true);
  });

  it('quests (plural): the temple back half needs all four devotions', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    for (const q of ['q_drowned_choir', 'q_palecoil', 'q_silence_the_choir']) {
      meta.questsDone.add(q);
    }
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_mere_at_rest')).toBe(false);
    meta.questsDone.add('q_drowned_moon');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_mere_at_rest')).toBe(true);
  });

  it('quest: the professions intro grants prog_callused_hands, not its neighbor', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.questsDone.add('q_mine'); // the same giver's other quest never counts
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_callused_hands')).toBe(false);
    meta.questsDone.add('q_prof_intro');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_callused_hands')).toBe(true);
  });

  it('visit: a Marsh catch marks fish:mirefen_marsh and grants chr_marsh_first_cast', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // Non-fish never passes the ZONE_FISH filter, so no mark lands.
    onFishCaughtForDeeds(sim.ctx, meta, 'mirefen_marsh', 'boar_hide');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('chr_marsh_first_cast')).toBe(false);
    // A Vale catch marks the Vale, never the Marsh (zone fidelity).
    onFishCaughtForDeeds(sim.ctx, meta, 'eastbrook_vale', 'raw_mirror_trout');
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('chr_marsh_first_cast')).toBe(false);
    expect(meta.deedsEarned.has('chr_vale_first_cast')).toBe(true);
    onFishCaughtForDeeds(sim.ctx, meta, 'mirefen_marsh', 'raw_bog_eel');
    sim.tick();
    expect(meta.deedsEarned.has('chr_marsh_first_cast')).toBe(true);
  });

  it('stat: hubCraftsPerformed grants prog_tools_of_the_trade at one, not zero', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.ctx.bumpDeedStat(meta, 'hubCraftsPerformed', 0);
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(false);
    sim.ctx.bumpDeedStat(meta, 'hubCraftsPerformed', 1);
    sim.tick();
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(true);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(1);
  });

  it('manual deeds are never satisfied by the generic evaluator', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    e.level = MAX_LEVEL;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    for (const id of ['cmb_giantslayer', 'hid_fall_death', 'dgn_morthen_flawless']) {
      expect(meta.deedsEarned.has(id), id).toBe(false);
      expect(DEEDS[id].trigger.kind).toBe('manual');
    }
    // The explicit site path grants them, idempotently.
    expect(sim.ctx.grantDeed(meta, 'hid_fall_death')).toBe(true);
    expect(sim.ctx.grantDeed(meta, 'hid_fall_death')).toBe(false);
    expect(meta.deedsEarned.has('hid_fall_death')).toBe(true);
  });
});

describe('grant path', () => {
  it('renown accumulates per grant; 0-renown deeds add nothing', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const before = meta.renown;
    grantDeed(sim.ctx, meta, 'col_glimmerfin'); // renown 0
    expect(meta.renown).toBe(before);
    grantDeed(sim.ctx, meta, 'soc_meet_bursar'); // renown 5
    expect(meta.renown).toBe(before + 5);
    // Idempotent: a second grant never double-counts.
    grantDeed(sim.ctx, meta, 'soc_meet_bursar');
    expect(meta.renown).toBe(before + 5);
  });

  it('the meta fixpoint resolves chained deeds within a single pass', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    for (const zone of ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights']) {
      const wayfarer =
        DEEDS[
          zone === 'eastbrook_vale'
            ? 'exp_vale_wayfarer'
            : zone === 'mirefen_marsh'
              ? 'exp_marsh_wayfarer'
              : 'exp_peaks_wayfarer'
        ];
      if (wayfarer.trigger.kind !== 'visits') throw new Error('fixture drift');
      for (const mark of wayfarer.trigger.markIds) markVisited(sim.ctx, meta, mark);
    }
    evaluateDeedsFor(sim.ctx, meta, e, false);
    // The three wayfarers AND the meta over them land in the same pass.
    expect(meta.deedsEarned.has('exp_vale_wayfarer')).toBe(true);
    expect(meta.deedsEarned.has('exp_marsh_wayfarer')).toBe(true);
    expect(meta.deedsEarned.has('exp_peaks_wayfarer')).toBe(true);
    expect(meta.deedsEarned.has('exp_world_traveler')).toBe(true);
    expect(meta.deedsEarned.has('exp_long_road_north')).toBe(true);
  });

  it('a grant from a bespoke site resolves dependent metas at the tick tail', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    for (const id of [
      'dgn_hollow_crypt_heroic',
      'dgn_sunken_bastion_heroic',
      'dgn_drowned_temple_heroic',
      'dgn_gravewyrm_sanctum_heroic',
      'dgn_nythraxis_heroic',
      'dlv_reliquary_heroic',
    ]) {
      grantDeed(sim.ctx, meta, id);
    }
    sim.tick();
    expect(meta.deedsEarned.has('dgn_deepward')).toBe(false);
    grantDeed(sim.ctx, meta, 'dlv_litany_heroic'); // the seventh requirement
    sim.tick();
    expect(meta.deedsEarned.has('dgn_deepward')).toBe(true);
  });
});

describe('Fiesta standardization safety', () => {
  it('a standardized fighter never satisfies level deeds; evaluation resumes after restore', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    // Seated in a Fiesta bout: the character is standardized to the cap.
    meta.fiestaRestore = { level: 3, xp: 0, talents: emptyAllocation() };
    e.level = MAX_LEVEL;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_level_cap')).toBe(false);
    // Bout over: the restore site puts the real level back and re-marks dirty.
    e.level = 3;
    meta.fiestaRestore = null;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_level_cap')).toBe(false);
    expect(meta.deedsEarned.has('prog_first_steps')).toBe(true); // the real level still counts
  });
});

describe('retro on join', () => {
  function veteranState(): CharacterState {
    return {
      level: 12,
      xp: 0,
      lifetimeXp: 260000,
      copper: 0,
      hp: 100,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [{ itemId: 'glimmerfin_koi', count: 1 }],
      questLog: [],
      questsDone: ['q_the_codfather'],
      arena1v1Rating: 1650,
      delveClears: { 'collapsed_reliquary:normal': 2 },
      craftSkills: { cooking: 3 },
      gatheringProficiency: { mining: 1 },
    };
  }

  it('predicates over persisted state grant with retro: true; counters do not', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Returning', { state: veteranState() });
    const meta = sim.players.get(pid)!;
    // State predicates back-credit immediately on join.
    for (const id of [
      'prog_first_steps',
      'prog_double_digits', // level 12
      'prog_veteran', // lifetimeXp 260k
      'hid_codfather', // questsDone
      'dlv_reliquary', // persisted delve clears
      'pvp_arena_1v1_1600', // persisted rating
      'prog_first_craft', // retro fallback: craft skill only comes from crafts
      'exp_first_ore', // gathering proficiency
      'prog_first_harvest',
      'col_glimmerfin', // seeded from held items
    ]) {
      expect(meta.deedsEarned.has(id), id).toBe(true);
    }
    // Lifetime counters start at zero: no counter deed retro-grants.
    expect(meta.deedsEarned.has('cmb_first_blood')).toBe(false);
    expect(meta.deedStats.counters.kills).toBe(0);
    // The join events drain with the next tick, retro-flagged, to this player.
    const evs = deedEvents(sim.tick());
    const veteranEv = evs.find((ev) => ev.deedId === 'prog_veteran');
    expect(veteranEv?.retro).toBe(true);
    expect(veteranEv?.pid).toBe(pid);
  });

  it('enchanting-only skill never retro-grants the first craft', () => {
    // Disenchant and apply-enchant raise craftSkills.enchanting without any
    // craft (professions/enchanting.ts), so the fallback's proof-of-craft
    // inference must not read that key; any real craft skill still proves it.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Disenchanter', {
      state: { ...veteranState(), craftSkills: { enchanting: 5 } },
    });
    expect(sim.players.get(pid)!.deedsEarned.has('prog_first_craft')).toBe(false);
    const pid2 = sim.addPlayer('warrior', 'Cook', {
      state: { ...veteranState(), craftSkills: { enchanting: 5, cooking: 1 } },
    });
    expect(sim.players.get(pid2)!.deedsEarned.has('prog_first_craft')).toBe(true);
  });

  it('the quest-chain deeds retro-grant for an attuned veteran on first login', () => {
    const sim = makeSim();
    const state = veteranState();
    state.questsDone = [
      'q_prof_intro',
      'q_nythraxis_restless_dead',
      'q_nythraxis_graves',
      'q_nythraxis_sealed_crypt',
      'q_nythraxis_bound_guardian',
      'q_nythraxis_scourges_end',
      'q_drowned_choir',
      'q_palecoil',
      'q_silence_the_choir',
      'q_drowned_moon',
    ];
    const pid = sim.addPlayer('warrior', 'Attuned', { state });
    const meta = sim.players.get(pid)!;
    for (const id of [
      'prog_crown_below',
      'prog_mere_at_rest',
      'prog_callused_hands',
      'dgn_nythraxis_crypt',
    ]) {
      expect(meta.deedsEarned.has(id), id).toBe(true);
    }
    // The hub-craft counter starts at zero like every lifetime counter.
    expect(meta.deedsEarned.has('prog_tools_of_the_trade')).toBe(false);
    expect(meta.deedStats.counters.hubCraftsPerformed).toBe(0);
    const evs = deedEvents(sim.tick());
    const crownEv = evs.find((ev) => ev.deedId === 'prog_crown_below');
    expect(crownEv?.retro).toBe(true);
    expect(crownEv?.pid).toBe(pid);

    // A partial chain retro-grants nothing (missing-quest boundaries).
    const partial = makeSim();
    const pstate = veteranState();
    pstate.questsDone = [
      'q_nythraxis_restless_dead',
      'q_nythraxis_graves',
      'q_nythraxis_bound_guardian',
      'q_nythraxis_scourges_end',
      'q_drowned_choir',
      'q_palecoil',
      'q_silence_the_choir',
    ];
    const ppid = partial.addPlayer('warrior', 'Partway', { state: pstate });
    const pmeta = partial.players.get(ppid)!;
    expect(pmeta.deedsEarned.has('prog_crown_below')).toBe(false);
    expect(pmeta.deedsEarned.has('prog_mere_at_rest')).toBe(false);
    // q_nythraxis_sealed_crypt is the one missing certifier.
    expect(pmeta.deedsEarned.has('dgn_nythraxis_crypt')).toBe(false);
  });

  it('an equipped instance with a rolled quality seeds the quality-first marks on join', () => {
    // A veteran whose only rare is worn (the crafted instance moved from the
    // bags into equipmentInstance) must keep the rare-first credit at join.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'RolledVet', {
      state: {
        ...veteranState(),
        inventory: [],
        equipment: { mainhand: 'redbrook_blade' },
        equipmentInstance: { mainhand: { rolled: { quality: 'rare' } } },
      },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.deedStats.itemsDiscovered.has('redbrook_blade')).toBe(true);
    expect(meta.deedStats.visited.has('quality:rare')).toBe(true);
    expect(meta.deedsEarned.has('col_first_rare')).toBe(true);
    expect(meta.deedsEarned.has('col_first_epic')).toBe(false);
  });

  it('a buyback instance with a rolled quality seeds the quality-first marks on join', () => {
    // Buyback entries persist bare {itemId, count} today, so this arm is
    // forward insurance: if a vendor sale ever keeps its instance payload,
    // the seed must credit the rolled quality exactly like bags, bank, and
    // equipment do.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'BuybackVet', {
      state: {
        ...veteranState(),
        inventory: [],
        vendorBuyback: [
          { itemId: 'redbrook_blade', count: 1, instance: { rolled: { quality: 'rare' } } },
        ],
      },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.deedStats.itemsDiscovered.has('redbrook_blade')).toBe(true);
    expect(meta.deedStats.visited.has('quality:rare')).toBe(true);
    expect(meta.deedsEarned.has('col_first_rare')).toBe(true);
  });

  it('a masterwork bag instance seeds at the item DEF quality on join (no bump inflation)', () => {
    // Professions 2.0 Phase 2: a masterwork copy carries rolled.masterwork +
    // rolled.stats and NO rolled.quality, so the join seed reads the def
    // quality. eastbrook_ritual_vestments' def is uncommon: the gameplay bump
    // to rare is a stat-budget fact, never a discovery fact.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'MasterVet', {
      state: {
        ...veteranState(),
        inventory: [
          {
            itemId: 'eastbrook_ritual_vestments',
            count: 1,
            instance: {
              signer: 'MasterVet',
              rolled: { masterwork: true, stats: { int: 1, spi: 1 } },
            },
          },
        ],
      },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.deedStats.itemsDiscovered.has('eastbrook_ritual_vestments')).toBe(true);
    expect(meta.deedStats.visited.has('quality:rare')).toBe(false);
    expect(meta.deedsEarned.has('col_first_rare')).toBe(false);
  });

  it('a legacy bag instance with rolled.quality rare still seeds the quality:rare mark on join', () => {
    // Legacy crafted instances (pre-Phase 2) persist rolled.quality; their
    // exact old read is unchanged: the rolled quality beats the def.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'LegacyVet', {
      state: {
        ...veteranState(),
        inventory: [
          { itemId: 'redbrook_blade', count: 1, instance: { rolled: { quality: 'rare' } } },
        ],
      },
    });
    const meta = sim.players.get(pid)!;
    expect(meta.deedStats.itemsDiscovered.has('redbrook_blade')).toBe(true);
    expect(meta.deedStats.visited.has('quality:rare')).toBe(true);
    expect(meta.deedsEarned.has('col_first_rare')).toBe(true);
    expect(meta.deedsEarned.has('col_first_epic')).toBe(false);
  });

  it('the retro pass is a pure function of the loaded state and the catalog', () => {
    const a = new Sim({ seed: 7, playerClass: 'mage' });
    const b = new Sim({ seed: 7, playerClass: 'mage' });
    const pa = a.addPlayer('warrior', 'Same', { state: veteranState() });
    const pb = b.addPlayer('warrior', 'Same', { state: veteranState() });
    expect([...a.players.get(pa)!.deedsEarned.keys()].sort()).toEqual(
      [...b.players.get(pb)!.deedsEarned.keys()].sort(),
    );
  });

  it('a done ground-pickup quest proves the sparkle and heals Something Shiny', () => {
    // Every ground object is a quest item whose pickup is denied once its
    // quest is done, so an all-quests-done veteran can never bump the counter
    // again; the done proving quest is itself the evidence the pickup
    // happened before the counter existed.
    const sim = makeSim();
    const state = veteranState();
    state.questsDone = ['q_supplies'];
    const pid = sim.addPlayer('warrior', 'Supplier', { state });
    const meta = sim.players.get(pid)!;
    expect(meta.deedsEarned.has('exp_something_shiny')).toBe(true);
    // The heal grants the deed; the lifetime counter stays honest at zero.
    expect(meta.deedStats.counters.groundObjectsLooted).toBe(0);
    const evs = deedEvents(sim.tick());
    const ev = evs.find((e) => e.deedId === 'exp_something_shiny');
    expect(ev?.retro).toBe(true);
    expect(ev?.pid).toBe(pid);

    // Interact-objective chains and mob-drop collect chains prove nothing:
    // those routes return before the counter bump, so they must not heal.
    const sim2 = makeSim();
    const s2 = veteranState();
    s2.questsDone = ['q_nythraxis_graves', 'q_nythraxis_sealed_crypt', 'q_the_codfather'];
    const pid2 = sim2.addPlayer('warrior', 'Interactor', { state: s2 });
    expect(sim2.players.get(pid2)!.deedsEarned.has('exp_something_shiny')).toBe(false);
  });

  it('Giantslayer heals exactly where no mob can sit five levels up', () => {
    // The heroic pin (level 22) is the highest creditable spawn in the game,
    // so level 18 is the first permanently stranded level and 17 the last
    // one where the live kill site can still fire.
    const sim = makeSim();
    const capped = sim.addPlayer('warrior', 'Capped', {
      state: { ...veteranState(), level: 20 },
    });
    expect(sim.players.get(capped)!.deedsEarned.has('cmb_giantslayer')).toBe(true);
    const edge = sim.addPlayer('warrior', 'Edge', { state: { ...veteranState(), level: 18 } });
    expect(sim.players.get(edge)!.deedsEarned.has('cmb_giantslayer')).toBe(true);
    const leveler = sim.addPlayer('warrior', 'Leveler', {
      state: { ...veteranState(), level: 17 },
    });
    expect(sim.players.get(leveler)!.deedsEarned.has('cmb_giantslayer')).toBe(false);
    // The heal is a retro grant: flagged on the event, delivered to the
    // healed player only.
    const evs = deedEvents(sim.tick());
    const ev = evs.find((e) => e.deedId === 'cmb_giantslayer' && e.pid === capped);
    expect(ev?.retro).toBe(true);
  });

  it('the heals unlock feat_book_complete in the same join for an otherwise complete book', () => {
    // The motivating payoff: when the three healed deeds were the last holes
    // in a veteran's book, the meta pass that runs right after the fallback
    // arms must complete the feat on the SAME login, not one login later.
    const healed = ['exp_something_shiny', 'cmb_giantslayer', 'prog_well_rested'];
    const bookIds = (DEEDS.feat_book_complete.trigger as { deedIds: string[] }).deedIds;
    const deeds: Record<string, string> = {};
    for (const id of bookIds) {
      if (!healed.includes(id)) deeds[id] = '2026-07-01';
    }
    const sim = makeSim();
    const state: CharacterState = {
      ...veteranState(),
      level: MAX_LEVEL,
      restedXp: 0,
      questsDone: ['q_supplies'],
      deeds,
    };
    const pid = sim.addPlayer('warrior', 'Completionist', { state });
    const meta = sim.players.get(pid)!;
    for (const id of healed) expect(meta.deedsEarned.has(id), id).toBe(true);
    expect(meta.deedsEarned.has('feat_book_complete')).toBe(true);
  });

  it('Well Rested heals only at the cap where the pool is frozen', () => {
    // Rested XP neither accrues nor drains at MAX_LEVEL, so a capped save
    // with an empty pool is permanently stranded; below the cap the pool can
    // still accrue and the deed must stay earned-by-play.
    const sim = makeSim();
    const dry = sim.addPlayer('warrior', 'CappedDry', {
      state: { ...veteranState(), level: MAX_LEVEL, restedXp: 0 },
    });
    expect(sim.players.get(dry)!.deedsEarned.has('prog_well_rested')).toBe(true);
    const leveling = sim.addPlayer('warrior', 'StillRests', {
      state: { ...veteranState(), level: MAX_LEVEL - 1, restedXp: 0 },
    });
    expect(sim.players.get(leveling)!.deedsEarned.has('prog_well_rested')).toBe(false);
    // A frozen nonzero pool retro-grants through the flag predicate already;
    // the heal must not be the only path that covers it.
    const banked = sim.addPlayer('warrior', 'Banked', {
      state: { ...veteranState(), level: MAX_LEVEL, restedXp: 50 },
    });
    expect(sim.players.get(banked)!.deedsEarned.has('prog_well_rested')).toBe(true);
  });
});

// Professions 2.0 Phase 2: a live masterwork grant (sim.addItemInstance, the
// exact hub the craft path's masterwork arm calls) carries rolled.masterwork
// and NO rolled.quality, so the discovery ledger reads the item DEF quality,
// identical to a plain grant of the same item; the one-tier gameplay bump
// never inflates the quality-first marks.
describe('masterwork instance discovery (Professions 2.0 Phase 2)', () => {
  it('a rare-DEF masterwork instance marks discovery exactly like a plain grant of the item', () => {
    // Rare DEF (boundstone_helm): the def quality itself lands quality:rare on
    // both paths, and the masterwork bump (rare to epic in stats) lands epic
    // on NEITHER.
    const viaMasterwork = makeSim();
    const { meta: mwMeta } = primary(viaMasterwork);
    viaMasterwork.addItemInstance(
      'boundstone_helm',
      { signer: mwMeta.name, rolled: { masterwork: true, stats: { sta: 2, str: 1 } } },
      viaMasterwork.playerId,
    );
    viaMasterwork.tick();
    const viaPlain = makeSim();
    const { meta: plainMeta } = primary(viaPlain);
    viaPlain.addItem('boundstone_helm', 1, viaPlain.playerId);
    viaPlain.tick();
    for (const meta of [mwMeta, plainMeta]) {
      expect(meta.deedStats.itemsDiscovered.has('boundstone_helm')).toBe(true);
      expect(meta.deedStats.visited.has('quality:rare')).toBe(true);
      expect(meta.deedStats.visited.has('quality:epic')).toBe(false);
      expect(meta.deedsEarned.has('col_first_rare')).toBe(true);
      expect(meta.deedsEarned.has('col_first_epic')).toBe(false);
    }
  });

  it('an uncommon-DEF masterwork instance never lands the bumped rare mark', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.addItemInstance(
      'eastbrook_ritual_vestments',
      { signer: meta.name, rolled: { masterwork: true, stats: { int: 1, spi: 1 } } },
      sim.playerId,
    );
    sim.tick();
    expect(meta.deedStats.itemsDiscovered.has('eastbrook_ritual_vestments')).toBe(true);
    expect(meta.deedStats.visited.has('quality:rare')).toBe(false);
    expect(meta.deedsEarned.has('col_first_rare')).toBe(false);
  });
});

describe('milestone unification', () => {
  it('a legacy save with unlockedMilestones maps onto the prog_ deeds at load', () => {
    const sim = makeSim();
    // lifetimeXp is deliberately BELOW the veteran threshold so only the
    // legacy-set union (never the retro lifetimeXp predicate) can be the
    // source of the grant; deleting the union must turn this red.
    const pid = sim.addPlayer('warrior', 'Legacy', {
      state: {
        ...{
          level: 20,
          xp: 0,
          copper: 0,
          hp: 100,
          resource: 0,
          pos: { x: 2, z: -2 },
          facing: 0,
          equipment: {},
          inventory: [],
          questLog: [],
          questsDone: [],
        },
        lifetimeXp: 100000,
        unlockedMilestones: ['veteran'],
      },
    });
    const meta = sim.players.get(pid)!;
    // The union's signature: earned with the unknown-day stamp, silently (no
    // deedUnlocked event for it; the character already had the milestone),
    // with the renown recompute counting it exactly once.
    expect(meta.deedsEarned.get('prog_veteran')).toBe('');
    expect(meta.unlockedMilestones.has('veteran')).toBe(true);
    let recomputed = 0;
    for (const id of meta.deedsEarned.keys()) recomputed += DEEDS[id].renown;
    expect(meta.renown).toBe(recomputed);
    const evs = deedEvents(sim.tick());
    expect(evs.some((ev) => ev.deedId === 'prog_veteran')).toBe(false);
  });

  it('a new milestone grant dual-writes the legacy set and both persist', () => {
    const sim = makeSim();
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(MILESTONES[0].lifetimeXp + 1);
    sim.tick();
    const { meta } = primary(sim);
    expect(meta.deedsEarned.has('prog_veteran')).toBe(true);
    expect(meta.unlockedMilestones.has('veteran')).toBe(true);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.deeds?.prog_veteran).toBeDefined();
    expect(state.unlockedMilestones).toContain('veteran');
  });

  it('renown is recomputed from the earned set on load, ignoring the saved number', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    grantDeed(sim.ctx, meta, 'soc_meet_bursar'); // 5 renown
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.renown).toBe(5);
    const tampered = { ...state, renown: 9999 };
    const sim2 = makeSim();
    const pid = sim2.addPlayer('warrior', 'Reload', { state: tampered });
    expect(sim2.players.get(pid)!.renown).toBe(5);
  });
});

describe('persistence', () => {
  it('round-trips every new field', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    bumpDeedStat(sim.ctx, meta, 'kills', 3);
    bumpDeedStat(sim.ctx, meta, 'lootCopper', 12345);
    markVisited(sim.ctx, meta, 'poi:eastbrook_vale:eastbrook');
    markItemDiscovered(sim.ctx, meta, 'glimmerfin_koi');
    meta.deedStats.dungeonClears['hollow_crypt:heroic'] = 2;
    // A bare poke bypasses the clear helper's narrow mark; request the full
    // pass the production write site performs (the keyed-marks contract), so
    // both sims earn the clear deeds and the round-trip stays comparable.
    sim.ctx.markDeedsDirty(meta.entityId);
    // The load path re-applies the saved title through the setter validator,
    // so the fixture earns the deed before selecting it (a bare field poke
    // would load as untitled by design).
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran');
    sim.tick();
    const state = sim.serializeCharacter(sim.playerId)!;
    const sim2 = makeSim();
    const pid = sim2.addPlayer('warrior', 'Reload', { state });
    const m2 = sim2.players.get(pid)!;
    expect(m2.deedStats.counters.kills).toBe(3);
    expect(m2.deedStats.counters.lootCopper).toBe(12345);
    expect(m2.deedStats.visited.has('poi:eastbrook_vale:eastbrook')).toBe(true);
    expect(m2.deedStats.itemsDiscovered.has('glimmerfin_koi')).toBe(true);
    expect(m2.deedStats.dungeonClears['hollow_crypt:heroic']).toBe(2);
    expect(m2.activeTitle).toBe('prog_veteran');
    expect([...m2.deedsEarned.keys()].sort()).toEqual([...meta.deedsEarned.keys()].sort());
    expect(m2.renown).toBe(meta.renown);
  });

  it('a pre-deed save loads clean and serializes without the new keys until the system engages', () => {
    const bare: CharacterState = {
      level: 1,
      xp: 0,
      copper: 0,
      hp: 30,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
    };
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Bare', { state: bare });
    const meta = sim.players.get(pid)!;
    expect(meta.deedsEarned.size).toBe(0);
    expect(meta.renown).toBe(0);
    const state = sim.serializeCharacter(pid)!;
    expect(state.deeds).toBeUndefined();
    expect(state.deedStats).toBeUndefined();
    expect(state.activeTitle).toBeUndefined();
    expect(state.renown).toBeUndefined();
  });

  it('a fresh character seeds the discovery ledger from its starter kit deterministically', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // The starter weapon/chest (and rations, when the class carries them) are
    // possessions, so they are discovered from tick zero.
    expect(meta.deedStats.itemsDiscovered.size).toBeGreaterThan(0);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.deedStats?.itemsDiscovered?.length).toBe(meta.deedStats.itemsDiscovered.size);
  });

  it('a heroic variant credits its base item in the discovery ledger (drop and rejoin)', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // A heroic instance swaps a rare/epic drop for its generated heroic_<base>
    // variant (same display name, same set membership); the collection deeds
    // key on the BASE ids, so a variant discovery must credit both.
    markItemDiscovered(sim.ctx, meta, 'heroic_boundstone_helm');
    expect(meta.deedStats.itemsDiscovered.has('heroic_boundstone_helm')).toBe(true);
    expect(meta.deedStats.itemsDiscovered.has('boundstone_helm')).toBe(true);

    // A veteran who looted the variant before this rule joins with only the
    // variant id in the persisted ledger and the item still in the bags: the
    // join seed retro-credits the base.
    const held: CharacterState = {
      level: 20,
      xp: 0,
      copper: 0,
      hp: 30,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [{ itemId: 'heroic_boundstone_helm', count: 1 }],
      questLog: [],
      questsDone: [],
      deedStats: { itemsDiscovered: ['heroic_boundstone_helm'] },
    };
    const sim2 = makeSim();
    const pid = sim2.addPlayer('warrior', 'HeldVariant', { state: held });
    const m2 = sim2.players.get(pid)!;
    expect(m2.deedStats.itemsDiscovered.has('heroic_boundstone_helm')).toBe(true);
    expect(m2.deedStats.itemsDiscovered.has('boundstone_helm')).toBe(true);
  });

  it('the join seed covers the vendor buyback list, and a repurchase credits discovery', () => {
    const sim = makeSim();
    const state: CharacterState = {
      level: 20,
      xp: 0,
      copper: 1000,
      hp: 30,
      resource: 0,
      pos: { x: 2, z: -2 },
      facing: 0,
      equipment: {},
      inventory: [],
      questLog: [],
      questsDone: [],
      vendorBuyback: [{ itemId: 'wolf_fang', count: 1 }],
    };
    const pid = sim.addPlayer('warrior', 'BuybackVet', { state });
    const meta = sim.players.get(pid)!;
    // A pre-ledger save whose only copy sits in the buyback list was once
    // possessed: the join seed credits it.
    expect(meta.deedStats.itemsDiscovered.has('wolf_fang')).toBe(true);

    // The repurchase path credits on its own, so a future seed refactor
    // cannot silently reopen the gap: clear the mark and buy the item back.
    meta.deedStats.itemsDiscovered.delete('wolf_fang');
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes')!;
    sim.entities.get(pid)!.pos = { x: wilkes.pos.x + 2, y: wilkes.pos.y, z: wilkes.pos.z };
    sim.buyBackItem('wolf_fang', pid);
    expect(sim.countItem('wolf_fang', pid)).toBe(1);
    expect(meta.deedStats.itemsDiscovered.has('wolf_fang')).toBe(true);
  });

  it('the discovery ledger rejects ids that are not real items', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const before = meta.deedStats.itemsDiscovered.size;
    markItemDiscovered(sim.ctx, meta, 'no_such_item_id');
    expect(meta.deedStats.itemsDiscovered.size).toBe(before);
  });

  it('a malformed heroicOf cycle terminates the discovery walk and marks each id once', () => {
    // Bases never carry heroicOf in real content, so the walk is depth two by
    // construction; this pins that a malformed def cycle degrades to a bounded
    // walk instead of unbounded recursion.
    const sim = makeSim();
    const { meta } = primary(sim);
    ITEMS.qa_cycle_a = { ...ITEMS.boundstone_helm, id: 'qa_cycle_a', heroicOf: 'qa_cycle_b' };
    ITEMS.qa_cycle_b = { ...ITEMS.boundstone_helm, id: 'qa_cycle_b', heroicOf: 'qa_cycle_a' };
    try {
      const before = meta.deedStats.itemsDiscovered.size;
      markItemDiscovered(sim.ctx, meta, 'qa_cycle_a');
      expect(meta.deedStats.itemsDiscovered.has('qa_cycle_a')).toBe(true);
      expect(meta.deedStats.itemsDiscovered.has('qa_cycle_b')).toBe(true);
      expect(meta.deedStats.itemsDiscovered.size).toBe(before + 2);
    } finally {
      delete ITEMS.qa_cycle_a;
      delete ITEMS.qa_cycle_b;
    }
  });

  it('every visited mark a live sim writes stays inside the authored namespaces', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    for (let i = 0; i < 25; i++) sim.tick(); // let the 1 Hz proximity sweep run
    for (const mark of meta.deedStats.visited) {
      expect(mark).toMatch(/^(poi|gather|fish|npc|slain|quality|fiesta|dungeon|witness):/);
    }
    // The spawn-square sweep marked the hub POI (bounded, authored input).
    expect(meta.deedStats.visited.has('poi:eastbrook_vale:eastbrook')).toBe(true);
  });
});

describe('determinism', () => {
  it('two sims with the same seed and script produce identical earned sets and event streams', () => {
    const run = () => {
      const sim = makeSim(1234);
      const { meta } = primary(sim);
      const events: SimEvent[] = [];
      sim.setPlayerLevel(10);
      bumpDeedStat(sim.ctx, meta, 'kills', 1);
      events.push(...sim.tick());
      markVisited(sim.ctx, meta, 'npc:bursar_fernando');
      events.push(...sim.tick());
      return {
        earned: [...meta.deedsEarned.keys()],
        deedEvents: deedEvents(events).map((ev) => `${ev.deedId}:${ev.retro ?? false}`),
      };
    };
    const a = run();
    const b = run();
    expect(a.earned).toEqual(b.earned);
    expect(a.deedEvents).toEqual(b.deedEvents);
    expect(a.deedEvents.length).toBeGreaterThan(0);
  });

  it('the evaluator draws zero rng', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    e.level = MAX_LEVEL;
    meta.lifetimeXp = 6000000;
    let draws = 0;
    // The parity harness's observer seam: pure bookkeeping, no behavior change.
    sim.rng.setObserver(() => draws++);
    evaluateDeedsFor(sim.ctx, meta, e, false);
    sim.rng.setObserver(null);
    expect(meta.deedsEarned.has('prog_eternal')).toBe(true);
    expect(draws).toBe(0);
  });
});

describe('craftSkill triggers', () => {
  it('the single-craft arm grants at 75, not at 74', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.craftSkills.cooking = 74;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(false);
    meta.craftSkills.cooking = 75;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(true);
  });

  it('the breadth arm needs 25 skill in five crafts, not four', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    for (const craft of ['cooking', 'alchemy', 'tailoring', 'engineering']) {
      meta.craftSkills[craft] = 25;
    }
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_around_the_ring')).toBe(false);
    meta.craftSkills.leatherworking = 25;
    sim.ctx.markDeedsDirty(meta.entityId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_around_the_ring')).toBe(true);
  });
});

describe('meter triggers (negative then positive per resolver)', () => {
  it('prestigeRank, talentPoints proxies, and the persisted-record meters all gate at their thresholds', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const cases: {
      deedId: string;
      below: () => void;
      at: () => void;
    }[] = [
      {
        deedId: 'prog_prestige',
        below: () => {
          meta.prestigeRank = 0;
        },
        at: () => {
          meta.prestigeRank = 1;
        },
      },
      {
        deedId: 'pvp_vcup_wins_10',
        below: () => {
          meta.vcupWins = 9;
        },
        at: () => {
          meta.vcupWins = 10;
        },
      },
      {
        deedId: 'pvp_vcup_guild_win',
        below: () => {
          meta.vcupGuildWins = 0;
        },
        at: () => {
          meta.vcupGuildWins = 1;
        },
      },
      {
        deedId: 'soc_civic_duty',
        below: () => {
          meta.townFocus = {};
        },
        at: () => {
          meta.townFocus = { forge: 1 };
        },
      },
      {
        deedId: 'dlv_lore_journal',
        below: () => {
          meta.delveLoreUnlocked = new Set(['a', 'b', 'c', 'd']);
        },
        at: () => {
          meta.delveLoreUnlocked = new Set(['a', 'b', 'c', 'd', 'e']);
        },
      },
      {
        deedId: 'dlv_companion_max',
        below: () => {
          meta.companionUpgrades = { companion_tessa: 2 };
        },
        at: () => {
          meta.companionUpgrades = { companion_tessa: 3 };
        },
      },
      {
        deedId: 'soc_room_for_more',
        below: () => {
          meta.bank.purchasedSlots = 5;
        },
        at: () => {
          meta.bank.purchasedSlots = 6;
        },
      },
      {
        deedId: 'pvp_arena_first_win',
        below: () => {
          meta.arenaWins = 0;
          meta.arena2v2Wins = 0;
        },
        at: () => {
          meta.arena2v2Wins = 1; // either bracket counts
        },
      },
    ];
    for (const c of cases) {
      c.below();
      sim.ctx.markDeedsDirty(meta.entityId);
      sim.tick();
      expect(meta.deedsEarned.has(c.deedId), `${c.deedId} below threshold`).toBe(false);
      c.at();
      sim.ctx.markDeedsDirty(meta.entityId);
      sim.tick();
      expect(meta.deedsEarned.has(c.deedId), `${c.deedId} at threshold`).toBe(true);
    }
  });

  it('the discovery-count meters count the set and its poor-quality slice', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Counter', {
      state: {
        level: 1,
        xp: 0,
        copper: 0,
        hp: 30,
        resource: 0,
        pos: { x: 2, z: -2 },
        facing: 0,
        equipment: {},
        inventory: [],
        questLog: [],
        questsDone: [],
      },
    });
    const meta = sim.players.get(pid)!;
    // col_junk_drawer needs TEN DISTINCT poor-quality discoveries: nine stay short.
    const junk = Object.keys(ITEMS)
      .filter((id) => ITEMS[id].quality === 'poor')
      .slice(0, 10);
    expect(junk.length).toBe(10);
    for (const id of junk.slice(0, 9)) markItemDiscovered(sim.ctx, meta, id);
    sim.tick();
    expect(meta.deedsEarned.has('col_junk_drawer')).toBe(false);
    markItemDiscovered(sim.ctx, meta, junk[9]);
    sim.tick();
    expect(meta.deedsEarned.has('col_junk_drawer')).toBe(true);
    // col_discovery_25 counts the whole ledger: top it up to 24 then 25.
    const commons = Object.keys(ITEMS)
      .filter((id) => ITEMS[id].quality !== 'poor')
      .slice(0, 15);
    for (const id of commons.slice(0, 24 - meta.deedStats.itemsDiscovered.size)) {
      markItemDiscovered(sim.ctx, meta, id);
    }
    sim.tick();
    expect(meta.deedStats.itemsDiscovered.size).toBe(24);
    expect(meta.deedsEarned.has('col_discovery_25')).toBe(false);
    markItemDiscovered(sim.ctx, meta, commons[14]);
    sim.tick();
    expect(meta.deedsEarned.has('col_discovery_25')).toBe(true);
  });

  it('arenaRankedWins counts the 1v1 win arm; arenaRankedMatches counts each of its four arms', () => {
    // The either-bracket win meter above is exercised only through arena2v2Wins;
    // pin the 1v1-only arm (arenaWins alone, arena2v2Wins staying 0) so a resolver
    // that dropped the 1v1 term would turn this red.
    const winArm = makeSim();
    const wm = primary(winArm).meta;
    wm.arenaWins = 1;
    winArm.ctx.markDeedsDirty(wm.entityId);
    winArm.tick();
    expect(wm.deedsEarned.has('pvp_arena_first_win')).toBe(true);

    // arenaRankedMatches sums wins AND losses in BOTH brackets: each arm alone
    // pushes the meter to 1 and grants the first-match deed (fresh sim per arm so
    // the sticky grant never masks a dropped term).
    for (const arm of ['arenaWins', 'arenaLosses', 'arena2v2Wins', 'arena2v2Losses'] as const) {
      const sim = makeSim();
      const meta = primary(sim).meta;
      meta[arm] = 1;
      sim.ctx.markDeedsDirty(meta.entityId);
      sim.tick();
      expect(meta.deedsEarned.has('pvp_arena_first_match'), arm).toBe(true);
    }
  });
});

describe('flag triggers (one negative and one positive per predicate)', () => {
  it('talent, guild, equipment, skin, heroic-circuit, companion, and era flags all gate correctly', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const check = (deedId: string, expected: boolean, label: string) => {
      sim.ctx.markDeedsDirty(meta.entityId);
      sim.tick();
      expect(meta.deedsEarned.has(deedId), label).toBe(expected);
    };
    // talentSpecChosen
    check('prog_specialized', false, 'no spec chosen yet');
    meta.talents.spec = 'arms';
    check('prog_specialized', true, 'spec chosen');
    // talentCapstone: a lower row does nothing; selecting the level-20 row grants.
    meta.talents.rows = { 5: 'war_row_double_charge' };
    check('prog_deep_roots', false, 'lower-row choice');
    meta.talents.rows = { 20: 'war_row_colossal_might' };
    check('prog_deep_roots', true, 'final-row choice');
    // guildMember (server-stamped entity field)
    check('soc_guild_joined', false, 'guildless');
    sim.setPlayerGuild(meta.entityId, 'The Levy');
    check('soc_guild_joined', true, 'guild stamped');
    // allEquipSlotsFilled: ten of eleven is not enough
    meta.equipment = {
      mainhand: 'worn_sword',
      helmet: 'worn_sword',
      neck: 'worn_sword',
      shoulder: 'worn_sword',
      chest: 'worn_sword',
      waist: 'worn_sword',
      legs: 'worn_sword',
      gloves: 'worn_sword',
      feet: 'worn_sword',
      ring1: 'worn_sword',
    };
    check('col_all_slots', false, 'ring2 empty');
    meta.equipment.ring2 = 'worn_sword';
    check('col_all_slots', true, 'all eleven filled');
    // nonDefaultSkin
    check('col_true_colors', false, 'default skin');
    meta.skin = 3;
    check('col_true_colors', true, 'alternate skin');
    // heroicMarkCircuit: three of four heroics is not a circuit
    meta.heroicDaily = {
      date: '2026-07-08',
      marked: new Set(['hollow_crypt', 'sunken_bastion', 'drowned_temple']),
    };
    check('dgn_mark_circuit', false, 'three marked');
    meta.heroicDaily.marked.add('gravewyrm_sanctum');
    check('dgn_mark_circuit', true, 'all four marked');
    // companionsBothMax: one maxed companion is not both
    meta.companionUpgrades = { companion_tessa: 3, companion_edda: 2 };
    check('dlv_companions_both', false, 'edda at rank 2');
    meta.companionUpgrades.companion_edda = 3;
    check('dlv_companions_both', true, 'both at rank 3');
    // firstEraCap rides the level while the launch era is current
    expect(meta.deedsEarned.has('feat_era_cap')).toBe(false);
    e.level = MAX_LEVEL;
    check('feat_era_cap', true, 'capped in the first era');
  });
});

describe('fixpoint across the authored order', () => {
  it('a chapter meta whose deed dependency sits LATER in DEED_ORDER still lands in one evaluation', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    // chr_vale_chapter_i (chronicles) requires exp_vale_wayfarer, which is
    // authored AFTER it in DEED_ORDER, so a single forward pass cannot grant
    // the chapter: only the fixpoint re-iteration can.
    const chapter = DEEDS.chr_vale_chapter_i.trigger;
    if (chapter.kind !== 'meta') throw new Error('fixture drift');
    expect(DEED_ORDER.indexOf('exp_vale_wayfarer') > DEED_ORDER.indexOf('chr_vale_chapter_i')).toBe(
      true,
    );
    for (const q of chapter.questIds ?? []) meta.questsDone.add(q);
    for (const dep of chapter.deedIds) {
      const t = DEEDS[dep].trigger;
      if (t.kind === 'visits') for (const mark of t.markIds) markVisited(sim.ctx, meta, mark);
      else if (t.kind === 'visit') markVisited(sim.ctx, meta, t.markId);
      else grantDeed(sim.ctx, meta, dep);
    }
    evaluateDeedsFor(sim.ctx, meta, e, false);
    expect(meta.deedsEarned.has('exp_vale_wayfarer')).toBe(true);
    expect(meta.deedsEarned.has('chr_vale_chapter_i')).toBe(true);
  });
});

describe('bounded sets on load', () => {
  it('restoreDeedStats drops marks outside the authored namespaces and unknown item ids', () => {
    const stats = restoreDeedStats({
      itemsDiscovered: ['glimmerfin_koi', 'not_a_real_item'],
      visited: ['poi:eastbrook_vale:eastbrook', 'garbage', 'evil:namespace'],
    });
    expect([...stats.itemsDiscovered]).toEqual(['glimmerfin_koi']);
    expect([...stats.visited]).toEqual(['poi:eastbrook_vale:eastbrook']);
  });
});

describe('site wiring (real modules, not direct bumps)', () => {
  it('a decided duel bumps duelsWon and duelsLost through endDuel', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('warrior', 'Rival');
    const duel = { a, b, state: 'active' as const, timer: 0 };
    duelMod.endDuel(sim.ctx, duel, a);
    const metaA = sim.players.get(a)!;
    const metaB = sim.players.get(b)!;
    expect(metaA.deedStats.counters.duelsWon).toBe(1);
    expect(metaA.deedStats.counters.duelsLost).toBe(0);
    expect(metaB.deedStats.counters.duelsLost).toBe(1);
    sim.tick();
    expect(metaA.deedsEarned.has('pvp_duel_first_win')).toBe(true);
    expect(metaB.deedsEarned.has('pvp_duel_grace')).toBe(true);
    // An undecided duel counts nothing.
    const c = sim.addPlayer('warrior', 'Bystander');
    duelMod.endDuel(sim.ctx, { a, b: c, state: 'active', timer: 0 }, null);
    expect(sim.players.get(c)!.deedStats.counters.duelsLost).toBe(0);
  });

  it('a duel finisher through dealDamage counts the clamped terminal hit and its crit', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('warrior', 'Rival');
    const duel = { a, b, state: 'active' as const, timer: 0 };
    sim.ctx.duels.set(a, duel);
    sim.ctx.duels.set(b, duel);
    const attacker = sim.entities.get(a)!;
    const victim = sim.entities.get(b)!;
    const metaA = sim.players.get(a)!;

    // A nonlethal hit takes the fall-through path and counts as before.
    dealDamage(sim.ctx, attacker, victim, 10, false, 'physical', null, 'hit');
    expect(victim.hp).toBeGreaterThan(1);
    expect(metaA.deedStats.counters.damageDealt).toBe(10);
    expect(metaA.deedStats.counters.crits).toBe(0);

    // The finisher clamps to leave the victim at 1 hp and ends the duel; the
    // clamped amount and the crit must still land on the deed counters.
    const clamped = victim.hp - 1;
    dealDamage(sim.ctx, attacker, victim, victim.hp + 500, true, 'physical', null, 'hit');
    expect(victim.hp).toBe(1);
    expect(sim.ctx.duels.has(a)).toBe(false);
    expect(metaA.deedStats.counters.damageDealt).toBe(10 + clamped);
    expect(metaA.deedStats.counters.crits).toBe(1);
  });

  it('a ranked-arena elimination through dealDamage counts the terminal hit beside the death', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('warrior', 'Gladiator');
    const match: ArenaMatch = {
      id: 1,
      format: '1v1',
      teamA: [a],
      teamB: [b],
      slot: 0,
      state: 'active',
      timer: 0,
      returns: new Map(),
      ratingA: 1500,
      ratingB: 1500,
      defeated: new Set(),
    };
    sim.ctx.arenaMatches.set(a, match);
    sim.ctx.arenaMatches.set(b, match);
    const attacker = sim.entities.get(a)!;
    const victim = sim.entities.get(b)!;
    const metaA = sim.players.get(a)!;
    const metaB = sim.players.get(b)!;

    const clamped = victim.hp; // the elimination clamps overkill to remaining hp
    dealDamage(sim.ctx, attacker, victim, victim.hp + 500, true, 'physical', null, 'hit');
    expect(victim.dead).toBe(true);
    expect(metaB.deedStats.counters.deaths).toBe(1); // victim accounting unchanged
    expect(metaA.deedStats.counters.damageDealt).toBe(clamped);
    expect(metaA.deedStats.counters.crits).toBe(1);
  });

  it('a Protect Yumi player-down through dealDamage counts the clamped terminal hit and its crit', () => {
    const { sim, match } = startYumiBout();
    const killerPid = match.teamA[0];
    const victimPid = match.teamB[0];
    const attacker = sim.entities.get(killerPid)!;
    const victim = sim.entities.get(victimPid)!;
    const killerMeta = sim.players.get(killerPid)!;
    const dmgBefore = killerMeta.deedStats.counters.damageDealt;
    const critsBefore = killerMeta.deedStats.counters.crits;
    const sessionDmgBefore = killerMeta.counters.damageDealt;

    // The terminal down clamps overkill to the victim's remaining hp, benches
    // them on the yumi respawn timer (never the permanent ranked death), and
    // the clamped hit plus its crit still land on the attacker's deed counters.
    const clamped = victim.hp;
    dealDamage(sim.ctx, attacker, victim, victim.hp + 500, true, 'physical', null, 'hit');
    expect(match.yumi!.respawn.has(victimPid)).toBe(true);
    expect(victim.hp).toBe(0);
    expect(victim.dead).toBe(true);
    expect(killerMeta.deedStats.counters.damageDealt).toBe(dmgBefore + clamped);
    expect(killerMeta.deedStats.counters.crits).toBe(critsBefore + 1);
    // The deliberate divergence: the release-owned session RewardCounters do
    // NOT count a terminal PvP hit. The arm returns before the session damage
    // site, so only the deed ledger above records the clamped blow.
    expect(killerMeta.counters.damageDealt).toBe(sessionDmgBefore);
  });

  it('a Fiesta takedown through dealDamage counts the clamped terminal hit and its crit', () => {
    const { sim, match } = startFiestaBout();
    const killerPid = match.teamA[0]; // team A: the takedown scores on scoreA
    const victimPid = match.teamB[0];
    const attacker = sim.entities.get(killerPid)!;
    const victim = sim.entities.get(victimPid)!;
    const killerMeta = sim.players.get(killerPid)!;
    const scoreBefore = match.fiesta!.scoreA;
    const dmgBefore = killerMeta.deedStats.counters.damageDealt;
    const critsBefore = killerMeta.deedStats.counters.crits;

    // The takedown scores the point and benches the victim on the fiesta
    // respawn timer (never a real death); the clamped hit plus its crit still
    // land on the attacker's deed counters.
    const clamped = victim.hp;
    dealDamage(sim.ctx, attacker, victim, victim.hp + 500, true, 'physical', null, 'hit');
    expect(match.fiesta!.scoreA).toBe(scoreBefore + 1);
    expect(match.fiesta!.respawn.has(victimPid)).toBe(true);
    expect(victim.hp).toBe(0);
    expect(killerMeta.deedStats.counters.damageDealt).toBe(dmgBefore + clamped);
    expect(killerMeta.deedStats.counters.crits).toBe(critsBefore + 1);
  });

  it('a hit on the Protect Yumi cat routes to the cat arm and stays out of the deed ledger', () => {
    const { sim, match } = startYumiBout();
    const attacker = sim.entities.get(match.teamA[0])!;
    const cat = sim.entities.get(match.yumi!.yumiB)!; // team B's objective cat (a mob)
    const killerMeta = sim.players.get(match.teamA[0])!;
    const dmgBefore = killerMeta.deedStats.counters.damageDealt;
    const critsBefore = killerMeta.deedStats.counters.crits;
    const catHpBefore = cat.hp;

    // The cat's damage routes through yumiCatDamaged (the objective-hp arm),
    // which returns before the shared deed site: the hit lands on the cat but
    // is deliberately outside the deed ledger, so it bumps neither counter.
    dealDamage(sim.ctx, attacker, cat, 100, true, 'physical', null, 'hit');
    expect(cat.hp).toBeLessThan(catHpBefore);
    expect(killerMeta.deedStats.counters.damageDealt).toBe(dmgBefore);
    expect(killerMeta.deedStats.counters.crits).toBe(critsBefore);
  });

  it('forming a party bumps partiesJoined for inviter and accepter through partyAccept', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('warrior', 'Friend');
    sim.ctx.partyInvite(b, a);
    sim.partyAccept(b);
    expect(sim.players.get(a)!.deedStats.counters.partiesJoined).toBe(1);
    expect(sim.players.get(b)!.deedStats.counters.partiesJoined).toBe(1);
    sim.tick();
    expect(sim.players.get(b)!.deedsEarned.has('soc_first_party')).toBe(true);
  });

  it('fullPartyDungeonClears needs all five roster members in the kill-credit snapshot', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const others = ['Ana', 'Bern', 'Cato', 'Dita'].map((n) => sim.addPlayer('warrior', n));
    for (const pid of others) {
      sim.ctx.partyInvite(pid, a);
      sim.partyAccept(pid);
    }
    const metas = [a, ...others].map((pid) => sim.players.get(pid)!);
    const boss = { templateId: 'morthen' } as Entity;

    // Four members parked out of XP range: the roster is five but the
    // participating snapshot is one, so the full-party stat must not bump.
    onDungeonFinalBossKilledForDeeds(sim.ctx, boss, undefined, [metas[0]]);
    expect(metas[0].deedStats.counters.fullPartyDungeonClears).toBe(0);
    expect(metas[0].deedStats.dungeonClears.hollow_crypt).toBe(1); // the clear itself counts

    // All five in the snapshot: every member records the full-party clear.
    onDungeonFinalBossKilledForDeeds(sim.ctx, boss, undefined, metas);
    for (const m of metas) expect(m.deedStats.counters.fullPartyDungeonClears).toBe(1);
    sim.tick();
    for (const m of metas) expect(m.deedsEarned.has('soc_full_house')).toBe(true);
  });
});

describe('active title selection (setActiveTitle)', () => {
  it('accepts an earned title-reward deed and stamps meta AND entity together', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    grantDeed(sim.ctx, meta, 'prog_veteran'); // reward: title "Veteran"
    sim.setActiveTitle('prog_veteran');
    // both read paths agree within the same tick: no tick() between set and read
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');
  });

  it('silently rejects an unearned deed, an earned rewardless deed, an earned border deed, and an unknown id', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran');

    // unearned title deed (prog_champion is a real title deed, not earned here)
    sim.setActiveTitle('prog_champion');
    expect(meta.activeTitle).toBe('prog_veteran'); // prior selection untouched
    expect(e.title).toBe('prog_veteran');

    // earned, but carries no reward at all
    grantDeed(sim.ctx, meta, 'prog_first_steps');
    sim.setActiveTitle('prog_first_steps');
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');

    // earned, but the reward is a border, not a title
    grantDeed(sim.ctx, meta, 'prog_prestige_10');
    sim.setActiveTitle('prog_prestige_10');
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');

    // unknown/deleted id
    sim.setActiveTitle('prog_not_a_deed');
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');

    // content drift: EARNED on an older content version but since removed
    // from DEEDS (the earned-map hit must not bypass the catalog check)
    meta.deedsEarned.set('zz_removed_by_content_patch', '2025-01-01');
    sim.setActiveTitle('zz_removed_by_content_patch');
    expect(meta.activeTitle).toBe('prog_veteran');
    expect(e.title).toBe('prog_veteran');
  });

  it('the offline leaderboard row carries the selected title (a deed id, null untitled)', async () => {
    // The one-cache server fill is pinned in tests/server/title_reads.test.ts;
    // this is the OFFLINE host's arm of the shared LeaderboardEntry shape.
    const sim = makeSim();
    const { meta } = primary(sim);
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran');
    const titled = await sim.leaderboard();
    expect(titled.leaders.find((r) => r.name === meta.name)?.title).toBe('prog_veteran');
    sim.setActiveTitle(null);
    const cleared = await sim.leaderboard();
    expect(cleared.leaders.find((r) => r.name === meta.name)?.title).toBeNull();
  });

  it('null clears both the meta field and the entity wire field', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran');
    sim.setActiveTitle(null);
    expect(meta.activeTitle).toBeNull();
    expect(e.title).toBeNull();
  });

  it('a saved title round-trips through save/load onto meta and the spawned entity', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    grantDeed(sim.ctx, meta, 'prog_veteran');
    sim.setActiveTitle('prog_veteran');
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.activeTitle).toBe('prog_veteran');

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Loaded', { state });
    expect(sim2.players.get(pid)!.activeTitle).toBe('prog_veteran');
    expect(sim2.entities.get(pid)!.title).toBe('prog_veteran');
  });

  it('a save written before titles existed (no activeTitle key) loads as untitled', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    grantDeed(sim.ctx, meta, 'prog_veteran');
    const state = sim.serializeCharacter(sim.playerId)!;
    // activeTitle is optional on CharacterState precisely so old saves load;
    // the serializer also omits it when null, and this pins that both forms
    // (absent key, never-set) land untitled
    const legacy: CharacterState = { ...state };
    delete legacy.activeTitle;

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Legacy', { state: legacy });
    expect(sim2.players.get(pid)!.activeTitle).toBeNull();
    expect(sim2.entities.get(pid)!.title).toBeNull();
    // the earned record itself still loads
    expect(sim2.players.get(pid)!.deedsEarned.has('prog_veteran')).toBe(true);
  });

  it('a stale saved title (earned record lost) loads as untitled instead of dangling', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // A NON-milestone title deed: a milestone id would re-enter the earned map
    // through the legacy unlockedMilestones union and defeat the staleness.
    grantDeed(sim.ctx, meta, 'dgn_korzul_flawless'); // title "Wyrmfeller", manual trigger
    sim.setActiveTitle('dgn_korzul_flawless');
    const state = sim.serializeCharacter(sim.playerId)!;
    const tampered: CharacterState = { ...state, deeds: {} }; // the earned record vanished

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Stale', { state: tampered });
    expect(sim2.players.get(pid)!.activeTitle).toBeNull();
    expect(sim2.entities.get(pid)!.title).toBeNull();
  });
});

describe('deedsRarity (offline facet arm)', () => {
  it('always resolves null: a sandbox has no population to aggregate', async () => {
    const sim = makeSim();
    await expect(sim.deedsRarity()).resolves.toBeNull();
  });
});

// Live-site wiring: each test below drives the REAL game site (not a hand
// bumped counter plus markDeedsDirty) and asserts the deed lands in the same
// run. This is the anti-masking suite: persisted state (questsDone,
// proficiency, delveClears, damage counters) would still retro-grant the deed
// at the NEXT login, so a broken live site keeps state-poke tests green while
// the in-the-moment unlock silently disappears; these tests red instead.
describe('live sites grant in the same run (retro cannot mask a broken site)', () => {
  it('quest turn-in: turnInQuestCore itself makes the quest deed land in-tick', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const quest = QUESTS.q_prof_intro; // prog_callused_hands, {kind:'quest'}
    expect(quest).toBeDefined();
    meta.questLog.set('q_prof_intro', { questId: 'q_prof_intro', counts: [5], state: 'ready' });
    // The live turn-in path
    // carries two independent full marks (grantXp marks on every xp grant,
    // and turnInQuestCore marks explicitly for xp-less future quests); this
    // test guards the path as a whole, so it reds only when the in-the-moment
    // grant is actually broken, never on a refactor that keeps either mark.
    expect(meta.deedsEarned.has('prog_callused_hands')).toBe(false);
    turnInQuestCore(sim.ctx, 'q_prof_intro', quest, meta);
    expect(meta.questsDone.has('q_prof_intro')).toBe(true);
    expect(meta.deedsEarned.has('prog_callused_hands')).toBe(false); // grants at the tick tail
    sim.tick();
    expect(meta.deedsEarned.has('prog_callused_hands')).toBe(true);
  });

  it('gathering: a queued grant drains in the tick and the proficiency deed lands in-tick', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    meta.gatheringProficiency.mining = 99; // one point shy; no dirty mark on purpose
    queueGatheringGrant(meta, 'mining', 1);
    sim.tick();
    expect(meta.gatheringProficiency.mining).toBe(100);
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(true);
  });

  it('delve clear: the live site call makes the clear deed land in-tick', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // The caller contract (delves/runs.ts): the counter bump precedes the site call.
    meta.delveClears['collapsed_reliquary:normal'] = 1;
    onDelveClearForDeeds(sim.ctx, meta, { tierId: 'normal' });
    sim.tick();
    expect(meta.deedsEarned.has('dlv_reliquary')).toBe(true);
    expect(meta.deedsEarned.has('dlv_solo_heroic')).toBe(false); // normal tier: no solo grant
  });

  it('damage: onDamageDealtForDeeds feeds the lifetime counter and the deed lands in-tick', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const mob = [...sim.entities.values()].find(
      (x) => x.kind === 'mob' && MOBS[x.templateId]?.dummy !== true,
    ) as Entity;
    expect(mob).toBeDefined();
    onDamageDealtForDeeds(sim.ctx, e, mob, 500_000, false, 'hit');
    sim.tick();
    expect(meta.deedStats.counters.damageDealt).toBe(500_000);
    expect(meta.deedsEarned.has('cmb_heavy_hitter')).toBe(true);
  });

  // A valid six-row warrior build: a spec and one choice in every canonical row,
  // including the level-20 capstone, so it satisfies the spec, capstone,
  // first-choice, and full-build deeds at once.
  const warriorSpecCapstoneBuild = (): TalentAllocation => ({
    ...emptyAllocation(),
    spec: 'arms',
    rows: {
      5: 'war_row_double_charge',
      8: 'war_row_die_by_the_sword',
      11: 'war_row_storm_bolt',
      14: 'war_row_blood_offering',
      17: 'war_row_avatar',
      20: 'war_row_colossal_might',
    },
  });

  it('saveLoadout: applying a staged spec+capstone build makes the talent deeds land in-tick', () => {
    const sim = makeSim();
    sim.setPlayerLevel(MAX_LEVEL); // all six rows unlocked
    const { meta } = primary(sim);
    // Drain the setPlayerLevel dirty mark on its own tick so the final tick's
    // only mark can come from saveLoadout itself.
    sim.tick();
    expect(meta.deedsEarned.has('prog_talented')).toBe(false);
    expect(meta.deedsEarned.has('prog_specialized')).toBe(false);
    expect(meta.deedsEarned.has('prog_deep_roots')).toBe(false);
    expect(meta.deedsEarned.has('prog_full_build')).toBe(false);
    // The UI Save flow always passes the staged allocation, so this applies the
    // build as its only effect.
    expect(sim.saveLoadout('Build', [], warriorSpecCapstoneBuild())).toBeGreaterThanOrEqual(0);
    expect(meta.talents.spec).toBe('arms'); // the staged build was applied
    sim.tick();
    expect(meta.deedsEarned.has('prog_talented')).toBe(true);
    expect(meta.deedsEarned.has('prog_specialized')).toBe(true);
    expect(meta.deedsEarned.has('prog_deep_roots')).toBe(true);
    expect(meta.deedsEarned.has('prog_full_build')).toBe(true);
  });

  it('deleteLoadout: auto-applying the next loadout on delete makes its talent deeds land in-tick', () => {
    const sim = makeSim();
    sim.setPlayerLevel(MAX_LEVEL);
    const { meta } = primary(sim);
    const plainBuild: TalentAllocation = {
      ...emptyAllocation(),
      spec: null,
      rows: { 5: 'war_row_pursuit' },
    };
    // Save the spec+capstone build first (slot 0), then a spec-less build (slot
    // 1) which becomes active and live. No tick runs between the two saves, so
    // the live state settles on the spec-less build.
    expect(sim.saveLoadout('Spec', [], warriorSpecCapstoneBuild())).toBe(0);
    expect(sim.saveLoadout('Plain', [], plainBuild)).toBe(1);
    // Drain the save marks; the live build is spec-less, so the spec deeds stay
    // unearned. This isolates the delete auto-apply as the only remaining site.
    sim.tick();
    expect(meta.talents.spec).toBeNull();
    expect(meta.deedsEarned.has('prog_specialized')).toBe(false);
    expect(meta.deedsEarned.has('prog_deep_roots')).toBe(false);
    // Deleting the active spec-less loadout auto-applies slot 0 (the
    // spec+capstone build), which must re-check the talent deeds.
    expect(sim.deleteLoadout(1)).toBe(true);
    expect(meta.talents.spec).toBe('arms'); // slot 0 auto-applied
    sim.tick();
    expect(meta.deedsEarned.has('prog_specialized')).toBe(true);
    expect(meta.deedsEarned.has('prog_deep_roots')).toBe(true);
  });

  it('potion drink: a Battlefield Experience trickle crossing 75 skill makes the craft deed land in-tick', () => {
    const sim = makeSim();
    sim.setPlayerLevel(MAX_LEVEL); // MAX_LEVEL so updateRested never re-marks the player
    const { meta, e } = primary(sim);
    meta.archetype.activeArchetype = 'alchemy'; // the craft minor_healing_potion belongs to
    meta.craftSkills.alchemy = 75 - BATTLEFIELD_XP_TRICKLE; // one trickle shy of the threshold
    // A self-signed rare instance: the only shape the trickle credits (signer,
    // rare-or-better quality, active-specialty match).
    sim.addItemInstance(
      'minor_healing_potion',
      { signer: meta.name, rolled: { quality: 'rare' } },
      meta.entityId,
    );
    // Drain the setPlayerLevel + item-discovery marks so the final tick's only
    // mark can come from the drink itself; the skill is still below 75 here.
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(false);
    e.hp = 1; // so the potion has something to restore and useItem does not deny
    sim.useItem('minor_healing_potion', meta.entityId);
    expect(meta.craftSkills.alchemy).toBe(75); // the trickle crossed the threshold
    sim.tick();
    expect(meta.deedsEarned.has('prog_craft_specialist')).toBe(true);
  });
});

describe('exploration poi identity (marks key on the stable id, not the label)', () => {
  it('a visit marks the id form, never the label form', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const poi = ZONES.find((z) => z.id === 'eastbrook_vale')!.pois.find(
      (p) => p.id === 'eastbrook',
    )!;
    e.pos.x = poi.x;
    e.pos.z = poi.z;
    e.prevPos = { ...e.pos };
    sim.tickCount = 20; // land the 1 Hz proximity sweep
    updateDeeds(sim.ctx);
    // The mark is the id form; the display label (a genuinely different string) is
    // never written, so a label copy edit cannot strand the visit.
    expect(meta.deedStats.visited.has('poi:eastbrook_vale:eastbrook')).toBe(true);
    expect(meta.deedStats.visited.has(`poi:eastbrook_vale:${poi.label}`)).toBe(false);
    expect(poi.id).not.toBe(poi.label);
  });

  it('visiting every named place in a zone unlocks its wayfarer deed end-to-end', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const zone = ZONES.find((z) => z.id === 'eastbrook_vale')!;
    for (const poi of zone.pois) {
      e.pos.x = poi.x;
      e.pos.z = poi.z;
      e.prevPos = { ...e.pos };
      sim.tickCount = 20;
      updateDeeds(sim.ctx);
    }
    expect(meta.deedsEarned.has('exp_vale_wayfarer')).toBe(true);
  });
});

describe('trade completion counts only non-empty trades (soc_first_trade)', () => {
  it('an empty double-confirm does not count; a one-item trade unlocks it for both', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    ea.pos.x = 0;
    ea.pos.z = -40;
    ea.prevPos = { ...ea.pos };
    eb.pos.x = 2;
    eb.pos.z = -40;
    eb.prevPos = { ...eb.pos };
    const metaA = sim.players.get(a)!;
    const metaB = sim.players.get(b)!;
    // Empty double-confirm: both sides offer nothing. The trade still completes
    // (and emits tradeDone), but it is not a trade for deed purposes.
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    sim.tick();
    expect(metaA.deedStats.counters.tradesCompleted).toBe(0);
    expect(metaB.deedStats.counters.tradesCompleted).toBe(0);
    expect(metaA.deedsEarned.has('soc_first_trade')).toBe(false);
    expect(metaB.deedsEarned.has('soc_first_trade')).toBe(false);
    // A one-item trade counts for both sides and unlocks the deed for both.
    sim.addItem('wolf_fang', 1, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 1 }], 0, a);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    sim.tick();
    expect(metaA.deedStats.counters.tradesCompleted).toBe(1);
    expect(metaB.deedStats.counters.tradesCompleted).toBe(1);
    expect(metaA.deedsEarned.has('soc_first_trade')).toBe(true);
    expect(metaB.deedsEarned.has('soc_first_trade')).toBe(true);
  });

  it('a copper-only offer from the receiver side counts and unlocks it for both', () => {
    // The nonEmpty guard ORs four dimensions (items and copper, each side).
    // This drives the receiver-copper arm with NO items on either side, so a
    // regression to items-only (or initiator-only) reds here.
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    ea.pos.x = 0;
    ea.pos.z = -40;
    ea.prevPos = { ...ea.pos };
    eb.pos.x = 2;
    eb.pos.z = -40;
    eb.prevPos = { ...eb.pos };
    const metaA = sim.players.get(a)!;
    const metaB = sim.players.get(b)!;
    metaB.copper = 5;
    const copperABefore = metaA.copper;
    sim.tradeRequest(b, a); // a initiates: the session's receiver side is b
    sim.tradeAccept(b);
    sim.tradeSetOffer([], 1, b); // the receiver offers 1 copper, no items anywhere
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    sim.tick();
    // The copper actually moved: a real transfer, not an empty handshake.
    expect(metaA.copper).toBe(copperABefore + 1);
    expect(metaB.copper).toBe(4);
    expect(metaA.deedStats.counters.tradesCompleted).toBe(1);
    expect(metaB.deedStats.counters.tradesCompleted).toBe(1);
    expect(metaA.deedsEarned.has('soc_first_trade')).toBe(true);
    expect(metaB.deedsEarned.has('soc_first_trade')).toBe(true);
  });
});
