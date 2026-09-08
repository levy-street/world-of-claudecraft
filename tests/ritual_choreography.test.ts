import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import { RITUAL_KIT_CHOREOGRAPHY } from '../src/render/ritual_kit_vfx_specs';

function recorder() {
  const paths: THREE.Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out = { x: 0, y: 0, z: 0 }) => {
        out.x = id === 1 ? 0 : 10;
        out.y = frac * 2;
        out.z = id === 1 ? 0 : 8;
        return out;
      },
      groundYAt: (x: number, z: number) => x * 0.03 + z * 0.02,
      pathRibbon: (_c: number, _w: number, _life: number, fill: (p: THREE.Vector3[]) => number) => {
        const points = Array.from({ length: 12 }, () => new THREE.Vector3());
        fill(points);
        paths.push(points);
      },
      quality: () => 1,
      timeNow: () => 0,
      heldCcBand: () => false,
    } as unknown as SequencerHost,
    {
      get(target, key) {
        if (!(key in target)) (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn();
        return Reflect.get(target, key);
      },
    },
  );
  return { host, paths };
}

describe('specialization ritual choreography', () => {
  it('plays every registered ritual on the existing pools without circular or elemental fallback', () => {
    for (const id of Object.keys(RITUAL_KIT_CHOREOGRAPHY)) {
      const { host, paths } = recorder(),
        seq = new ArchetypeSequencer();
      const slot = seq.start(host, id, abilityVfxFullSpec(id)!, 1, 2, 0xaaaabb, 0, false)!;
      for (let i = 0; i < 60; i++) seq.update(host, 0.05);
      expect(slot.active, id).toBe(false);
      expect(host.countPrimitive, id).toHaveBeenCalled();
      expect(host.ringAt, id).not.toHaveBeenCalled();
      expect(host.elementalImpact, id).not.toHaveBeenCalled();
      expect(host.flipbookAt, id).not.toHaveBeenCalled();
      for (const path of paths) {
        expect(
          path.every((p) => Number.isFinite(p.x + p.y + p.z)),
          id,
        ).toBe(true);
        expect(path[0].distanceTo(path[11]), id).toBeGreaterThan(0.01);
      }
    }
  });
  it('coalesces a recipient cue while preserving simultaneous heals on different bodies', () => {
    const { host, paths } = recorder(),
      seq = new ArchetypeSequencer();
    const spec = abilityVfxFullSpec('radiant_chorus')!;
    const a = seq.start(host, 'radiant_chorus', spec, 1, 2, 0xffffff, 0, false);
    expect(seq.start(host, 'radiant_chorus', spec, 1, 2, 0xffffff, 0, false)).toBe(a);
    expect(seq.start(host, 'radiant_chorus', spec, 1, 3, 0xffffff, 0, false)).not.toBe(a);
    seq.update(host, 0.16);
    expect(paths).toHaveLength(8);
  });
  it('anchors a protective blessing to the recipient, and waters to the actual terrain', () => {
    const { host, paths } = recorder(),
      seq = new ArchetypeSequencer();
    seq.start(
      host,
      'martyrs_aegis',
      abilityVfxFullSpec('martyrs_aegis')!,
      1,
      2,
      0xffffff,
      0,
      false,
    );
    seq.update(host, 0.16);
    for (const path of paths) for (const p of path) expect(p.x).toBeGreaterThan(8);
    seq.start(host, 'tidecall', abilityVfxFullSpec('tidecall')!, 1, 2, 0xffffff, 0, false);
    seq.update(host, 0.16);
    expect(host.waterVolume).toHaveBeenCalledTimes(3);
    const from = vi.mocked(host.waterVolume!).mock.calls[0][0];
    expect(from.y).toBeCloseTo(host.groundYAt(10, 8) + 0.1);
  });
  it('preserves one projectile per real Fevered Draw channel tick', () => {
    const full = abilityVfxFullSpec('rapid_fire')!,
      compact = abilityVfxSpec('rapid_fire')!;
    expect(full.archetype).toBe('bolt');
    expect(full.bolt?.volley).toBe(1);
    expect(compact.b?.vl).toBe(1);
    expect(full.self).not.toBe(true);
    expect(full.buff?.orbit).toBeUndefined();
  });
  it('reduces secondary detail at the budget boundary and leaves dedicated owners alone', () => {
    const { host, paths } = recorder(),
      seq = new ArchetypeSequencer();
    seq.start(
      host,
      'dawns_embrace',
      abilityVfxFullSpec('dawns_embrace')!,
      1,
      2,
      0xffffff,
      1,
      false,
    );
    seq.update(host, 0.16);
    expect(paths).toHaveLength(2);
    paths.length = 0;
    seq.clear();
    seq.start(host, 'sunward_disc', abilityVfxFullSpec('sunward_disc')!, 1, 2, 0xffffff, 0, false);
    seq.update(host, 0.16);
    expect(paths).toHaveLength(0);
    expect(host.ringAt).not.toHaveBeenCalled();
  });
});
