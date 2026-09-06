// Gatherer attribution end to end through a REAL Sim: the identity a player
// joins with, what a real gather actually lands in the bags, what survives a
// save/reload, and the paths that must stay unattributed.
//
// Everything here drives the shipped command surface (addPlayer,
// serializeCharacter, harvestCorpse, the inventory hub) rather than the helper's
// own return value, because the helper being right is not the claim; the claim
// is that the units in a player's bags name the right person and only then.

import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../src/sim/character_state';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { isMaterialItemId } from '../src/sim/material_ids';
import { isPremiumMaterialSource, type MaterialSource } from '../src/sim/material_sources';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot } from '../src/sim/types';
import { completeCorpseHarvest } from './helpers/complete_corpse_harvest';
import { expectDefined } from './helpers/defined';
import { EMPTY_TEST_WORLD } from './sim_shared';

type SimInternals = { entities: Map<number, Entity>; players: Map<number, PlayerMeta> };

const internalsOf = (sim: Sim) => sim as unknown as SimInternals;
const metaOf = (sim: Sim, pid: number): PlayerMeta =>
  expectDefined(internalsOf(sim).players.get(pid));

const OFFLINE_A = { kind: 'offline' as const, id: 'off:device-a:1' };
const OFFLINE_B = { kind: 'offline' as const, id: 'off:device-a:2' };

function bareSim(seed = 11): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function serializedBaseline(): CharacterState {
  const sim = bareSim(101);
  const pid = sim.addPlayer('warrior', 'Baseline');
  return expectDefined(sim.serializeCharacter(pid));
}

/** Every source bucket a player's bags hold for one item, flattened. */
function bucketsFor(sim: Sim, pid: number, itemId: string): readonly MaterialSource[] {
  return metaOf(sim, pid)
    .inventory.filter((slot: InvSlot) => slot.itemId === itemId)
    .flatMap((slot: InvSlot) => (slot.materialSources ?? []).map((entry) => entry.source));
}

/** Units of one item in a player's bags, and units that carry a gatherer. */
function unitCounts(sim: Sim, pid: number, itemId: string): { total: number; attributed: number } {
  let total = 0;
  let attributed = 0;
  for (const slot of metaOf(sim, pid).inventory) {
    if (slot.itemId !== itemId) continue;
    total += slot.count;
    for (const entry of slot.materialSources ?? []) {
      if (entry.source.gatherer !== undefined) attributed += entry.count;
    }
  }
  return { total, attributed };
}

describe('the identity a player joins with', () => {
  it('derives an ONLINE gatherer from the authoritative character id, not from anything the save carries', () => {
    const sim = bareSim();
    // A blob claiming a local identity: the spoof attempt.
    const state = serializedBaseline();
    state.materialGathererIdentity = OFFLINE_B;
    const pid = sim.addPlayer('warrior', 'Ana', {
      characterId: 42,
      state,
    });

    expect(metaOf(sim, pid).gathererIdentity).toEqual({ kind: 'character', id: 42 });
    // ...and the online blob writes nothing back, so it stays byte-equal to a
    // pre-feature save and the server keeps re-supplying the row's own id.
    expect(sim.serializeCharacter(pid)?.materialGathererIdentity).toBeUndefined();
  });

  it('gives two fresh characters of the SAME class and name DISTINCT identities', () => {
    // The collision the host allocator exists to prevent: offline characters are
    // not persisted, so "same class, same name" is ordinary, and a
    // namespace-only or name-derived id would give both one gatherer record.
    const sim = bareSim();
    const first = sim.addPlayer('warrior', 'Ana', { localGathererIdentity: OFFLINE_A });
    const second = sim.addPlayer('warrior', 'Ana', { localGathererIdentity: OFFLINE_B });

    expect(metaOf(sim, first).gathererIdentity).toEqual(OFFLINE_A);
    expect(metaOf(sim, second).gathererIdentity).toEqual(OFFLINE_B);
    expect(metaOf(sim, first).gathererIdentity).not.toEqual(metaOf(sim, second).gathererIdentity);
  });

  it('leaves a bare Sim UNKNOWN rather than inventing attribution from the seed or the entity id', () => {
    const sim = bareSim();
    const pid = sim.addPlayer('warrior', 'Ana');
    expect(metaOf(sim, pid).gathererIdentity).toBeUndefined();
    expect(sim.serializeCharacter(pid)?.materialGathererIdentity).toBeUndefined();

    // Two seeds, two entity ids, one absent identity: nothing here is a source
    // of uniqueness, which is exactly why none of it is used.
    const other = bareSim(999);
    expect(metaOf(other, other.addPlayer('warrior', 'Ana')).gathererIdentity).toBeUndefined();
  });

  it('carries the constructor-minted primary player its host identity', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', gathererIdentity: OFFLINE_A });
    expect(metaOf(sim, sim.playerId).gathererIdentity).toEqual(OFFLINE_A);
  });
});

describe('the persisted local identity round trip', () => {
  it('survives save and reload UNCHANGED, superseding the next session fresh default', () => {
    const first = bareSim();
    const pid = first.addPlayer('warrior', 'Ana', { localGathererIdentity: OFFLINE_A });
    const saved = expectDefined(first.serializeCharacter(pid));
    expect(saved.materialGathererIdentity).toEqual(OFFLINE_A);

    // A new session whose host allocated a DIFFERENT fresh id: the save wins,
    // or this character's already-gathered stock would name a stranger.
    const second = bareSim();
    const reloaded = second.addPlayer('warrior', 'Ana', {
      state: saved,
      localGathererIdentity: OFFLINE_B,
    });
    expect(metaOf(second, reloaded).gathererIdentity).toEqual(OFFLINE_A);
    expect(second.serializeCharacter(reloaded)?.materialGathererIdentity).toEqual(OFFLINE_A);
  });

  it('REFUSES a malformed stored identity before the player is registered', () => {
    const sim = bareSim();
    const before = internalsOf(sim).players.size;
    expect(() =>
      sim.addPlayer('warrior', 'Ana', {
        state: {
          level: 1,
          xp: 0,
          materialGathererIdentity: { kind: 'offline' },
        } as unknown as CharacterState,
        localGathererIdentity: OFFLINE_A,
      }),
    ).toThrow(/refusing character load/);
    // Nothing was half-created, and no substitute identity was minted.
    expect(internalsOf(sim).players.size).toBe(before);
  });

  it('loads a pre-feature save with no such field at all', () => {
    const sim = bareSim();
    const state = serializedBaseline();
    delete state.materialGathererIdentity;
    const pid = sim.addPlayer('warrior', 'Ana', {
      state,
    });
    expect(metaOf(sim, pid).gathererIdentity).toBeUndefined();
  });
});

// A dead wolf carries hide and fang tags, so one real harvestCorpse cast
// (Intentional Gathering PR3: a timed HARVEST_CAST_SECONDS cast, not an
// instant grant) lands real material through the real grant hub.
function corpseRig(seed: number, opts: { identity?: typeof OFFLINE_A; name?: string } = {}) {
  // A world with no camps/npcs/ground objects: a real multi-tick cast must
  // not risk a stray mob aggroing the stationary player and cancelling it
  // (the corpse_harvest_cast.test.ts / corpse_harvest_command.test.ts rigs
  // use the same EMPTY_TEST_WORLD for the same reason).
  const sim = new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: EMPTY_TEST_WORLD });
  const pid = sim.addPlayer('warrior', opts.name ?? 'Ana', {
    ...(opts.identity === undefined ? {} : { localGathererIdentity: opts.identity }),
  });
  sim.tick();
  const player = expectDefined(internalsOf(sim).entities.get(pid));
  // Coherent rest state (matching prevPos, zero velocity, grounded) so a real
  // multi-tick cast never reads a gravity settle as a cancelling displacement.
  player.pos = sim.groundPos(0, 0);
  player.prevPos = { ...player.pos };
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.onGround = true;
  sim.addItem('field_kit', 1, pid);

  const template = MOBS.forest_wolf;
  const corpse = createMob(9000 + seed, template, template.maxLevel, sim.groundPos(0, 0));
  corpse.dead = true;
  corpse.aiState = 'dead';
  corpse.corpseTimer = 9999;
  corpse.respawnTimer = 9999;
  internalsOf(sim).entities.set(corpse.id, corpse);
  sim.drainEvents();
  return { sim, pid, corpse };
}

/** Drive one real harvest cast to completion and report the rng draws it spent. */
function harvest(rig: ReturnType<typeof corpseRig>): { draws: number; events: unknown[] } {
  let draws = 0;
  const rng = (rig.sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } })
    .rng;
  rng.setObserver(() => {
    draws++;
  });
  const result = completeCorpseHarvest(rig.sim, rig.corpse.id, rig.pid);
  rng.setObserver(null);
  return { draws, events: result.events };
}

describe('a real corpse harvest lands attributed units', () => {
  it('attributes every landed material unit to the gatherer, exactly once per unit', () => {
    const rig = corpseRig(5, { identity: OFFLINE_A });
    harvest(rig);

    const meta = metaOf(rig.sim, rig.pid);
    const materials = meta.inventory.filter((slot: InvSlot) => isMaterialItemId(slot.itemId));
    expect(materials.length).toBeGreaterThan(0);
    for (const slot of materials) {
      const buckets = expectDefined(slot.materialSources);
      // Bucket counts sum EXACTLY to the stack: no unit is unattributed and
      // none is counted twice.
      expect(buckets.reduce((n, entry) => n + entry.count, 0)).toBe(slot.count);
      for (const entry of buckets) {
        expect(entry.source.gatherer).toEqual({ ...OFFLINE_A, name: 'Ana' });
      }
    }
  });

  it('signs ONLY the premium yields, and the plain ones carry a gatherer with no signature', () => {
    // Sweep seeds so both outcomes are really observed rather than assumed;
    // each seed is its own deterministic harvest.
    let sawPlain = false;
    let sawSigned = false;
    for (let seed = 1; seed <= 40; seed++) {
      const rig = corpseRig(seed, { identity: OFFLINE_A });
      const { events } = harvest(rig);
      const result = events.find(
        (e): e is { type: 'harvestResult'; yields: { itemId: string; kind: string }[] } =>
          (e as { type?: string }).type === 'harvestResult',
      );
      if (!result) continue;

      for (const entry of result.yields) {
        if (!isMaterialItemId(entry.itemId)) continue;
        const sources = bucketsFor(rig.sim, rig.pid, entry.itemId);
        expect(sources.length).toBeGreaterThan(0);
        const premium = sources.some(isPremiumMaterialSource);
        if (entry.kind === 'plain') {
          sawPlain = true;
          // Attributed, never signed: recording who gathered a unit must not
          // hand it a premium signature.
          for (const source of sources) expect(source.gatherer).toBeDefined();
          if (result.yields.every((y) => y.kind === 'plain')) expect(premium).toBe(false);
        } else {
          sawSigned = true;
          expect(premium).toBe(true);
          // The signature rides the SOURCE, never the payload: a stack holding
          // both at once is the ambiguity the shared reader refuses outright.
          for (const slot of metaOf(rig.sim, rig.pid).inventory) {
            if (slot.itemId !== entry.itemId) continue;
            expect(slot.instance?.signer).toBeUndefined();
          }
        }
      }
      if (sawPlain && sawSigned) break;
    }
    expect(sawPlain).toBe(true);
    expect(sawSigned).toBe(true);
  });

  it('spends the SAME rng draws attributed and unattributed', () => {
    // Provenance is recorded after every roll and draws nothing itself, so a
    // host that supplies an identity cannot fork a seeded world.
    const withIdentity = harvest(corpseRig(5, { identity: OFFLINE_A }));
    const without = harvest(corpseRig(5));
    expect(withIdentity.draws).toBe(without.draws);
    expect(withIdentity.draws).toBeGreaterThan(0);
  });

  it('leaves an UNKNOWN player unrecorded rather than inventing a gatherer', () => {
    const rig = corpseRig(5);
    harvest(rig);
    const meta = metaOf(rig.sim, rig.pid);
    const materials = meta.inventory.filter((slot: InvSlot) => isMaterialItemId(slot.itemId));
    expect(materials.length).toBeGreaterThan(0);
    for (const slot of materials) {
      for (const entry of slot.materialSources ?? []) {
        expect(entry.source.gatherer).toBeUndefined();
      }
    }
  });

  it('snapshots the name at MINT time, so a rename only reaches future gathers', () => {
    const rig = corpseRig(5, { identity: OFFLINE_A });
    harvest(rig);
    const landed = () =>
      metaOf(rig.sim, rig.pid)
        .inventory.filter((slot: InvSlot) => isMaterialItemId(slot.itemId))
        .flatMap((slot: InvSlot) => slot.materialSources ?? []);
    expect(landed().length).toBeGreaterThan(0);
    for (const entry of landed()) expect(entry.source.gatherer?.name).toBe('Ana');

    metaOf(rig.sim, rig.pid).name = 'Anastasia';
    // Already-landed units keep the name they were gathered under: the rename
    // reaches the meta, never the buckets.
    for (const entry of landed()) expect(entry.source.gatherer?.name).toBe('Ana');

    // A fresh gather under the new name records the new snapshot.
    const second = corpseRig(6, { identity: OFFLINE_A, name: 'Anastasia' });
    harvest(second);
    const after = metaOf(second.sim, second.pid)
      .inventory.filter((slot: InvSlot) => isMaterialItemId(slot.itemId))
      .flatMap((slot: InvSlot) => slot.materialSources ?? []);
    expect(after.length).toBeGreaterThan(0);
    for (const entry of after) expect(entry.source.gatherer?.name).toBe('Anastasia');
  });
});

describe('paths that must stay unattributed', () => {
  it('does not attribute a plain custody-style regrant through the inventory hub', () => {
    // The hub NEVER attributes on its own: only a gathering mint passes sources,
    // so a trade, mail, market or bank hand-back lands unrecorded.
    const sim = bareSim();
    const pid = sim.addPlayer('warrior', 'Ana', { localGathererIdentity: OFFLINE_A });
    sim.addItem('rough_hide', 3, pid, { movement: true });

    const counts = unitCounts(sim, pid, 'rough_hide');
    expect(counts.total).toBe(3);
    expect(counts.attributed).toBe(0);
  });

  it('does not attribute a non-gathering grant even for an identified player', () => {
    const sim = bareSim();
    const pid = sim.addPlayer('warrior', 'Ana', { localGathererIdentity: OFFLINE_A });
    sim.addItem('rough_hide', 2, pid);
    expect(unitCounts(sim, pid, 'rough_hide').attributed).toBe(0);
  });
});
