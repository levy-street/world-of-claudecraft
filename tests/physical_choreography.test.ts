import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DeferredContactBursts } from '../src/render/ability_vfx/deferred_contact_bursts';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import { abilityVfxFullSpec } from '../src/render/ability_vfx_registry';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';
import { weaponTrailAnchor } from '../src/render/weapon_trail_anchor';

function recorder(available = true) {
  const paths: THREE.Vector3[][] = [];
  const events: { name: string; at: number; args: unknown[] }[] = [];
  const deferred = new DeferredContactBursts();
  let time = 0;
  const record = (name: string, args: unknown[]) => {
    events.push({ name, at: time, args });
  };
  const host = new Proxy(
    {
      anchorOf: (id: number, frac: number, out = { x: 0, y: 0, z: 0 }) => {
        out.x = id === 1 ? 0 : 2;
        out.y = frac * 2;
        out.z = id === 1 ? 0 : 2;
        return out;
      },
      groundYAt: (x: number, z: number) => x * 0.03 + z * 0.01,
      pathRibbon: vi.fn<SequencerHost['pathRibbon']>(
        (_color: number, _width: number, _life: number, fill, ...options) => {
          const points = Array.from({ length: 12 }, () => new THREE.Vector3());
          fill(points);
          paths.push(points);
          record('pathRibbon', [_color, _width, _life, fill, ...options]);
          return true;
        },
      ),
      bakedAt: vi.fn((...args: unknown[]) => {
        record('bakedAt', args);
        return available;
      }),
      crestAt: vi.fn((...args: unknown[]) => {
        record('crestAt', args);
        return available;
      }),
      burstAt: vi.fn<SequencerHost['burstAt']>((...args) => {
        record('burstAt', args);
        const [x, y, z, color, count, power, kind, duration, delay] = args;
        if (delay !== undefined && delay > 0)
          deferred.reserve(x, y, z, color, count, power, kind, duration, delay);
        else record('particle', args);
      }),
      quality: () => 1,
      timeNow: () => time,
      heldCcBand: () => false,
      overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
    } as unknown as SequencerHost,
    {
      get(target, key) {
        if (!(key in target))
          (target as unknown as Record<PropertyKey, unknown>)[key] = vi.fn((...args: unknown[]) =>
            record(String(key), args),
          );
        return Reflect.get(target, key);
      },
    },
  );
  return {
    host,
    paths,
    events,
    advance(seq: ArchetypeSequencer, dt: number) {
      time += dt;
      // Match AbilityVfxFx.update: prior deferred emissions drain before the
      // sequencer reserves this frame's sprays. Exercise the real late-frame
      // lifetime shortening instead of assuming delay delivery is exact.
      deferred.update({ burstAt: (...args) => record('particle', args) }, dt);
      seq.update(host, dt);
    },
  };
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
      // The bright contact belongs on the incoming body surface, outside its
      // depth-tested centre, while its height remains tied to the anatomy.
      const offset = new THREE.Vector2(2 - first[0], 2 - first[2]);
      expect(offset.length(), id).toBeGreaterThanOrEqual(0.18);
      expect(offset.length(), id).toBeLessThanOrEqual(0.75);
      expect(offset.x, id).toBeGreaterThan(0);
      expect(offset.x, id).toBeCloseTo(offset.y);
      expect(first[1], id).toBeGreaterThan(1);
      expect(host.contact).toHaveBeenCalledExactlyOnceWith(
        1,
        2,
        expect.any(String),
        expect.any(Number),
        id,
        0,
      );
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
    for (const available of [true, false]) {
      const results = [0, 1].map((tier) => {
        const { host } = recorder(available);
        const seq = new ArchetypeSequencer();
        seq.start(
          host,
          'red_harvest',
          WARRIOR_VFX_FULL_SPECS.red_harvest,
          1,
          2,
          0xa93232,
          tier,
          false,
        );
        seq.update(host, 0.16);
        // Followed paths are receiving seams; caster anticipation is separate.
        return vi.mocked(host.pathRibbon).mock.calls.filter((call) => call[9] === true);
      });
      expect(results[0]).toHaveLength(2);
      expect(results[1]).toHaveLength(2);
      const backing = results[0][0],
        core = results[0][1];
      const luminance = (hex: number) => ((hex >> 16) & 255) + ((hex >> 8) & 255) + (hex & 255);
      expect(luminance(core[0])).toBeGreaterThan(luminance(backing[0]) * 2);
      expect(core[1]).toBeLessThan(backing[1]);
      expect(core[2]).toBeLessThan(backing[2]);
      results[0].forEach((full, i) => {
        const reduced = results[1][i];
        expect(reduced.slice(0, 3)).toEqual(full.slice(0, 3));
        const sample = (call: Parameters<SequencerHost['pathRibbon']>) => {
          const points = Array.from({ length: 12 }, () => new THREE.Vector3());
          expect(call[3](points)).toBe(points.length);
          expect(points.every((p) => p.toArray().every(Number.isFinite))).toBe(true);
          return points;
        };
        expect(sample(reduced)).toEqual(sample(full));
        const centre = sample(full)
          .reduce((sum, p) => sum.add(p), new THREE.Vector3())
          .multiplyScalar(1 / 12);
        expect(Math.hypot(centre.x - 2, centre.z - 2)).toBeLessThan(0.5);
      });
    }
  });

  it.each([30, 60, 100])(
    'finishes Red Harvest and all of its particles inside the minimum GCD at %s fps',
    (fps) => {
      for (const available of [true, false])
        for (const tier of [0, 1]) {
          const { host, events, advance } = recorder(available),
            seq = new ArchetypeSequencer();
          const slot = seq.start(
            host,
            'red_harvest',
            WARRIOR_VFX_FULL_SPECS.red_harvest,
            1,
            2,
            0xffffff,
            tier,
            false,
          )!;
          for (let i = 0; i < Math.ceil(0.75 * fps); i++) advance(seq, 1 / fps);
          expect(slot.active).toBe(false);
          expect(vi.mocked(host.contact!).mock.calls.map((call) => call[5])).toEqual([0, 1, 2]);
          // Arguments are the real host contract: an extraction delay consumes
          // part of the budget, not a second lifetime after the visible cutoff.
          const lifetime: Record<string, [number, number?]> = {
            pathRibbon: [2],
            flipbookAt: [7],
            bakedAt: [7, 8],
            crestAt: [9],
            burstAt: [7, 8],
            particle: [7],
            fragmentsAt: [9],
            weaponTrail: [4],
            pulseLight: [3],
            decalXZ: [5],
          };
          const timed = events.filter((event) => event.name in lifetime);
          expect(timed.some((event) => event.name === 'burstAt' && Number(event.args[8]) > 0)).toBe(
            true,
          );
          expect(timed.some((event) => event.name === 'weaponTrail')).toBe(true);
          expect(events.filter((event) => event.name === 'particle')).toHaveLength(3);
          for (const event of timed) {
            const [durationIndex, delayIndex] = lifetime[event.name];
            const duration = Number(event.args[durationIndex]);
            const delay = delayIndex === undefined ? 0 : Number(event.args[delayIndex] ?? 0);
            expect(Number.isFinite(duration) && duration > 0, event.name).toBe(true);
            expect(Number.isFinite(delay) && delay >= 0, event.name).toBe(true);
            expect(
              event.at + delay + duration,
              `${event.name} outlives the minimum GCD`,
            ).toBeLessThanOrEqual(0.75);
          }
          const contacts = vi.mocked(host.contact!).mock.calls.length;
          advance(seq, 1);
          expect(host.contact).toHaveBeenCalledTimes(contacts);
        }
    },
  );
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
    expect(paths.every((path) => path.every((p) => p.toArray().every(Number.isFinite)))).toBe(true);
    expect(vi.mocked(host.pathRibbon).mock.calls.filter((call) => call[9] === true)).toHaveLength(
      4,
    );
    expect(vi.mocked(host.contact!).mock.calls.map((call) => [call[1], call[5]])).toEqual([
      [2, 0],
      [3, 0],
    ]);
    expect(host.shakeAt).not.toHaveBeenCalled();
    expect(host.weaponTrail).toHaveBeenCalledTimes(2);
    expect(host.burstAt).toHaveBeenCalledTimes(2);
    seq.update(host, 0.17);
    expect(host.shakeAt).not.toHaveBeenCalled();
    seq.update(host, 0.17);
    expect(vi.mocked(host.contact!).mock.calls.map((call) => [call[1], call[5]])).toEqual([
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2],
    ]);
    expect(host.shakeAt).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(host.abilityAudio!).mock.calls.filter((call) => call[0] === 'release'),
    ).toHaveLength(1);
    expect(
      vi.mocked(host.abilityAudio!).mock.calls.filter((call) => call[0] === 'impact'),
    ).toHaveLength(6);
    expect(host.weaponTrail).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(host.crestAt!).mock.calls.filter((call) => call[7] === 'harvest_eruption'),
    ).toHaveLength(1);
  });

  it.each(['charge', 'intervene'])(
    'waits for actual %s arrival and cancels a stopped rush without contact',
    (id) => {
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
        const slot = seq.start(host, id, WARRIOR_VFX_FULL_SPECS[id], 1, 2, 0xffffff, 0, false)!;
        seq.update(host, 0.15);
        expect(paths).toHaveLength(0);
        x = 4;
        seq.update(host, 0.15);
        // Shoulder trails now belong to travel. Braking plumes and the actual
        // impact transition still require reaching the destination.
        expect(paths).toHaveLength(2);
        const arrivalPlumes = () =>
          vi.mocked(host.bakedAt!).mock.calls.filter((call) => call[4] === 3.8);
        expect(arrivalPlumes()).toHaveLength(0);
        expect(slot.impactDone).toBe(false);
        if (arrival) {
          x = 8;
          seq.update(host, 0.15);
          expect(arrivalPlumes()).toHaveLength(2);
          expect(slot.impactDone).toBe(true);
        } else {
          seq.update(host, 0.3);
          expect(paths).toHaveLength(2);
          expect(arrivalPlumes()).toHaveLength(0);
          expect(slot.impactDone).toBe(false);
          expect(slot.active).toBe(false);
        }
        expect(host.contact).not.toHaveBeenCalled();
        expect(host.burstAt).not.toHaveBeenCalled();
        expect(host.flipbookAt).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['charge', 'intervene'])(
    '%s tracks a moving destination and cancels a missing recipient without a false arrival',
    (id) => {
      for (const removed of [false, true]) {
        const { host } = recorder();
        let sourceX = 0,
          targetX = 10,
          present = true;
        host.anchorOf = (entity, _fraction, out = { x: 0, y: 0, z: 0 }) => {
          if (entity === 2 && !present) return null;
          return Object.assign(out, { x: entity === 1 ? sourceX : targetX, y: 0, z: 0 });
        };
        const seq = new ArchetypeSequencer();
        const slot = seq.start(host, id, WARRIOR_VFX_FULL_SPECS[id], 1, 2, 0xffffff, 0, false)!;
        seq.update(host, 0.1);
        sourceX = 8;
        targetX = 18;
        seq.update(host, 0.15);
        expect(slot.impactDone).toBe(false);
        const arrivals = () =>
          vi.mocked(host.bakedAt!).mock.calls.filter((call) => call[4] === 3.8);
        expect(arrivals()).toHaveLength(0);
        sourceX = 16;
        present = !removed;
        seq.update(host, 0.15);
        expect(slot.impactDone).toBe(!removed);
        if (removed) {
          expect(slot.active).toBe(false);
          expect(arrivals()).toHaveLength(0);
        } else {
          expect(arrivals()).toHaveLength(2);
          for (const call of arrivals()) {
            expect(Math.hypot(call[1] - sourceX, call[3])).toBeCloseTo(0.55);
            expect(call[2]).toBeCloseTo(host.groundYAt(call[1], call[3]) + 0.08);
          }
        }
        expect(host.contact).not.toHaveBeenCalled();
        expect(host.burstAt).not.toHaveBeenCalled();
        expect(host.flipbookAt).not.toHaveBeenCalled();
      }
    },
  );

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
    const { host, advance, events } = recorder();
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
    const receiving: THREE.Vector3[][] = [];
    for (let beat = 0; beat < 3; beat++) {
      advance(seq, beat === 0 ? 0.149 : 0.169);
      expect(host.contact).toHaveBeenCalledTimes(beat);
      const before = vi.mocked(host.pathRibbon).mock.calls.length;
      advance(seq, 0.0011);
      const contact = vi.mocked(host.contact!).mock.calls[beat];
      expect(contact.slice(0, 2)).toEqual([1, 2]);
      expect(contact.slice(4)).toEqual(['red_harvest', beat]);
      const seams = vi
        .mocked(host.pathRibbon)
        .mock.calls.slice(before)
        .filter((call) => call[9]);
      expect(seams).toHaveLength(2);
      const points = Array.from({ length: 12 }, () => new THREE.Vector3());
      expect(seams[0][3](points)).toBe(points.length);
      receiving.push(points);
      const audio = vi.mocked(host.abilityAudio!).mock.calls.filter((call) => call[0] === 'impact');
      expect(audio).toHaveLength(beat + 1);
      expect(audio[beat][6]?.finisher).toBe(beat === 2);
    }
    const endpoints = receiving.map((points) => points.at(-1)!.clone().sub(points[0]));
    expect(
      endpoints[0].clone().normalize().distanceTo(endpoints[1].clone().normalize()),
    ).toBeGreaterThan(0.5);
    expect(endpoints[2].length()).toBeGreaterThan(endpoints[0].length());
    const contacts = events.filter((event) => event.name === 'contact');
    contacts.forEach((event, beat) => {
      expect(event.at).toBeCloseTo(0.1501 + beat * 0.1701, 9);
    });
    expect(Number(contacts[2].args[3])).toBeGreaterThan(Number(contacts[1].args[3]));
    expect(host.shakeAt).toHaveBeenCalledTimes(1);
    expect(host.ringAt).not.toHaveBeenCalled();
    expect(host.elementalImpact).not.toHaveBeenCalled();
    seq.update(host, 1);
    expect(slot.active).toBe(false);
  });

  it('keeps confirmed component outcomes distinct when optional Harvest carriers are cold', () => {
    for (const available of [true, false])
      for (const finale of [0, 1, 2] as const) {
        const { host } = recorder(available),
          seq = new ArchetypeSequencer();
        const outcomes = [0, 2, finale] as const;
        const slots = outcomes.map((outcome) =>
          seq.start(
            host,
            'red_harvest',
            WARRIOR_VFX_FULL_SPECS.red_harvest,
            1,
            2,
            0xaa3333,
            0,
            false,
            0,
            undefined,
            outcome,
          ),
        );
        expect(slots.every((slot) => slot === slots[0])).toBe(true);
        seq.update(host, 0.16);
        expect(host.flipbookAt).not.toHaveBeenCalled();
        expect(host.contact).not.toHaveBeenCalled();
        seq.update(host, 0.17);
        expect(host.flipbookAt).toHaveBeenCalledTimes(1);
        expect(vi.mocked(host.flipbookAt).mock.calls[0][5]).toBe('contact_crush');
        expect(host.contact).not.toHaveBeenCalled();
        expect(host.burstAt).not.toHaveBeenCalled();
        seq.update(host, 0.17);
        expect(vi.mocked(host.contact!).mock.calls.map((call) => call[5])).toEqual(
          finale === 1 ? [2] : [],
        );
        expect(host.shakeAt).toHaveBeenCalledTimes(finale === 1 ? 1 : 0);
        expect(host.burstAt).toHaveBeenCalledTimes(finale === 1 ? 1 : 0);
        expect(
          vi.mocked(host.abilityAudio!).mock.calls.filter((call) => call[0] === 'impact'),
        ).toHaveLength(finale === 1 ? 1 : 0);
        expect(host.weaponTrail).toHaveBeenCalledTimes(2);
        if (finale === 1 && !available) {
          const fallback = vi
            .mocked(host.pathRibbon)
            .mock.calls.filter((call) => call[8] && !call[9])
            .slice(2);
          expect(fallback).toHaveLength(2);
          for (const path of fallback) {
            const points = Array.from({ length: 24 }, () => new THREE.Vector3());
            expect(path[3](points)).toBe(points.length);
            expect(points[0].distanceTo(points.at(-1)!)).toBeGreaterThan(12);
          }
        }
        seq.update(host, 1);
        expect(slots[0]!.active).toBe(false);
      }
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
