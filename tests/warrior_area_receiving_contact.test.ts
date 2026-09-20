import { Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorAreaContact } from '../src/render/ability_vfx/warrior_area';

it.each([
  ['cleave', 10.5, 4.2, 0.28],
  ['whirlwind', 10, 4.2, 0.28],
  ['bladestorm', 12, 5.2, 0.32],
  ['revenge', 10, 4.2, 0.28],
] as const)(
  '%s retains its receiving seam on the moving enemy without replaying an area effect',
  (id, flashSize, flashHdr, flashDuration) => {
    const target = { x: 0, y: 1, z: 3 };
    let visible = true,
      yaw = 0;
    const host = new Proxy(
      {
        anchorOf: (who: number, _height: number, out = { x: 0, y: 0, z: 0 }) =>
          !visible && who === 2
            ? null
            : Object.assign(out, who === 2 ? target : { x: 0, y: 0, z: 0 }),
        facingAt: (who: number) => (who === 2 ? yaw : 0),
        pathRibbon: vi.fn(() => true),
      },
      {
        get(object, key) {
          if (!(key in object)) Reflect.set(object, key, vi.fn());
          return Reflect.get(object, key);
        },
      },
    ) as unknown as SequencerHost;
    expect(drawWarriorAreaContact(host, id, 1, 2, 1, 0)).toBe(true);
    const paths = vi.mocked(host.pathRibbon).mock.calls;
    expect(paths).toHaveLength(1);
    const fill = paths[0][3];
    const points = Array.from({ length: 25 }, () => new Vector3());
    expect(fill(points)).toBe(25);
    const before = points.map((p) => p.clone());
    target.x += 7;
    target.y += 2;
    target.z -= 4;
    expect(fill(points)).toBe(25);
    points.forEach((p, i) => {
      expect(p.distanceTo(before[i].add(new Vector3(7, 2, -4)))).toBeLessThan(1e-6);
    });
    expect(paths[0][9]).toBe(true);
    expect(host.crestAt).not.toHaveBeenCalled();
    expect(host.contact).toHaveBeenCalledTimes(1);
    const flash = vi.mocked(host.flipbookAt).mock.calls[0];
    expect(flash[2]).toBeLessThan(3);
    expect(flash.slice(3, 8)).toEqual([
      flashSize,
      0xb5d5ed,
      'warrior_steel_flash',
      flashHdr,
      flashDuration,
    ]);
    expect(flash[9]).toBe(1.3);
    const translated = points.map((p) => p.clone());
    yaw = Math.PI / 2;
    expect(fill(points)).toBe(25);
    const origin = new Vector3(target.x, target.y, target.z);
    points.forEach((p, i) => {
      const expected = translated[i]
        .sub(origin)
        .applyAxisAngle(new Vector3(0, 1, 0), yaw)
        .add(origin);
      expect(p.distanceTo(expected)).toBeLessThan(1e-6);
    });
    visible = false;
    expect(fill(points)).toBe(0);
  },
);
