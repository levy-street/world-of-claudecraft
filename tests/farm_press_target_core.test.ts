// The farming press-ambiguity resolver (src/game/farm_press_target_core.ts):
// which of the feast/bed pair a press takes when both are in reach, under
// ruling 11b-R3c-1.
//
// Two things are pinned here that a same-input-same-output test alone would
// not catch. FIRST, the resolver is driven against BOTH IWorld shapes (the
// offline Sim's live arrays and the online ClientWorld's mirrored copies), so a
// host-shaped difference cannot change the answer. SECOND, and the reason this
// file exists rather than trusting the core in isolation: the core's comparative
// claim is CROSS-CHECKED against the real dispatcher. The last block drives
// tryNearbyInteraction over the same fixture and asserts the press really did
// bite the feast, so the affordance cannot drift into claiming an order the
// ladder does not implement. Comparing the core against a second copy of its own
// rule would prove nothing.

import { describe, expect, it } from 'vitest';
import {
  type FarmPressTarget,
  type FarmPressTargetWorld,
  farmPressTarget,
} from '../src/game/farm_press_target_core';
import type { InteractionOutcome } from '../src/game/interaction_autorun';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import type { Entity, QuestProgress, Vec3 } from '../src/sim/types';
import type { FarmPatchDef, FarmPlotView } from '../src/world_api/farming';

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    ...overrides,
  } as Entity;
}

/** A placed feast: the kind:'object' entity carrying a feast templateId. */
const feast = (id: number, x = 2): Entity =>
  entity({ id, kind: 'object', templateId: 'farm_feast', pos: { x, y: 0, z: 0 } });

const patches = (bedX = 2): readonly FarmPatchDef[] => [
  {
    id: 'patch_test',
    zoneId: 'eastbrook_vale',
    tier: 1,
    x: bedX,
    z: 0,
    beds: [{ id: 'bed_test_1', x: bedX, z: 0 }],
  },
];

const myPlot = (bedId = 'bed_test_1'): readonly FarmPlotView[] =>
  [{ bedId }] as unknown as readonly FarmPlotView[];

/** The two IWorld shapes. The offline Sim hands out its LIVE arrays and a live
 *  entity Map; the online ClientWorld mirrors server snapshots into copies it
 *  owns. The resolver only reads, so both must answer identically. */
function world(
  shape: 'sim' | 'clientworld',
  entities: readonly Entity[],
  farmPatches: readonly FarmPatchDef[],
  myFarmPlots: readonly FarmPlotView[],
): FarmPressTargetWorld {
  const map = new Map<number, Entity>(entities.map((e) => [e.id, e]));
  if (shape === 'sim') return { entities: map, farmPatches, myFarmPlots };
  return {
    entities: new Map(map),
    farmPatches: farmPatches.map((patch) => ({
      ...patch,
      beds: patch.beds.map((b) => ({ ...b })),
    })),
    myFarmPlots: myFarmPlots.map((plot) => ({ ...plot })),
  };
}

const SHAPES = ['sim', 'clientworld'] as const;

describe('farmPressTarget: the feast-over-bed ambiguity (ruling 11b-R3c-1)', () => {
  it.each(SHAPES)('names the feast over a bed the caller has a plot in (%s)', (shape) => {
    const w = world(shape, [feast(12)], patches(), myPlot());
    expect(farmPressTarget(w, ORIGIN, false)).toBe<FarmPressTarget>('feast_over_harvest');
  });

  it.each(SHAPES)('names the feast over a FREE bed, which would have planted (%s)', (shape) => {
    const w = world(shape, [feast(12)], patches(), []);
    expect(farmPressTarget(w, ORIGIN, false)).toBe<FarmPressTarget>('feast_over_plant');
  });

  it.each(SHAPES)('a plot in ANOTHER bed does not make this one a harvest (%s)', (shape) => {
    // decideFarmBedAction keys on the bed the press resolved, not on owning any
    // plot at all: a player farming elsewhere still PLANTS in the free bed here.
    const w = world(shape, [feast(12)], patches(), myPlot('bed_somewhere_else'));
    expect(farmPressTarget(w, ORIGIN, false)).toBe<FarmPressTarget>('feast_over_plant');
  });

  it('reports nothing with only a bed in reach: there is no ambiguity to resolve', () => {
    // The press unambiguously takes the bed, so an affordance here would be
    // noise. This is the arm that keeps the notice scoped to the recorded gap.
    expect(farmPressTarget(world('sim', [], patches(), myPlot()), ORIGIN, false)).toBeNull();
  });

  it('reports nothing with only a feast in reach', () => {
    expect(farmPressTarget(world('sim', [feast(12)], [], []), ORIGIN, false)).toBeNull();
  });

  it('reports nothing with neither in reach', () => {
    expect(farmPressTarget(world('sim', [], [], []), ORIGIN, false)).toBeNull();
  });

  it('reports nothing for a dead player standing in the ambiguity', () => {
    // The dispatcher gates BOTH farming arms on !player.dead, so a ghost's
    // press takes neither and the notice would promise an order that is moot.
    const w = world('sim', [feast(12)], patches(), myPlot());
    expect(farmPressTarget(w, ORIGIN, true)).toBeNull();
  });

  it('respects each resolver own reach boundary rather than a re-derived one', () => {
    // Out of the feast reach (its scan is INCLUSIVE at INTERACT_RANGE, so 10
    // yards is well past it) leaves the bed alone in reach: no ambiguity.
    const w = world('sim', [feast(12, 10)], patches(), myPlot());
    expect(farmPressTarget(w, ORIGIN, false)).toBeNull();
    // Out of the BED reach with the feast in reach is the mirror case.
    const farBed = world('sim', [feast(12)], patches(30), myPlot());
    expect(farmPressTarget(farBed, ORIGIN, false)).toBeNull();
  });

  it('is allocation-free: the answer is a string union, not a fresh object', () => {
    // The consumer diffs this value as its repaint signature, which is only
    // sound while equal states are ===. A future refactor returning
    // { kind, bedId } would silently repaint every poll.
    const w = world('sim', [feast(12)], patches(), myPlot());
    const first = farmPressTarget(w, ORIGIN, false);
    expect(first).toBe(farmPressTarget(w, ORIGIN, false));
    expect(typeof first).toBe('string');
  });
});

describe('the claim is the dispatcher own order, not a second copy of it', () => {
  // The cross-check. tryNearbyInteraction is the real ladder; this drives it
  // over the SAME fixture the core answered 'feast_over_harvest' for and
  // asserts the press actually consumed the feast. If someone reorders the
  // farming arms, this reds even though the core still agrees with itself.
  function dispatchRig(entities: readonly Entity[], myFarmPlots: readonly FarmPlotView[]) {
    const player = entity({ id: 1, kind: 'player' });
    const calls: string[] = [];
    const world = {
      playerId: 1,
      player,
      entities: new Map<number, Entity>([
        [player.id, player],
        ...entities.map((e): [number, Entity] => [e.id, e]),
      ]),
      questLog: new Map<string, QuestProgress>(),
      targetEntity: () => {},
      interact: () => {},
      lootCorpse: () => true,
      harvestCorpse: () => {},
      delveInteract: () => true,
      enterDungeon: () => true,
      leaveDungeon: () => true,
      pickUpObject: () => true,
      nodeHarvestableByMe: () => true,
      harvestNode: () => true,
      farmPatches: patches(),
      myFarmPlots,
      harvestCrop: (bedId: string) => calls.push(`harvestCrop:${bedId}`),
      consumeFeast: (feastId: number) => calls.push(`consumeFeast:${feastId}`),
    };
    const hud = {
      openMailbox: () => {},
      openQuestDialog: () => {},
      openDelveBoard: () => {},
      showError: (text: string) => calls.push(`error:${text}`),
      requestSpiritHealerResurrect: () => {},
      openPlantSheet: (bedId: string) => calls.push(`plantSheet:${bedId}`),
    };
    return { world, hud, calls };
  }

  const press = (r: ReturnType<typeof dispatchRig>): InteractionOutcome =>
    tryNearbyInteraction(
      r.world,
      r.hud,
      [],
      null,
      'too far',
      'not ready',
      'escort away',
      'nothing',
    );

  it('the press really does take the feast where the core says feast_over_harvest', () => {
    const w = world('sim', [feast(12)], patches(), myPlot());
    expect(farmPressTarget(w, ORIGIN, false)).toBe<FarmPressTarget>('feast_over_harvest');

    const r = dispatchRig([feast(12)], myPlot());
    expect(press(r)).toBe(true);
    expect(r.calls).toEqual(['consumeFeast:12']);
  });

  it('the press really does take the feast where the core says feast_over_plant', () => {
    const w = world('sim', [feast(12)], patches(), []);
    expect(farmPressTarget(w, ORIGIN, false)).toBe<FarmPressTarget>('feast_over_plant');

    const r = dispatchRig([feast(12)], []);
    expect(press(r)).toBe(true);
    expect(r.calls).toEqual(['consumeFeast:12']);
  });

  it('and the bed takes the press back once the feast is gone, where the core reports no ambiguity', () => {
    // The second direction, so the notice is proven to disappear exactly when
    // the thing it warned about does.
    const w = world('sim', [], patches(), []);
    expect(farmPressTarget(w, ORIGIN, false)).toBeNull();

    const r = dispatchRig([], []);
    expect(press(r)).toBe(true);
    expect(r.calls).toEqual(['plantSheet:bed_test_1']);
  });
});
