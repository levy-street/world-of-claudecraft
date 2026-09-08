import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { weaponTrailAnchor } from '../src/render/weapon_trail_anchor';

function recorder() {
  const paths: THREE.Vector3[][] = [];
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out = { x: 0, y: 0, z: 0 }) => {
        out.x = id === 1 ? 0 : 2;
        out.y = frac * 2;
        out.z = id === 1 ? 0 : 2;
        return out;
      },
      groundYAt: (x: number, z: number) => x * 0.03 + z * 0.01,
      pathRibbon: (
        _color: number,
        _width: number,
        _life: number,
        fill: (p: THREE.Vector3[]) => number,
      ) => {
        const points = Array.from({ length: 12 }, () => new THREE.Vector3());
        fill(points);
        paths.push(points);
      },
      quality: () => 1,
      timeNow: () => 0,
      heldCcBand: () => false,
      overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
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

describe('authored physical compositions', () => {
  it('lands overhead and shield contact on recipient anatomy rather than the ground or caster', () => {
    for (const id of ['mortal_strike', 'execute', 'shield_slam']) {
      const { host } = recorder();
      const seq = new ArchetypeSequencer();
      seq.start(host, id, WARRIOR_VFX_FULL_SPECS[id], 1, 2, 0xffffff, 0, false);
      seq.update(host, 0.16);
      const first = vi.mocked(host.flipbookAt).mock.calls[0];
      expect(first, id).toBeDefined();
      expect(first[0], id).toBe(2);
      expect(first[2], id).toBe(2);
      expect(first[1], id).toBeGreaterThan(1);
    }
  });
  it('launches Bloodhook after an anchor-only preparation and reaches chest height at reduced detail', () => {
    const { host, paths } = recorder(),
      seq = new ArchetypeSequencer();
    seq.start(host, 'bloodhook', abilityVfxFullSpec('bloodhook')!, 1, 2, 0xa93232, 1, false);
    seq.update(host, 0);
    expect(paths).toHaveLength(0);
    seq.update(host, 0.04);
    expect(paths).toHaveLength(0); // steel geometry replaces lightning-like ribbons
    const calls = vi.mocked(host.crestAt!).mock.calls;
    expect(calls[0][7]).toBe('hook');
    expect(calls[1][7]).toBe('chain');
    expect(calls[1][1]).toBeCloseTo(1.1);
    const initial = calls[0][0];
    seq.update(host, 0.04);
    expect(calls[2][0]).toBeGreaterThan(initial);
    expect(paths).toHaveLength(0);
  });
  it('preserves the bright primary contact strip at reduced detail', () => {
    const results: { color: number; width: number }[][] = [];
    for (const tier of [0, 1]) {
      const { host } = recorder();
      const strips: { color: number; width: number }[] = [];
      host.pathRibbon = (color, width) => {
        strips.push({ color, width });
      };
      const seq = new ArchetypeSequencer();
      seq.start(
        host,
        'red_harvest',
        WARRIOR_VFX_FULL_SPECS.red_harvest,
        1,
        2,
        0xa93232,
        tier as 0 | 1 | 2,
        false,
      );
      seq.update(host, 0.16);
      results.push(strips);
    }
    const fullCore = results[0].find((strip) => strip.color === 0xffd0ac)!;
    for (const reduced of results.slice(1)) {
      expect(reduced[0].color).toBe(fullCore.color);
      expect(reduced[0].width).toBeCloseTo(fullCore.width);
    }
  });

  it('finishes Red Harvest and all of its particles inside the minimum GCD', () => {
    const { host } = recorder(),
      seq = new ArchetypeSequencer();
    const slot = seq.start(
      host,
      'red_harvest',
      WARRIOR_VFX_FULL_SPECS.red_harvest,
      1,
      2,
      0xffffff,
      0,
      false,
    )!;
    for (let i = 0; i < 75; i++) seq.update(host, 0.01);
    expect(slot.active).toBe(false);
    expect(host.contact).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(host.burstAt).mock.calls) expect(call[7]).toBe(0.23);
    for (const call of vi.mocked(host.fragmentsAt!).mock.calls) expect(call[9]).toBe(0.23);
  });
  it('keeps a retreat airborne until the displayed body lands on actual ground', () => {
    const { host, paths } = recorder();
    let x = 0,
      y = 0;
    host.groundYAt = () => 0;
    host.anchorOf = (_id, _frac, out = { x: 0, y: 0, z: 0 }) => {
      out.x = x;
      out.y = y;
      out.z = 0;
      return out;
    };
    const seq = new ArchetypeSequencer();
    const slot = seq.start(
      host,
      'trailbreak',
      abilityVfxFullSpec('trailbreak')!,
      1,
      1,
      0xffffff,
      0,
      false,
    )!;
    seq.update(host, 0.1);
    x = 2;
    y = 1;
    seq.update(host, 0.25);
    expect(slot.impactDone).toBe(false);
    expect(paths).toHaveLength(0);
    x = 4;
    y = 0.03;
    seq.update(host, 0.15);
    expect(slot.impactDone).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
  });
  it('coalesces a multi-component cast while keeping accents on additional victims', () => {
    const { host, paths } = recorder();
    const seq = new ArchetypeSequencer();
    const spec = WARRIOR_VFX_FULL_SPECS.red_harvest;
    const first = seq.start(host, 'red_harvest', spec, 1, 2, 0xaa3333, 0, false);
    expect(seq.start(host, 'red_harvest', spec, 1, 2, 0xaa3333, 0, false)).toBe(first);
    const second = seq.start(host, 'red_harvest', spec, 1, 3, 0xaa3333, 0, false)!;
    expect(second.physicalSecondary).toBe(true);
    seq.update(host, 0.16);
    expect(paths).toHaveLength(6); // three primary strips, three secondary wound cuts
    expect(vi.mocked(host.contact!).mock.calls.map((call) => [call[1], call[5]])).toEqual([
      [2, 0],
      [3, 0],
    ]);
    expect(host.shakeAt).toHaveBeenCalledTimes(1);
    expect(host.weaponTrail).toHaveBeenCalledTimes(2);
    expect(host.burstAt).toHaveBeenCalledTimes(2);
  });

  it('waits for actual rush arrival and cancels a stopped rush without contact', () => {
    for (const arrival of [true, false]) {
      const { host, paths } = recorder();
      let x = 0;
      host.anchorOf = (id, _frac, out = { x: 0, y: 0, z: 0 }) => {
        out.x = id === 1 ? x : 10;
        out.y = 0;
        out.z = 0;
        return out;
      };
      const seq = new ArchetypeSequencer();
      const slot = seq.start(
        host,
        'intervene',
        WARRIOR_VFX_FULL_SPECS.intervene,
        1,
        2,
        0xffffff,
        0,
        false,
      )!;
      seq.update(host, 0.15);
      expect(paths).toHaveLength(0);
      x = 4;
      seq.update(host, 0.15);
      expect(paths).toHaveLength(0);
      if (arrival) {
        x = 8;
        seq.update(host, 0.15);
        expect(paths.length).toBeGreaterThan(0);
        expect(slot.impactDone).toBe(true);
      } else {
        seq.update(host, 0.3);
        expect(paths).toHaveLength(0);
        expect(slot.active).toBe(false);
      }
    }
  });

  it('lands ground fractures even when the wire cue carries no caster', () => {
    const { host, paths } = recorder();
    host.anchorOf = () => null;
    const seq = new ArchetypeSequencer();
    seq.start(
      host,
      'heroic_leap',
      WARRIOR_VFX_FULL_SPECS.heroic_leap,
      -1,
      -1,
      0xaa9977,
      0,
      false,
      0,
      { x: 10, y: 0, z: 20 },
    );
    seq.update(host, 0.16);
    expect(paths).toHaveLength(3);
    expect(host.fragmentsAt).toHaveBeenCalled();
  });
  it('plays three distinct Red Harvest beats without any elemental sculpture or circular overlay', () => {
    const { host, paths } = recorder();
    const seq = new ArchetypeSequencer();
    const slot = seq.start(
      host,
      'red_harvest',
      WARRIOR_VFX_FULL_SPECS.red_harvest,
      1,
      2,
      0xaa3333,
      0,
      false,
    )!;
    seq.update(host, 0.16);
    expect(paths).toHaveLength(3);
    seq.update(host, 0.25);
    expect(paths).toHaveLength(6);
    seq.update(host, 0.25);
    // The third damage beat owns two opposed rising blade wakes.
    expect(paths).toHaveLength(12);
    expect(paths[0][0].distanceTo(paths[3][0])).toBeGreaterThan(0.5);
    expect(host.ringAt).not.toHaveBeenCalled();
    expect(host.elementalImpact).not.toHaveBeenCalled();
    seq.update(host, 1);
    expect(slot.active).toBe(false);
  });

  it('grounds every fault point on real terrain and retains a different shield plane', () => {
    const { host, paths } = recorder();
    const seq = new ArchetypeSequencer();
    seq.start(host, 'faultline', WARRIOR_VFX_FULL_SPECS.faultline, 1, 2, 0x998877, 0, false);
    seq.update(host, 0.16);
    for (const path of paths)
      for (const point of path)
        expect(point.y).toBeCloseTo(host.groundYAt(point.x, point.z) + 0.045);
    paths.length = 0;
    seq.clear();
    seq.start(host, 'shield_slam', WARRIOR_VFX_FULL_SPECS.shield_slam, 1, 2, 0xffffff, 0, false);
    seq.update(host, 0.16);
    expect(
      Math.max(...paths[0].map((p) => p.y)) - Math.min(...paths[0].map((p) => p.y)),
    ).toBeGreaterThan(0.5);
  });

  it('honors ring opt-outs through generic finisher, multi-hit and nova followups', () => {
    for (const archetype of ['strike', 'nova'] as const) {
      const { host } = recorder();
      const seq = new ArchetypeSequencer();
      seq.start(
        host,
        'test',
        {
          archetype,
          palette: 'physical',
          finisher: true,
          strike: { swings: 2, groundSlam: true },
          impact: { ring: false, vRing: false },
        },
        1,
        2,
        0xffffff,
        0,
        false,
      );
      for (let i = 0; i < 50; i++) seq.update(host, 0.03);
      expect(host.ringAt).not.toHaveBeenCalled();
    }
  });

  it('samples the animated real weapon and drops detached or hidden equipment', () => {
    const root = new THREE.Group(),
      holder = new THREE.Group();
    holder.userData.heldPropHolder = true;
    holder.userData.heldSlot = 0;
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.1));
    weapon.userData.weaponMesh = true;
    holder.add(weapon);
    root.add(holder);
    const sample = weaponTrailAnchor(root, 0)!;
    const point = new THREE.Vector3();
    expect(sample(point)).toBe(true);
    expect(point.y).toBeCloseTo(1);
    holder.rotation.z = Math.PI / 2;
    expect(sample(point)).toBe(true);
    expect(point.x).toBeCloseTo(-1);
    holder.visible = false;
    expect(sample(point)).toBe(false);
    holder.visible = true;
    root.remove(holder);
    expect(sample(point)).toBe(false);
    weapon.geometry.dispose();
  });
});
