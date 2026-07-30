import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  MOUNT_VISUAL_SPECS,
  mountBobY,
  mountSeatLift,
  mountVisualSpec,
} from '../src/render/mount_visuals';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

describe('mount visual specs cover the sim catalog', () => {
  it('has a spec for every MountKey and nothing else', () => {
    expect(Object.keys(MOUNT_VISUAL_SPECS).sort()).toEqual([...MOUNT_KEYS].sort());
  });

  it('every spec points at a registered lazyPreload VisualDef', () => {
    for (const key of MOUNT_KEYS) {
      const spec = MOUNT_VISUAL_SPECS[key];
      const def = VISUALS[spec.visualKey];
      expect(def, `VISUALS[${spec.visualKey}] missing for mount ${key}`).toBeDefined();
      expect(def.lazyPreload, `${spec.visualKey} must be lazyPreload (never boot-swept)`).toBe(
        true,
      );
      expect(def.url).toBe(`models/mounts/${key}.glb`);
      // The mount never swings: the rider's one-shots carry mounted combat.
      expect(def.clips.attack).toEqual([]);
    }
  });

  it('seats sit inside the mount body (above ground, below the crown)', () => {
    for (const key of MOUNT_KEYS) {
      const spec = MOUNT_VISUAL_SPECS[key];
      const def = VISUALS[spec.visualKey];
      expect(spec.seat, `${key} seat`).toBeGreaterThan(0.5);
      expect(spec.seat, `${key} seat above its own crown`).toBeLessThan(def.height);
    }
  });

  it('resolves specs by sim mountKey and returns null/0 when dismounted', () => {
    expect(mountVisualSpec('valorsteed')?.visualKey).toBe('mount_valorsteed');
    expect(mountVisualSpec('')).toBeNull();
    expect(mountVisualSpec('not_a_mount')).toBeNull();
    expect(mountSeatLift('grag_bear')).toBeGreaterThan(0);
    expect(mountSeatLift('')).toBe(0);
  });
});

describe('procedural bob math', () => {
  it('rigged mounts never bob (their clips carry the motion)', () => {
    const spec = MOUNT_VISUAL_SPECS.valorsteed;
    expect(mountBobY(spec, 0.37, true)).toBe(0);
    expect(mountBobY(spec, 1.9, false)).toBe(0);
  });

  it('the hover cycle floats even while standing, both directions', () => {
    const spec = MOUNT_VISUAL_SPECS.aether_hover_cycle;
    const at = (t: number) => mountBobY(spec, t, false);
    // quarter and three-quarter cycle of a 1.1 Hz sine: opposite signs
    const quarter = 0.25 / spec.bobHz;
    expect(at(quarter)).toBeCloseTo(spec.bobAmp, 5);
    expect(at(3 * quarter)).toBeCloseTo(-spec.bobAmp, 5);
  });

  it('the griffin is gait-rigged (its clips carry the motion, no bob)', () => {
    const spec = MOUNT_VISUAL_SPECS.stormfeather_griffin;
    expect(spec.rigged).toBe(true);
    expect(mountBobY(spec, 0.7, true)).toBe(0);
  });

  it('the gobbler is gait-rigged with the saddle over the hips (authored strut clips)', () => {
    const spec = MOUNT_VISUAL_SPECS.thunderstrut_gobbler;
    expect(spec.rigged).toBe(true);
    expect(spec.seat).toBe(2.05);
    expect(spec.seatFwd).toBe(-0.15);
    expect(spec.fx).toBeNull();
    expect(mountBobY(spec, 0.7, true)).toBe(0);
  });

  it('the snail glides flat (no bob at all)', () => {
    const spec = MOUNT_VISUAL_SPECS.stalkglider_snail;
    expect(mountBobY(spec, 0.5, true)).toBe(0);
  });

  it('pins the ambient particle effects: snail slime, hover-cycle exhaust', () => {
    expect(MOUNT_VISUAL_SPECS.stalkglider_snail.fx).toBe('slime');
    expect(MOUNT_VISUAL_SPECS.aether_hover_cycle.fx).toBe('exhaust');
    expect(MOUNT_VISUAL_SPECS.valorsteed.fx).toBeNull();
    expect(MOUNT_VISUAL_SPECS.stormfeather_griffin.fx).toBeNull();
  });
});
