import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  VALKYR_CANCEL_FADE,
  VALKYR_CAPACITY,
  VALKYR_QUADS,
  ValkyrsCalling,
} from '../src/render/ability_vfx/valkyrs_calling';
import { syncPaladinAvengingWrathVisual } from '../src/render/paladin_avenging_wrath_visual';
import {
  VALKYR_IMPACT_DURATION,
  VALKYR_LAND,
  VALKYR_LAUNCH,
  VALKYR_RETURN,
  VALKYR_VANISH,
  valkyrBrandish,
  valkyrFlightElapsed,
  valkyrSlam,
  valkyrVanished,
} from '../src/render/paladin_valkyrs_calling_core';
import { VALKYRS_CALLING_FLIGHT_AURA_ID } from '../src/sim/combat/paladin_valkyrs_calling_state';

function fixture() {
  const scene = new THREE.Scene();
  // Feet (height 0) stand on the terrain at y 3; the top of the body is 2 up.
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) =>
    id < 0 ? null : (out?.set(id, 3 + height * 2, 4) ?? null),
  );
  const host = {
    bakedAt: vi.fn(() => true),
    fragmentsAt: vi.fn(),
    decalXZ: vi.fn(),
    crestAt: vi.fn(() => true),
    shakeAt: vi.fn(),
  };
  const effect = new ValkyrsCalling(scene, anchor, () => 3, undefined, host);
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  return {
    effect,
    scene,
    anchor,
    host,
    prepare: async () => {
      for (const u of effect.preparation.units(gl)) await u.run();
    },
    shapes: () => {
      const geometry = effect.mesh.geometry;
      const shape = geometry.getAttribute('aShape');
      const seen = new Set<number>();
      for (let i = 0; i < geometry.drawRange.count; i++) seen.add(shape.getX(i));
      return seen;
    },
  };
}

/** Steps a flight to `until` seconds in 50 ms ticks. */
function fly(effect: ValkyrsCalling, from: number, until: number): void {
  for (let t = from; t < until - 1e-6; t += 0.05) effect.update(0.05);
}

describe("Valkyr's Calling timing", () => {
  it('reads the flight clock from the sim, else from the flight aura countdown', () => {
    expect(valkyrFlightElapsed({ auras: [] })).toBeNull();
    expect(valkyrFlightElapsed({ auras: [], valkyrsCalling: { elapsed: 0.7 } })).toBe(0.7);
    const aura = { id: VALKYRS_CALLING_FLIGHT_AURA_ID, duration: 2.05, remaining: 2.05 };
    expect(valkyrFlightElapsed({ auras: [aura] })).toBeCloseTo(0);
    expect(valkyrFlightElapsed({ auras: [{ ...aura, remaining: 0.55 }] })).toBeCloseTo(1.5);
    expect(valkyrFlightElapsed({ auras: [{ ...aura, remaining: 0 }] })).toBe(VALKYR_LAND);
  });

  it('hides the body only between the vanish and the return', () => {
    expect(VALKYR_LAUNCH).toBeLessThan(VALKYR_VANISH);
    expect(VALKYR_VANISH).toBeLessThan(VALKYR_RETURN);
    expect(VALKYR_RETURN).toBeLessThan(VALKYR_LAND);
    expect(valkyrVanished(null)).toBe(false);
    expect(valkyrVanished(VALKYR_VANISH - 0.01)).toBe(false);
    expect(valkyrVanished(VALKYR_VANISH)).toBe(true);
    expect(valkyrVanished(VALKYR_RETURN - 0.01)).toBe(true);
    expect(valkyrVanished(VALKYR_RETURN)).toBe(false);
  });

  it('raises the weapon before the launch and holds it; the slam strikes then recovers', () => {
    expect(valkyrBrandish(null)).toBe(0);
    expect(valkyrBrandish(0)).toBe(0);
    expect(valkyrBrandish(VALKYR_LAUNCH)).toBe(1);
    expect(valkyrBrandish(VALKYR_RETURN + 0.2)).toBe(1);
    expect(valkyrSlam(-0.1)).toEqual([0, 0]);
    expect(valkyrSlam(0.1)).toEqual([1, 1]);
    const [, recovering] = valkyrSlam(0.4);
    expect(recovering).toBeGreaterThan(0);
    expect(recovering).toBeLessThan(1);
    expect(valkyrSlam(0.6)).toEqual([0, 0]);
  });
});

describe("Valkyr's Calling flight visual", () => {
  it('requires preparation and a caster, then plays the whole flight in its budget', async () => {
    const f = fixture();
    expect(f.effect.launch(1, 10, 4, 8)).toBe(false);
    await f.prepare();
    expect(f.effect.launch(-1, 10, 4, 8)).toBe(false);
    expect(f.effect.launch(1, 10, 4, 8)).toBe(true);
    const positions = f.effect.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let peak = 0;
    for (let t = 0; t < VALKYR_LAND - 1e-6; t += 0.05) {
      f.effect.update(0.05);
      peak = Math.max(peak, f.effect.mesh.geometry.drawRange.count);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(VALKYR_QUADS * 6);
    expect(positions.count).toBe(VALKYR_CAPACITY * VALKYR_QUADS * 6);
    expect(f.effect.land(1, 10, 4, 8)).toBe(true);
    f.effect.update(0.05);
    const count = f.effect.mesh.geometry.drawRange.count;
    expect(count).toBeLessThanOrEqual(VALKYR_QUADS * 6);
    for (let i = 0; i < count; i++) {
      expect(Number.isFinite(positions.getX(i))).toBe(true);
      expect(Number.isFinite(positions.getY(i))).toBe(true);
    }
    expect(positions.updateRanges[0].count).toBe(count * 3);
    fly(f.effect, 0, VALKYR_IMPACT_DURATION);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
    f.effect.dispose();
    expect(f.scene.children).toHaveLength(0);
    expect(f.effect.launch(1, 10, 4, 8)).toBe(false);
  });

  it('draws each phase in turn: departure, the mark while gone, the return, the slam', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.launch(1, 10, 4, 8);
    fly(f.effect, 0, VALKYR_LAUNCH - 0.05);
    // The charge: light gathering under the feet, the column, motes drawn in
    // and a glow building on the body; the weapon still held low.
    expect(f.shapes()).toEqual(new Set([0, 3, 4, 5]));
    expect(f.host.bakedAt).not.toHaveBeenCalled();
    fly(f.effect, VALKYR_LAUNCH - 0.05, VALKYR_LAUNCH + 0.05);
    // The launch: rings of air burst round the body, a flash at the feet and
    // the raised weapon's glint; the ground cracks and dust and stone fly once.
    expect(f.shapes()).toContain(8);
    expect(f.shapes()).toContain(4);
    expect(f.host.bakedAt).toHaveBeenCalled();
    expect(f.host.fragmentsAt).toHaveBeenCalled();
    expect(f.host.decalXZ).toHaveBeenCalledTimes(1);
    expect(f.host.shakeAt).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      0.3,
      true,
    );
    const takeoffDust = f.host.bakedAt.mock.calls.length;
    fly(f.effect, VALKYR_LAUNCH + 0.05, VALKYR_VANISH + 0.3);
    expect(f.host.bakedAt).toHaveBeenCalledTimes(takeoffDust);
    // Gone: feathers drift down and the landing is marked.
    const gone = f.shapes();
    expect(gone.has(6)).toBe(true);
    expect(gone.has(1)).toBe(true);
    expect(gone.has(2)).toBe(false);
    fly(f.effect, VALKYR_VANISH + 0.3, VALKYR_LAND - 0.05);
    expect(f.shapes().has(2)).toBe(false);
    f.effect.land(1, 10, 4, 8);
    f.effect.update(0.05);
    // The slam: the slash's crescent, the seal, beams, flare and sparks; the
    // ground breaks.
    expect(f.shapes()).toContain(7);
    expect(f.shapes()).toContain(2);
    expect(f.shapes()).toContain(5);
    expect(f.host.decalXZ).toHaveBeenCalledWith(10, 4, 6.4, 0xffffff, 'leap_fracture', 1.4);
    expect(f.host.crestAt).toHaveBeenCalledWith(
      10,
      3,
      4,
      expect.any(Number),
      1,
      expect.any(Number),
      expect.any(Number),
      'leap_rupture',
      0,
      0.9,
    );
    expect(f.host.shakeAt).toHaveBeenLastCalledWith(10, 3, 4, 0.5, true);
    f.effect.dispose();
  });

  it('sizes the slam to its radius and lays it on the body feet over a raised floor', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.launch(1, 10, 4, 8);
    fly(f.effect, 0, VALKYR_LAND);
    // Landing on a dock 1.5 yards above the terrain.
    f.anchor.mockImplementation((id: number, height: number, out?: THREE.Vector3) =>
      id < 0 ? null : (out?.set(id, 4.5 + height * 2, 4) ?? null),
    );
    f.effect.land(1, 10, 4, 8);
    f.effect.update(0.05);
    const geometry = f.effect.mesh.geometry;
    const positions = geometry.getAttribute('position');
    const shapes = geometry.getAttribute('aShape');
    let reach = 0;
    let floor = Infinity;
    for (let i = 0; i < geometry.drawRange.count; i++) {
      if (shapes.getX(i) !== 2) continue;
      reach = Math.max(reach, Math.abs(positions.getX(i) - 10));
      floor = Math.min(floor, positions.getY(i));
    }
    expect(reach).toBeCloseTo(8 * 1.05);
    expect(floor).toBeCloseTo(4.55);
    f.effect.dispose();
  });

  it('gilds an Ascension landing with a second shock to the same edge', async () => {
    const shocks = async (gilded: boolean) => {
      const f = fixture();
      await f.prepare();
      f.effect.launch(1, 10, 4, 8);
      fly(f.effect, 0, VALKYR_LAND);
      f.effect.land(1, 10, 4, 8);
      // Ascension's cue follows the landing in the same tick.
      if (gilded) expect(f.effect.gild(1)).toBe(true);
      f.effect.update(0.2);
      const geometry = f.effect.mesh.geometry;
      const positions = geometry.getAttribute('position');
      const shapes = geometry.getAttribute('aShape');
      let count = 0;
      let reach = 0;
      for (let i = 0; i < geometry.drawRange.count; i++) {
        if (shapes.getX(i) !== 2) continue;
        count++;
        reach = Math.max(reach, Math.abs(positions.getX(i) - 10));
      }
      f.effect.dispose();
      return { quads: count / 6, reach };
    };
    const plain = await shocks(false);
    const gilded = await shocks(true);
    expect(plain.quads).toBe(1);
    expect(gilded.quads).toBe(2);
    // More damage, the same reach: nothing drawn past the slam's own edge.
    expect(gilded.reach).toBeCloseTo(plain.reach);
    // No landing to gild: nothing happens.
    const f = fixture();
    await f.prepare();
    expect(f.effect.gild(1)).toBe(false);
    f.effect.dispose();
  });

  it('plays the slam alone for a landing seen without its launch, and clears cancelled flights', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.effect.land(3, 1, 1, 8)).toBe(true);
    f.effect.update(0.05);
    expect(f.shapes().has(2)).toBe(true);
    expect(f.shapes().has(1)).toBe(false);
    f.effect.clear();
    f.effect.launch(3, 1, 1, 8);
    fly(f.effect, 0, VALKYR_LAND + 0.7);
    expect(f.effect.mesh.visible).toBe(false);
    f.effect.dispose();
  });

  it('fades the landing mark at once when the flight is cancelled in the air', async () => {
    const f = fixture();
    await f.prepare();
    f.effect.launch(3, 1, 1, 8);
    fly(f.effect, 0, VALKYR_VANISH + 0.1);
    f.effect.flying(3, true);
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(true);
    // The Paladin dies mid-flight: the aura is gone and no landing will come.
    f.effect.flying(3, false);
    f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(true);
    for (let i = 0; i < Math.ceil(VALKYR_CANCEL_FADE / 0.05); i++) f.effect.update(0.05);
    expect(f.effect.mesh.visible).toBe(false);
    // The aura ending on touchdown's own frame is no cancel: the slam plays.
    f.effect.launch(3, 1, 1, 8);
    fly(f.effect, 0, VALKYR_LAND - 0.05);
    f.effect.flying(3, false);
    expect(f.effect.land(3, 1, 1, 8)).toBe(true);
    f.effect.update(0.05);
    expect(f.shapes().has(2)).toBe(true);
    f.effect.dispose();
  });
});

describe("Valkyr's Calling wings", () => {
  const flight = [{ id: VALKYRS_CALLING_FLIGHT_AURA_ID, kind: 'internal_cd' }];
  it('spread for the takeoff, vanish mid-flight, return open and hold through the slam', () => {
    const parent = new THREE.Group();
    let wings = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0.05, false, flight, 0.1);
    if (!wings) throw new Error('no wings');
    expect(wings.leftWing.visible).toBe(true);
    wings = syncPaladinAvengingWrathVisual(
      wings,
      parent,
      1.8,
      true,
      0.3,
      false,
      flight,
      VALKYR_VANISH + 0.05,
    );
    expect(wings?.leftWing.visible).toBe(false);
    wings = syncPaladinAvengingWrathVisual(
      wings,
      parent,
      1.8,
      true,
      0.05,
      false,
      flight,
      VALKYR_RETURN,
    );
    expect(wings?.leftWing.visible).toBe(true);
    expect(wings?.open).toBeGreaterThan(0.95);
    wings = syncPaladinAvengingWrathVisual(wings, parent, 1.8, true, 0.05, false, flight, 1.95);
    // Landed: the aura is gone but the wings stay spread for the slam, then go.
    wings = syncPaladinAvengingWrathVisual(wings, parent, 1.8, false, 0.05, false, [], null);
    expect(wings?.leftWing.visible).toBe(true);
    for (let i = 0; i < 20 && wings; i++)
      wings = syncPaladinAvengingWrathVisual(wings, parent, 1.8, false, 0.05, false, [], null);
    expect(wings).toBeNull();
  });

  it("takes Avenging Wrath's rune band out of sight with the Paladin", () => {
    const parent = new THREE.Group();
    const auras = [
      { id: 'avenging_wrath', kind: 'buff_dmg_done' },
      { id: 'valkyrs_calling_flight', kind: 'flight' },
    ];
    let wings = syncPaladinAvengingWrathVisual(null, parent, 1.8, true, 0.05, false, auras, 0.1);
    expect(wings?.runeBand.visible).toBe(true);
    wings = syncPaladinAvengingWrathVisual(
      wings,
      parent,
      1.8,
      true,
      0.3,
      false,
      auras,
      VALKYR_VANISH + 0.05,
    );
    expect(wings?.runeBand.visible).toBe(false);
    wings = syncPaladinAvengingWrathVisual(
      wings,
      parent,
      1.8,
      true,
      0.05,
      false,
      auras,
      VALKYR_RETURN,
    );
    expect(wings?.runeBand.visible).toBe(true);
    wings?.dispose();
  });
});

describe("Valkyr's Calling routing", () => {
  function painter() {
    const fx = {
      valkyrsCallingLaunch: vi.fn(),
      valkyrsCallingLand: vi.fn(),
      groundYAt: vi.fn(() => 0),
    };
    const triggerAttack = vi.fn(),
      abilityAudio = vi.fn(),
      spawnAoeRing = vi.fn();
    const p = Object.assign(Object.create(AbilityVfx.prototype), {
      deps: { fx, triggerAttack, abilityAudio, spawnAoeRing },
      stats: new Map(),
      spawned: 0,
      quality: 1,
    }) as AbilityVfx;
    return { p, fx, triggerAttack, abilityAudio, spawnAoeRing };
  }
  const at = { x: 5, z: 6, school: 'holy', fx: 'nova', sourceId: 1, radius: 8 };
  it('claims the cast, the landing mark and the slam for the flight visual', () => {
    const f = painter();
    expect(
      f.p.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'holy',
        fx: 'selfCast',
        ability: 'valkyrs_calling',
      }),
    ).toBe(true);
    // No generic release gesture: the body holds its own brandish.
    expect(f.triggerAttack).not.toHaveBeenCalled();
    expect(f.p.handleSpellfxAt({ ...at, ability: 'valkyrs_calling_mark' })).toBe(true);
    expect(f.fx.valkyrsCallingLaunch).toHaveBeenCalledExactlyOnceWith(1, 5, 6, 8);
    expect(f.p.handleSpellfxAt({ ...at, ability: 'valkyrs_calling_impact' })).toBe(true);
    expect(f.fx.valkyrsCallingLand).toHaveBeenCalledExactlyOnceWith(1, 5, 6, 8);
    expect(f.abilityAudio).toHaveBeenCalledOnce();
    // Both the mark and the slam keep the draped area ring at the true radius.
    expect(f.spawnAoeRing).toHaveBeenCalledTimes(2);
    for (const call of f.spawnAoeRing.mock.calls) expect(call.slice(0, 3)).toEqual([5, 6, 8]);
  });
});
