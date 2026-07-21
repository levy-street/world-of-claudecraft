// The keyed dirty-mark index behind the tick-tail deed evaluator: a narrow
// mark (a damage counter bump, an item discovery, a visited mark, a grant)
// re-checks only the deeds reading that input, and MUST grant on the same
// tick a full pass would have. These tests pin the completeness contract
// (every trigger kind that reads a narrow site's state sits in that site's
// bucket), the mark-escalation rules (a full-pass mark always wins over
// narrow keys, in both orders), the fixpoint widening (a grant enables meta
// deeds within the same pass), and the scheduler-resolved witness sweep.

import { describe, expect, it } from 'vitest';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { emptyAllocation } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import {
  bumpDeedStat,
  checkDeedTrigger,
  deedIdsForDirtyKey,
  freshDeedStats,
  grantDeed,
  METER_DIRTY_KEYS,
  markDeedsDirty,
  markItemDiscovered,
  markVisited,
  narrowKeysForTrigger,
} from '../src/sim/deeds';
import { createMob } from '../src/sim/entity';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { DeedMeterId } from '../src/sim/types';

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function primary(sim: Sim) {
  const meta = sim.players.get(sim.playerId)!;
  const e = sim.entities.get(sim.playerId)!;
  return { meta, e };
}

describe('bucket completeness (the contract narrow marks rely on)', () => {
  // Independent restatement of which trigger kinds read each narrow site's
  // state. Deliberately NOT derived from narrowKeysForTrigger, so a deed
  // slipping out of its bucket cannot hide behind a shared helper.
  it('every deed reading a narrow input sits in that input key bucket', () => {
    for (const id of DEED_ORDER) {
      const trigger = DEEDS[id].trigger;
      switch (trigger.kind) {
        case 'stat':
          expect(deedIdsForDirtyKey(`stat:${trigger.stat}`)).toContain(id);
          break;
        case 'collectItems':
          expect(deedIdsForDirtyKey('items')).toContain(id);
          break;
        case 'visit':
        case 'visits':
          expect(deedIdsForDirtyKey('visited')).toContain(id);
          break;
        case 'meta':
          expect(deedIdsForDirtyKey('earned')).toContain(id);
          break;
        case 'dungeonClears':
          expect(deedIdsForDirtyKey('dungeonClears')).toContain(id);
          break;
        case 'meter':
          if (
            trigger.meter === 'itemsDiscoveredCount' ||
            trigger.meter === 'poorItemsDiscoveredCount'
          ) {
            expect(deedIdsForDirtyKey('items')).toContain(id);
          }
          break;
        default:
          break;
      }
    }
  });

  it('buckets preserve catalog order and never hold manual deeds', () => {
    const orderIndex = new Map(DEED_ORDER.map((id, i) => [id, i]));
    for (const key of ['items', 'visited', 'earned', 'dungeonClears', 'stat:damageDealt']) {
      const bucket = deedIdsForDirtyKey(key);
      for (const id of bucket) expect(DEEDS[id].trigger.kind).not.toBe('manual');
      const positions = bucket.map((id) => orderIndex.get(id) ?? -1);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it('any meter reading the deedStats ledgers declares its narrow key', () => {
    // METER_DIRTY_KEYS is hand-maintained beside the METERS readers, so a
    // future meter that reads narrow-marked state but stays mapped to []
    // would grant late with no red anywhere. Instrument the ledger object,
    // run every meter's reader through the real trigger check, and require
    // the declared keys to match what the reader actually touched.
    for (const meter of Object.keys(METER_DIRTY_KEYS) as DeedMeterId[]) {
      const touched = new Set<string>();
      const stats = freshDeedStats();
      const statsProxy = new Proxy(stats, {
        get(target, prop) {
          touched.add(String(prop));
          return target[prop as keyof typeof target];
        },
      });
      const meta = {
        prestigeRank: 0,
        talents: emptyAllocation(),
        arenaWins: 0,
        arenaLosses: 0,
        arena2v2Wins: 0,
        arena2v2Losses: 0,
        vcupWins: 0,
        vcupGuildWins: 0,
        bank: { purchasedSlots: 0 },
        townFocus: {},
        delveLoreUnlocked: new Set<string>(),
        companionUpgrades: {},
        deedStats: statsProxy,
      } as unknown as PlayerMeta;
      checkDeedTrigger(meta, {} as never, { kind: 'meter', meter, amount: 0 });
      if (touched.has('itemsDiscovered')) {
        expect(METER_DIRTY_KEYS[meter]).toContain('items');
      } else {
        // No narrow mark site exists for the other ledgers under 'meter';
        // a reader touching one must extend the key mapping consciously.
        expect(
          touched.has('counters') || touched.has('visited') || touched.has('dungeonClears'),
        ).toBe(false);
      }
    }
  });

  it('every non-manual deed either has a narrow key or is a full-pass kind', () => {
    // The [] kinds are exactly the ones whose inputs mutate at markDeedsDirty
    // sites; pin the list so a NEW trigger kind cannot silently ship without
    // deciding its dirty key.
    const fullPassKinds = new Set([
      'level',
      'lifetimeXp',
      'quest',
      'quests',
      'delveClears',
      'arenaRating',
      'craftSkill',
      'gathering',
      'flag',
      'manual',
    ]);
    for (const id of DEED_ORDER) {
      const trigger = DEEDS[id].trigger;
      const keys = narrowKeysForTrigger(trigger);
      if (keys.length === 0 && trigger.kind !== 'meter') {
        expect(fullPassKinds.has(trigger.kind)).toBe(true);
      }
    }
  });
});

describe('same-tick grant parity for narrow marks', () => {
  it('a damage counter bump crossing a stat threshold grants on that tick', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    const trigger = DEEDS.cmb_heavy_hitter.trigger;
    if (trigger.kind !== 'stat') throw new Error('cmb_heavy_hitter is no longer a stat deed');
    expect(trigger.stat).toBe('damageDealt');
    meta.deedStats.counters.damageDealt = trigger.count - 1;
    bumpDeedStat(sim.ctx, meta, 'damageDealt', 1);
    sim.tick();
    expect(meta.deedsEarned.has('cmb_heavy_hitter')).toBe(true);
  });

  it('an item discovery grants a collectItems deed on that tick', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(DEEDS.col_glimmerfin.trigger.kind).toBe('collectItems');
    markItemDiscovered(sim.ctx, meta, 'glimmerfin_koi');
    sim.tick();
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(true);
  });

  it('two narrow keys in one tick evaluate the ordered union of their buckets', () => {
    // The routine in-play shape: one kill both bumps a damage counter and
    // discovers loot. Both marks land on the same pid in the same tick, so
    // the evaluator takes the multi-key union arm of deedListForKeys, and
    // both deeds must grant on that tick exactly like two full passes would.
    const sim = makeSim();
    const { meta } = primary(sim);
    const trigger = DEEDS.cmb_heavy_hitter.trigger;
    if (trigger.kind !== 'stat') throw new Error('cmb_heavy_hitter is no longer a stat deed');
    meta.deedStats.counters.damageDealt = trigger.count - 1;
    bumpDeedStat(sim.ctx, meta, 'damageDealt', 1);
    markItemDiscovered(sim.ctx, meta, 'glimmerfin_koi');
    sim.tick();
    expect(meta.deedsEarned.has('cmb_heavy_hitter')).toBe(true);
    expect(meta.deedsEarned.has('col_glimmerfin')).toBe(true);
  });

  it('a visited mark grants a visit deed and its meta deed in the SAME pass', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    // chr_peaks_chapter_ii is the meta over three Peaks chronicle deeds plus
    // ten quests; stage everything except chr_peaks_waking_witness, then let
    // the witness mark arrive as a narrow 'visited' mark: the visit deed must
    // grant, and the fixpoint must widen to the earned bucket and grant the
    // chapter on the same tick, exactly like the old full pass.
    const chapter = DEEDS.chr_peaks_chapter_ii.trigger;
    if (chapter.kind !== 'meta') throw new Error('chapter ii is no longer a meta deed');
    for (const dep of chapter.deedIds) {
      if (dep !== 'chr_peaks_waking_witness') grantDeed(sim.ctx, meta, dep);
    }
    for (const q of chapter.questIds ?? []) meta.questsDone.add(q);
    sim.tick(); // settle the staging marks; the chapter must still wait
    expect(meta.deedsEarned.has('chr_peaks_chapter_ii')).toBe(false);
    markVisited(sim.ctx, meta, 'witness:thunzharr_waking_peak');
    sim.tick();
    expect(meta.deedsEarned.has('chr_peaks_waking_witness')).toBe(true);
    expect(meta.deedsEarned.has('chr_peaks_chapter_ii')).toBe(true);
  });
});

describe('mark escalation (a full pass always wins)', () => {
  // The hazard both orders guard: a narrow key must never mask a full-pass
  // request made in the same tick, or a level/flag deed would silently wait
  // for the player's next unrelated full mark.
  it('narrow mark then markDeedsDirty: the full pass still runs', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    bumpDeedStat(sim.ctx, meta, 'dummyDamage', 1); // narrow key first
    e.level = 5; // prog_finding_your_feet becomes true, a full-pass kind
    markDeedsDirty(sim.ctx, sim.playerId);
    sim.tick();
    expect(meta.deedsEarned.has('prog_finding_your_feet')).toBe(true);
  });

  it('markDeedsDirty then narrow mark: the full pass is not narrowed', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    e.level = 5;
    markDeedsDirty(sim.ctx, sim.playerId);
    bumpDeedStat(sim.ctx, meta, 'dummyDamage', 1); // must not downgrade
    sim.tick();
    expect(meta.deedsEarned.has('prog_finding_your_feet')).toBe(true);
  });
});

describe('the scheduler-resolved witness sweep', () => {
  it('a scheduled world boss rise feeds the witness mark within 100 yd', () => {
    const sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      autoEquip: false,
      worldBossAtBoot: true,
    });
    const { meta, e } = primary(sim);
    sim.tick(); // the scheduler spawns Thunzharr on the first tick
    const boss = [...sim.entities.values()].find(
      (ent) => ent.kind === 'mob' && ent.templateId === 'thunzharr_waking_peak' && !ent.dead,
    );
    expect(boss).toBeDefined();
    if (!boss) return;
    // Witness from 85 yd: inside the 100 yd witness radius, far outside the
    // boss's aggro range (standing next to him one-shots a level 1 witness,
    // and the sweep rightly skips the dead).
    e.pos.x = boss.pos.x + 85;
    e.pos.z = boss.pos.z;
    for (let i = 0; i < 21; i++) sim.tick(); // cross a 1 Hz sweep boundary
    expect(meta.deedStats.visited.has('witness:thunzharr_waking_peak')).toBe(true);
  });

  it('a Thunzharr copy staged outside the scheduler is never witnessable', () => {
    // The sweep resolves the boss through the scheduler's tracked ids, so a
    // template copy the scheduler never spawned (test staging, dev tooling)
    // must not feed the witness mark: the deed is about the scheduled rise.
    const sim = makeSim();
    const { meta, e } = primary(sim);
    const copy = createMob(sim.ctx.nextId++, MOBS.thunzharr_waking_peak, 30, {
      x: e.pos.x + 50,
      y: 0,
      z: e.pos.z,
    });
    sim.addEntity(copy);
    for (let i = 0; i < 21; i++) sim.tick();
    expect(copy.dead).toBe(false);
    expect(meta.deedStats.visited.has('witness:thunzharr_waking_peak')).toBe(false);
  });

  it('with no boss up the sweep marks nothing and the POI sweep still runs', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    for (let i = 0; i < 21; i++) sim.tick();
    expect(meta.deedStats.visited.has('witness:thunzharr_waking_peak')).toBe(false);
    // The spawn-square POI mark proves the sweep itself ran (the deeds.test
    // namespace suite pins the same landmark). The mark is poi:<zone.id>:<poi.id>,
    // and the Eastbrook landmark's id is the lowercase slug 'eastbrook' (its
    // display label stays 'Eastbrook').
    expect(meta.deedStats.visited.has('poi:eastbrook_vale:eastbrook')).toBe(true);
  });
});

describe('setPlayerGuild retro-on-first-join (soc_guild_joined)', () => {
  // guildMember is the only deed predicate reading host-stamped entity state
  // (e.guild) hydrated after addPlayer, and the guild name arrives a beat after
  // the retro pass (it lives in the server social DB, not the loaded blob). The
  // first join-time stamp threads retroDeeds so a pre-existing member re-earns
  // soc_guild_joined SILENTLY (the retro summary), not with the live banner;
  // any later membership change is a genuine live join.
  function findGuildJoin(events: ReturnType<Sim['tick']>): { retro?: boolean } | undefined {
    return (events as ReadonlyArray<{ type: string; deedId?: string; retro?: boolean }>).find(
      (e) => e.type === 'deedUnlocked' && e.deedId === 'soc_guild_joined',
    );
  }

  it('the join retro pass leaves an unaffiliated player without soc_guild_joined', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    expect(e.guild).toBe('');
    expect(meta.deedsEarned.has('soc_guild_joined')).toBe(false);
  });

  it('the first join-time stamp (retroDeeds) grants soc_guild_joined silently, retro true', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    expect(meta.deedsEarned.has('soc_guild_joined')).toBe(false);
    sim.setPlayerGuild(sim.playerId, 'The Levy', { retroDeeds: true });
    // The retro evaluate grants synchronously (mirroring the addPlayer retro
    // tail), before any tick; the marks are cleared, so the tick only drains
    // the already-emitted event.
    expect(meta.deedsEarned.has('soc_guild_joined')).toBe(true);
    const ev = findGuildJoin(sim.tick());
    expect(ev).toBeDefined();
    expect(ev?.retro).toBe(true); // the client renders retro as the silent summary
  });

  it('a genuine live join (no retroDeeds) grants soc_guild_joined with no retro flag', () => {
    const sim = makeSim();
    const { meta } = primary(sim);
    sim.setPlayerGuild(sim.playerId, 'The Levy'); // a membership change = live join
    // A live join only MARKS dirty; the tick tail grants it, live.
    expect(meta.deedsEarned.has('soc_guild_joined')).toBe(false);
    const ev = findGuildJoin(sim.tick());
    expect(ev).toBeDefined();
    expect(ev && 'retro' in ev).toBe(false); // live: full banner, no retro flag
    expect(meta.deedsEarned.has('soc_guild_joined')).toBe(true);
  });

  it('retroDeeds is inert unless the guild goes from empty to named (never a re-stamp)', () => {
    const sim = makeSim();
    const { meta, e } = primary(sim);
    sim.setPlayerGuild(sim.playerId, 'The Levy', { retroDeeds: true }); // first stamp: retro
    sim.tick();
    expect(meta.deedsEarned.has('soc_guild_joined')).toBe(true);
    const earnedCount = meta.deedsEarned.size;
    // A later stamp of a different guild is a live membership change; the player
    // is already affiliated, so retroDeeds cannot fire and the deed (already
    // earned) never re-emits.
    sim.setPlayerGuild(sim.playerId, 'Mire Herons', { retroDeeds: true });
    expect(findGuildJoin(sim.tick())).toBeUndefined();
    expect(meta.deedsEarned.size).toBe(earnedCount);
    expect(e.guild).toBe('Mire Herons');
  });
});
