import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { RestorativeWaterVolumes } from '../src/render/ability_vfx/water_volumes';
import { drawRestorativeStream } from '../src/render/restorative_water';
import { drawShamanCascade } from '../src/render/shaman_cascade';

const from = { x: 4, y: 1.3, z: -2 };
const to = { x: 12, y: 1.1, z: 3 };
function fixture() {
  const paths: THREE.Vector3[][] = [];
  const host = {
    waterVolume: vi.fn<NonNullable<SequencerHost['waterVolume']>>(),
    pathRibbon: vi.fn<SequencerHost['pathRibbon']>((_color, _width, _life, fill) => {
      const points = Array.from({ length: 12 }, () => new THREE.Vector3());
      paths.push(points.slice(0, fill(points)));
      return true;
    }),
    burstAt: vi.fn<SequencerHost['burstAt']>(),
    groundYAt: vi.fn(() => 0.3),
  };
  return { host, paths };
}

describe('Cascading Mend confirmed-hop shape', () => {
  it('connects only the confirmed endpoints with a broad elevated river and steep receiving fall', () => {
    const h = fixture();
    const original = structuredClone([from, to]);
    drawShamanCascade(h.host, from, to, 1, false);
    const [span] = h.host.waterVolume.mock.calls;
    expect(h.host.waterVolume).toHaveBeenCalledTimes(1);
    expect(span[0]).toEqual(from);
    expect(span[1]).toEqual(to);
    expect(span[6]).toBe(1);
    expect(span[7]).toBe(4);
    expect(span[4]).toBe(0.4);
    expect(span[5]).toBe(1.15);
    expect([from, to]).toEqual(original);
    for (const path of h.paths) {
      expect(path[0].toArray()).toEqual([from.x, from.y, from.z]);
      expect(path[path.length - 1].x).toBeCloseTo(to.x);
      expect(path[path.length - 1].y).toBeCloseTo(to.y);
      expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(4.5);
      expect(Math.max(...path.map((p) => p.y))).toBeLessThan(5.5);
    }
    const delayed = h.host.burstAt.mock.calls.filter((call) => (call[8] ?? 0) > 0);
    expect(delayed).toHaveLength(2);
    expect(delayed.map((call) => call[8])).toEqual([0.12, 0.19]);
    expect(delayed.every((call) => Math.hypot(call[0] - to.x, call[2] - to.z) < 1)).toBe(true);
    expect(delayed.every((call) => call[1] === 0.48)).toBe(true);
  });

  it('keeps the same connected silhouette at low quality while shedding fine detail', () => {
    const high = fixture(),
      low = fixture();
    drawShamanCascade(high.host, from, to, 1, false);
    drawShamanCascade(low.host, from, to, 0, false);
    expect(low.host.waterVolume.mock.calls).toEqual(high.host.waterVolume.mock.calls);
    expect(high.paths).toHaveLength(2);
    expect(low.paths).toHaveLength(1);
    const count = (h: ReturnType<typeof fixture>) =>
      h.host.burstAt.mock.calls.reduce((sum, call) => sum + call[4], 0);
    expect(count(low)).toBeLessThan(count(high));
  });

  it('omits ballistic and delayed splashes under reduced motion without dropping the link', () => {
    const h = fixture();
    drawShamanCascade(h.host, from, to, 1, true);
    expect(h.host.waterVolume).toHaveBeenCalledTimes(1);
    expect(h.paths).toHaveLength(2);
    expect(h.host.burstAt).not.toHaveBeenCalled();
  });

  it('adapts crest height to the actual hop and remains finite for vertical hops or absent terrain', () => {
    const short = fixture(),
      long = fixture();
    drawShamanCascade(short.host, from, { ...from, x: from.x + 1 }, 1, false);
    drawShamanCascade(long.host, from, to, 1, false);
    expect(Math.max(...long.paths[0].map((p) => p.y))).toBeGreaterThan(
      Math.max(...short.paths[0].map((p) => p.y)),
    );
    const vertical = fixture();
    vertical.host.groundYAt.mockReturnValue(NaN);
    drawShamanCascade(vertical.host, from, { ...from, y: 8 }, 1, false);
    expect(vertical.paths.flat().every((p) => p.toArray().every(Number.isFinite))).toBe(true);
    expect(
      vertical.host.burstAt.mock.calls.every((call) => call.slice(0, 3).every(Number.isFinite)),
    ).toBe(true);
  });

  it('rejects coincident or invalid endpoints without decorating an invented recipient', () => {
    const h = fixture();
    drawShamanCascade(h.host, from, from, 1, false);
    drawShamanCascade(h.host, from, { ...to, x: NaN }, 1, false);
    expect(h.host.waterVolume).not.toHaveBeenCalled();
    expect(h.host.burstAt).not.toHaveBeenCalled();
    expect(h.host.pathRibbon).not.toHaveBeenCalled();
  });

  it('retains all four real hops under actual twelve-slot pool pressure without allocating resources', () => {
    const scene = new THREE.Scene();
    const water = new RestorativeWaterVolumes(scene);
    const geometry = water.mesh.geometry,
      material = water.mesh.material;
    const h = fixture();
    h.host.waterVolume.mockImplementation((...args) => water.spawn(...args));
    for (let i = 0; i < 4; i++) {
      drawShamanCascade(h.host, { x: i * 8, y: 1, z: 0 }, { x: i * 8 + 6, y: 1, z: 2 }, 1, false);
      water.spawn(
        { x: 100 + i, y: 3, z: 0 },
        { x: 100 + i, y: 0, z: 0 },
        0x288d9d,
        0xbdece0,
        0.4,
        1,
        0,
      );
    }
    const life = geometry.getAttribute('aLife');
    const starts = geometry.getAttribute('aFrom');
    const origins = Array.from({ length: starts.count }, (_, i) => starts.getX(i));
    for (let i = 0; i < 4; i++) expect(origins).toContain(100 + i);
    for (let i = 0; i < 8; i++)
      water.spawn(
        { x: 200 + i, y: 3, z: 0 },
        { x: 200 + i, y: 0, z: 0 },
        0x288d9d,
        0xbdece0,
        0.4,
        1,
        0,
      );
    expect(
      Array.from({ length: life.count }, (_, i) => life.getW(i)).filter((p) => p === 1),
    ).toHaveLength(4);
    for (let hop = 0; hop < 4; hop++) {
      const primaryIndex = Array.from({ length: life.count }, (_, i) => i).find(
        (i) => life.getW(i) === 1 && starts.getX(i) === hop * 8,
      );
      expect(primaryIndex).toBeDefined();
      const targets = geometry.getAttribute('aTo');
      expect(targets.getX(primaryIndex!)).toBe(hop * 8 + 6);
      expect(targets.getZ(primaryIndex!)).toBe(2);
    }
    expect(geometry.instanceCount).toBe(12);
    expect(scene.children).toHaveLength(1);
    water.update(0.2, true);
    expect(material.uniforms.uMotion.value).toBe(0);
    water.update(1, false);
    expect(water.mesh.visible).toBe(false);
    water.clear();
    expect(water.mesh.geometry).toBe(geometry);
    expect(water.mesh.material).toBe(material);
    water.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('leaves the shared non-Shaman stream at its existing single-span behavior', () => {
    const h = fixture();
    drawRestorativeStream(h.host, from, to);
    expect(h.host.waterVolume).toHaveBeenCalledTimes(1);
    expect(h.host.waterVolume.mock.calls[0].slice(0, 2)).toEqual([from, to]);
    expect(h.host.burstAt).not.toHaveBeenCalled();
    expect(h.host.pathRibbon).not.toHaveBeenCalled();
  });
});
