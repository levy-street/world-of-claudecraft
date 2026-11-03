import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { GOURDLIGHT_SWEET_ID } from '../src/sim/content/gourdlight_eve';
import {
  GOURDLIGHT_PUMPKINS,
  HAUNTED_PUMPKIN_EDITION,
} from '../src/sim/content/gourdlight_pumpkins';
import { ZONES, zoneAt } from '../src/sim/data';
import {
  freshSeasonalPlayerState,
  hauntedPumpkinForEntity,
  hauntedPumpkinsFoundView,
  restoreSeasonalState,
  seasonalSaveFragment,
} from '../src/sim/seasonal';
import { Sim } from '../src/sim/sim';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

function world() {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', devCommands: true });
  sim.chat('/dev season on');
  sim.tick();
  return sim;
}
function pumpkins(sim: Sim) {
  return [...sim.entities.values()].filter((e) => hauntedPumpkinForEntity(e));
}

describe('personal Haunted Pumpkins', () => {
  it('reuses immutable views until discovery or restoration changes the ledger', () => {
    const meta = freshSeasonalPlayerState();
    const empty = hauntedPumpkinsFoundView(meta);
    expect(empty).toBe(hauntedPumpkinsFoundView(freshSeasonalPlayerState()));
    meta.hauntedPumpkins.add(GOURDLIGHT_PUMPKINS[0].id);
    const first = hauntedPumpkinsFoundView(meta);
    expect(hauntedPumpkinsFoundView(meta)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    const other = freshSeasonalPlayerState();
    other.hauntedPumpkins.add(GOURDLIGHT_PUMPKINS[2].id);
    expect(hauntedPumpkinsFoundView(other)).toEqual([GOURDLIGHT_PUMPKINS[2].id]);
    expect(hauntedPumpkinsFoundView(meta)).toBe(first);
    meta.hauntedPumpkins.add(GOURDLIGHT_PUMPKINS[1].id);
    expect(hauntedPumpkinsFoundView(meta)).not.toBe(first);
    restoreSeasonalState(meta, {
      pumpkins: { edition: HAUNTED_PUMPKIN_EDITION, found: [GOURDLIGHT_PUMPKINS[2].id] },
    });
    expect(hauntedPumpkinsFoundView(meta)).toEqual([GOURDLIGHT_PUMPKINS[2].id]);
    meta.hauntedPumpkins.clear();
    expect(hauntedPumpkinsFoundView(meta)).toBe(empty);
  });
  it('authors five dry, collision-free locations in every normal world zone', () => {
    const eligible = ZONES.filter((z) => z.id !== 'proving_shore');
    for (const zone of eligible)
      expect(GOURDLIGHT_PUMPKINS.filter((p) => p.zoneId === zone.id)).toHaveLength(5);
    const bad = GOURDLIGHT_PUMPKINS.filter(
      (p) =>
        isBlocked(WORLD_SEED, p.x, p.z, 0.5) ||
        groundHeight(p.x, p.z, WORLD_SEED) <= WATER_LEVEL ||
        zoneAt(p.x, p.z).id !== p.zoneId,
    );
    expect(bad.map((p) => p.id)).toEqual([]);
  });
  it('keeps shared pumpkins and rewards a personal discovery exactly once', () => {
    const sim = world();
    const pumpkin = pumpkins(sim)[0];
    sim.player.pos = { ...pumpkin.pos };
    sim.pickUpObject(pumpkin.id);
    expect(sim.hauntedPumpkinsFound).toEqual([GOURDLIGHT_PUMPKINS[0].id]);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(1);
    sim.pickUpObject(pumpkin.id);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(1);
    expect(pumpkin.lootable).toBe(true);
    expect(sim.entities.has(pumpkin.id)).toBe(true);
    sim.resetDay = '2026-10-30';
    sim.tick();
    expect(sim.hauntedPumpkinsFound).toHaveLength(1);
    const restored = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    restored.addPlayer('warrior', 'Returning', { state: sim.serializeCharacter(sim.player.id)! });
    expect(restored.hauntedPumpkinsFound).toEqual(sim.hauntedPumpkinsFound);
  });

  it('refuses remote and dead clicks, removes event objects on close, and retains discoveries', () => {
    const sim = world();
    const pumpkin = pumpkins(sim)[0];
    sim.player.pos = { ...pumpkin.pos, x: pumpkin.pos.x + 100 };
    sim.pickUpObject(pumpkin.id);
    expect(sim.hauntedPumpkinsFound).toHaveLength(0);
    sim.player.pos = { ...pumpkin.pos };
    sim.player.dead = true;
    sim.pickUpObject(pumpkin.id);
    expect(sim.hauntedPumpkinsFound).toHaveLength(0);
    sim.player.dead = false;
    sim.pickUpObject(pumpkin.id);
    sim.chat('/dev season off');
    sim.tick();
    expect(pumpkins(sim)).toHaveLength(0);
    expect(sim.hauntedPumpkinsFound).toHaveLength(1);
    sim.chat('/dev season on');
    sim.tick();
    const reopened = pumpkins(sim).find((e) => e.id === pumpkin.id);
    expect(reopened).toBeDefined();
    sim.player.pos = { ...pumpkin.pos };
    expect(sim.pickUpObject(pumpkin.id)).toBe(false);
    expect(sim.hauntedPumpkinsFound).toHaveLength(1);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(1);
  });

  it('leaves a full-bag discovery unclaimed until the player frees a slot', () => {
    const sim = world();
    const pumpkin = pumpkins(sim)[0];
    sim.player.pos = { ...pumpkin.pos };
    while (sim.inventory.length < sim.bagCapacity) sim.addItem('worn_sword', 1);
    expect(sim.canAddItem(GOURDLIGHT_SWEET_ID, 1)).toBe(false);
    expect(sim.pickUpObject(pumpkin.id)).toBe(false);
    expect(sim.hauntedPumpkinsFound).toHaveLength(0);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(0);
    expect(sim.tick().some((e) => e.type === 'seasonal' && e.what === 'pumpkinFound')).toBe(false);
    expect(pumpkin.lootable).toBe(true);
    sim.removeItem('worn_sword', 1);
    sim.player.pos = { ...pumpkin.pos };
    expect(sim.pickUpObject(pumpkin.id)).toBe(true);
    expect(sim.hauntedPumpkinsFound).toEqual([GOURDLIGHT_PUMPKINS[0].id]);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID)).toBe(1);
  });

  it('lets two players discover the same pumpkin independently without allocator or RNG draws', () => {
    const sim = world();
    const second = sim.addPlayer('warrior', 'Other');
    const pumpkin = pumpkins(sim)[0];
    const nextId = sim.nextId;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.player.pos = { ...pumpkin.pos };
    sim.pickUpObject(pumpkin.id);
    const other = sim.entities.get(second)!;
    other.pos = { ...pumpkin.pos };
    expect(sim.pickUpObject(pumpkin.id, second)).toBe(true);
    expect(sim.countItem(GOURDLIGHT_SWEET_ID, second)).toBe(1);
    expect(sim.nextId).toBe(nextId);
    expect(draws).toBe(0);
  });

  it('unlocks Pumpkin Hunter and the Hollow after all locations', () => {
    const sim = world();
    for (const pumpkin of pumpkins(sim)) {
      sim.player.pos = { ...pumpkin.pos };
      sim.pickUpObject(pumpkin.id);
    }
    expect(sim.hauntedPumpkinsFound).toHaveLength(GOURDLIGHT_PUMPKINS.length);
    expect(sim.deedsEarned.has('feat_pumpkin_hunter')).toBe(true);
    sim.chat('/dev season off');
    sim.tick();
    sim.setActiveTitle('feat_pumpkin_hunter');
    expect(sim.activeTitle).toBe('feat_pumpkin_hunter');
  });

  it('rejects unknown IDs and stale editions while bounding save restoration', () => {
    const meta = freshSeasonalPlayerState();
    restoreSeasonalState(meta, {
      pumpkins: {
        edition: HAUNTED_PUMPKIN_EDITION,
        found: [GOURDLIGHT_PUMPKINS[0].id, 'forged', GOURDLIGHT_PUMPKINS[0].id],
      },
    });
    expect([...meta.hauntedPumpkins]).toEqual([GOURDLIGHT_PUMPKINS[0].id]);
    expect(seasonalSaveFragment(meta).seasonal?.pumpkins?.found).toEqual([
      GOURDLIGHT_PUMPKINS[0].id,
    ]);
    restoreSeasonalState(meta, {
      pumpkins: { edition: '2025', found: [GOURDLIGHT_PUMPKINS[0].id] },
    });
    expect(meta.hauntedPumpkins.size).toBe(0);
  });

  it('ignores otherwise valid discoveries beyond the bounded oversized save prefix', () => {
    const meta = freshSeasonalPlayerState();
    const oversized = Array<string>(10000).fill('forged');
    oversized[0] = GOURDLIGHT_PUMPKINS[0].id;
    oversized[GOURDLIGHT_PUMPKINS.length] = GOURDLIGHT_PUMPKINS[1].id;
    restoreSeasonalState(meta, {
      pumpkins: { edition: HAUNTED_PUMPKIN_EDITION, found: oversized },
    });
    expect(hauntedPumpkinsFoundView(meta)).toEqual([GOURDLIGHT_PUMPKINS[0].id]);
    expect(seasonalSaveFragment(meta).seasonal?.pumpkins?.found).toEqual([
      GOURDLIGHT_PUMPKINS[0].id,
    ]);
  });
});
