// The pure half of the Balgath trinket presentation (src/render/balgath_loot_relics_core.ts):
// which states an entity shows, which body the shared Metamorphosis slot holds, and the
// curves the Three half poses the standard, rope and beam with.
import { describe, expect, it } from 'vitest';
import {
  advanceRopeAge,
  bannerSway,
  createLootScan,
  GRAPNEL_HOLD_DIST,
  GRAPNEL_MAX_HOLD_SEC,
  GRAPNEL_REEL_SEC,
  GRAPNEL_ROPE_SEC,
  GRAPNEL_THROW_SEC,
  glareFlicker,
  grapnelReach,
  LOOT_AURA,
  LOOT_CUE,
  LOOT_FOREMAN,
  LOOT_GLARE,
  LOOT_STANDARD,
  LOOT_STATUE,
  metamorphSlotAsset,
  ropeSag,
  STANDARD_DROP_HEIGHT,
  STANDARD_PLANT_SEC,
  STANDARD_SINK_SEC,
  scanLootAuras,
  standardPlantOffset,
  standardSinkProgress,
} from '../src/render/balgath_loot_relics_core';
import { TRINKET_AURA } from '../src/sim/content/trinkets';

describe('balgath loot relics core', () => {
  it('mirrors the sim aura ids and cue names', () => {
    expect(LOOT_AURA.foremanShape).toBe(TRINKET_AURA.foremanShape);
    expect(LOOT_AURA.musterStandard).toBe(TRINKET_AURA.musterStandard);
    expect(LOOT_AURA.gutteredGlare).toBe(TRINKET_AURA.gutteredGlare);
    expect(LOOT_AURA.stoneStatue).toBe(TRINKET_AURA.stoneStatue);
    expect(LOOT_CUE.grapnel).toBe('trinket_muster_grapnel');
  });

  it('scans every state off the auras, and clears flags between scans', () => {
    const scan = createLootScan();
    scanLootAuras(
      [
        { id: LOOT_AURA.foremanShape, kind: 'form_foreman', remaining: 9 },
        { id: LOOT_AURA.musterStandard, remaining: 7, value2: 12, value3: -4 },
        { id: LOOT_AURA.gutteredGlare, remaining: 2.5 },
        { id: LOOT_AURA.stoneStatue, kind: 'stasis' },
      ],
      scan,
    );
    expect(scan.flags).toBe(LOOT_FOREMAN | LOOT_STANDARD | LOOT_GLARE | LOOT_STATUE);
    expect([scan.standardX, scan.standardZ, scan.standardRemaining]).toEqual([12, -4, 7]);
    expect(scan.glareRemaining).toBe(2.5);
    // A standard aura without its spot does not draw one.
    scanLootAuras([{ id: LOOT_AURA.musterStandard, remaining: 7 }], scan);
    expect(scan.flags).toBe(0);
  });

  it('gives the Metamorphosis slot to the Foreman first, the demon otherwise', () => {
    expect(metamorphSlotAsset([])).toBeNull();
    expect(metamorphSlotAsset([{ kind: 'form_metamorph' }])).toBe('form_metamorph');
    expect(metamorphSlotAsset([{ kind: 'form_lich' }])).toBe('form_metamorph');
    expect(metamorphSlotAsset([{ kind: 'form_metamorph' }, { kind: 'form_foreman' }])).toBe(
      'form_foreman',
    );
  });

  it('drops the standard onto its spike and sinks it back out', () => {
    expect(standardPlantOffset(0)).toBe(STANDARD_DROP_HEIGHT);
    expect(standardPlantOffset(STANDARD_PLANT_SEC / 2)).toBeLessThan(STANDARD_DROP_HEIGHT);
    expect(standardPlantOffset(STANDARD_PLANT_SEC)).toBe(0);
    expect(standardSinkProgress(-1)).toBe(0);
    expect(standardSinkProgress(STANDARD_SINK_SEC / 2)).toBeCloseTo(0.5, 9);
    expect(standardSinkProgress(STANDARD_SINK_SEC * 2)).toBe(1);
  });

  it('throws the hook out, holds it for the haul, reels it in', () => {
    expect(grapnelReach(0)).toBe(0);
    expect(grapnelReach(GRAPNEL_THROW_SEC / 2)).toBeCloseTo(0.5, 9);
    expect(grapnelReach(GRAPNEL_ROPE_SEC / 2)).toBe(1);
    expect(grapnelReach(GRAPNEL_ROPE_SEC)).toBe(0);
    // Slack while flying, taut while hauling; never sags upward.
    expect(Math.abs(ropeSag(0.5, 0.5, 20))).toBeGreaterThan(Math.abs(ropeSag(0.5, 1, 20)));
    expect(ropeSag(0.5, 1, 20)).toBeLessThanOrEqual(0);
    expect(ropeSag(0, 1, 20)).toBeCloseTo(0, 9);
  });

  it('holds the reel back while the ally is still in the air, up to a cap', () => {
    const reelStart = GRAPNEL_ROPE_SEC - GRAPNEL_REEL_SEC;
    // Before the reel point, age simply runs on.
    expect(advanceRopeAge(0.2, 0, 0.1, 20)).toEqual({ age: 0.30000000000000004, held: 0 });
    // At the reel point with the ally far away: the age waits and the hold counts.
    const held = advanceRopeAge(reelStart - 0.01, 0, 0.1, 20);
    expect(held.age).toBeLessThan(reelStart);
    expect(held.held).toBeCloseTo(0.1, 9);
    expect(grapnelReach(held.age)).toBe(1);
    // Once the ally is at hand, or the cap is spent, the reel goes ahead.
    expect(advanceRopeAge(reelStart - 0.01, 0, 0.1, GRAPNEL_HOLD_DIST).age).toBeGreaterThan(
      reelStart,
    );
    expect(advanceRopeAge(reelStart - 0.01, GRAPNEL_MAX_HOLD_SEC, 0.1, 20).age).toBeGreaterThan(
      reelStart,
    );
  });

  it('holds still for reduced motion', () => {
    expect(bannerSway(3.2, 7, true)).toBe(0);
    expect(glareFlicker(3.2, 7, true)).toBe(1);
    expect(bannerSway(3.2, 7, false)).not.toBe(bannerSway(3.2, 8, false));
    const f = glareFlicker(1.1, 3, false);
    expect(f).toBeGreaterThan(0.7);
    expect(f).toBeLessThanOrEqual(1);
  });
});
