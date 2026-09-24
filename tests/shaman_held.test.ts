import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ShamanHeld, type ShamanHeldEntity } from '../src/render/ability_vfx/shaman_held';
import { PRIMAL_EXALTATION_ID, STONEWARD_ID } from '../src/sim/combat/shaman_talents';

type Aura = ShamanHeldEntity['auras'][number];
function actor(id: number, auras: readonly Aura[]): ShamanHeldEntity {
  return { id, auras, hp: 100, maxHp: 100, dead: false };
}
function harness() {
  const held = new ShamanHeld();
  const paths: { points: number[][]; color: number; width: number }[] = [];
  const particles: number[][] = [];
  const anchored: number[] = [];
  const ribbons = {
    appendHeld(points: THREE.Vector3[], count: number, width: number, color: number) {
      paths.push({ points: points.slice(0, count).map((p) => p.toArray()), color, width });
    },
  };
  const overlay = {
    push(
      x: number,
      y: number,
      z: number,
      color: number,
      size: number,
      cell: number,
      alpha: number,
      brightness = 1,
      priority: 0 | 1 = 0,
    ) {
      particles.push([x, y, z, color, size, cell, alpha, brightness, priority]);
    },
  };
  const host = {
    anchorOf(id: number, _fraction: number, out: THREE.Vector3) {
      anchored.push(id);
      return out.set(id * 10, 0, 0);
    },
    facingAt: () => 0,
  };
  const draw = (frame = 1, time = 2, reduced = false, quality = 1) => {
    paths.length = 0;
    particles.length = 0;
    anchored.length = 0;
    held.draw(frame, time, reduced, quality, host, ribbons, overlay);
  };
  return { held, paths, particles, anchored, ribbons, overlay, host, draw };
}

describe('Shaman held states', () => {
  it('keeps Lifespring protection on the real recipient only while its absorb is live', () => {
    const h = harness();
    for (const quality of [0, 0.25, 0.5, 0.75, 1]) {
      h.held.sync(
        1,
        actor(7, [{ id: 'unleash_weapon', kind: 'absorb', value: 50, remaining: 0.05 }]),
      );
      h.draw(1, 12, true, quality);
      expect(h.paths).toHaveLength(quality >= 0.5 ? 4 : 2);
      expect(h.anchored).toEqual([7]);
      expect(
        h.paths.every((p) => p.points.every(([x, y]) => Math.abs(x - 70) < 1.1 && y < 1.6)),
      ).toBe(true);
      for (const aura of [
        { id: 'unleash_weapon', kind: 'absorb', value: 0, remaining: 8 },
        { id: 'unleash_weapon', kind: 'absorb', value: 50, remaining: 0 },
        { id: 'unleash_weapon', kind: 'buff', value: 50, remaining: 8 },
      ]) {
        h.held.sync(1, actor(7, [aura]));
        h.draw(1, 12, true, quality);
        expect(h.paths).toHaveLength(0);
      }
    }
    h.held.dispose();
  });

  it('announces actual Chorus recipients, sustains the buff and clears exactly on expiry', () => {
    const h = harness();
    const aura = { id: 'bloodlust', kind: 'buff_haste', remaining: 15, sourceId: 1 };
    for (const quality of [0, 0.25, 0.5, 0.75, 1]) {
      h.held.sync(1, actor(7, [aura]));
      h.held.sync(1, actor(8, []));
      h.draw(1, 2, true, quality);
      expect(h.anchored).toEqual([7]);
      expect(h.paths).toHaveLength(4);
      const arrivalHeight = Math.max(...h.paths.flatMap((p) => p.points.map((v) => v[1])));
      h.held.sync(1, actor(7, [{ ...aura, remaining: 5 }]));
      h.draw(1, 2, true, quality);
      expect(h.paths).toHaveLength(4);
      expect(Math.max(...h.paths.flatMap((p) => p.points.map((v) => v[1])))).toBeLessThan(
        arrivalHeight,
      );
      h.held.sync(1, actor(7, [{ ...aura, remaining: 0 }]));
      h.draw(1, 2, true, quality);
      expect(h.paths).toHaveLength(0);
    }
    h.held.sync(1, actor(7, [{ ...aura, kind: 'sated' }]));
    h.draw();
    expect(h.paths).toHaveLength(0);
    h.held.dispose();
  });

  it('protects all ten own-party Chorus recipients amid forty unrelated wearers', () => {
    const h = harness();
    for (let id = 1; id <= 40; id++)
      h.held.sync(1, actor(id, [{ id: 'elemental_mastery', remaining: 5 }]), 50);
    for (let id = 50; id < 60; id++)
      h.held.sync(
        1,
        actor(id, [{ id: 'bloodlust', kind: 'buff_haste', remaining: 15, sourceId: 50 }]),
        50,
      );
    h.draw(1, 2, true, 1);
    expect(h.anchored.slice(0, 10).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => 50 + i),
    );
    const party = h.paths.filter((p) => p.points[0][0] > 490);
    expect(party).toHaveLength(20);
    expect(party.every((p) => p.points.length === 8)).toBe(true);
    h.held.dispose();
  });

  it('shows exactly the real offensive bank and never duplicates defensive Ward', () => {
    const h = harness();
    for (let stacks = 0; stacks <= 5; stacks++) {
      h.held.sync(
        1,
        actor(1, [
          { id: 'shaman_thunder_charges', remaining: 20, stacks },
          { id: 'lightning_shield', remaining: 20, charges: 3 },
        ]),
      );
      h.draw();
      expect(h.paths).toHaveLength(stacks);
      expect(h.particles).toHaveLength(stacks);
    }
  });

  it('retains the complete bank silhouette at low quality', () => {
    const h = harness();
    h.held.sync(1, actor(1, [{ id: 'shaman_thunder_charges', remaining: 20, stacks: 5 }]));
    h.draw(1, 0, false, 0);
    expect(h.paths).toHaveLength(5);
  });

  it('removes expired, consumed, dead and no-longer-synchronized states immediately', () => {
    const h = harness();
    const aura = { id: 'shaman_thunder_charges', remaining: 1, stacks: 4 };
    h.held.sync(1, actor(1, [aura]));
    h.draw();
    expect(h.paths).toHaveLength(4);
    h.draw(2);
    expect(h.paths).toHaveLength(0);
    h.held.sync(2, actor(1, [{ ...aura, remaining: 0 }]));
    h.draw(2);
    expect(h.paths).toHaveLength(0);
    h.held.sync(2, actor(1, [aura]));
    h.held.sync(2, { ...actor(1, [aura]), dead: true });
    h.draw(2);
    expect(h.paths).toHaveLength(0);
    h.held.sync(2, actor(1, [aura]));
    h.held.sync(2, actor(1, []));
    h.draw(2);
    expect(h.paths).toHaveLength(0);
  });

  it('keeps positive healing storage on its actual recipient without drawing neighbours or links', () => {
    const h = harness();
    h.held.sync(
      1,
      actor(7, [{ id: 'shaman_mending_current', remaining: 12, value: 15, sourceId: 1 }]),
      1,
    );
    h.held.sync(1, actor(8, []), 1);
    h.draw();
    expect(h.anchored).toEqual([7]);
    expect(h.paths).toHaveLength(4);
    expect(h.particles).toHaveLength(0);
    for (const path of h.paths)
      for (const p of path.points) expect(Math.abs(p[0] - 70)).toBeLessThan(1);
  });

  it('does not invent a bank for zero, invalid or expired values', () => {
    const h = harness();
    for (const value of [0, -1, NaN, Infinity]) {
      h.held.sync(1, actor(7, [{ id: 'shaman_mending_current', remaining: 12, value }]));
      h.draw();
      expect(h.paths).toHaveLength(0);
    }
    h.held.sync(1, actor(7, [{ id: 'shaman_mending_current', remaining: 0, value: 30 }]));
    h.draw();
    expect(h.paths).toHaveLength(0);
  });

  it('requires real duration and maximum health before sizing a healing reservoir', () => {
    const h = harness();
    for (const entity of [
      { id: 7, auras: [{ id: 'shaman_mending_current', remaining: 12, value: 15, sourceId: 1 }] },
      { ...actor(7, [{ id: 'shaman_mending_current', value: 15, sourceId: 1 }]) },
    ]) {
      h.held.sync(1, entity, 1);
      h.draw();
      expect(h.paths).toHaveLength(0);
    }
  });

  it('prefers the local healers actual bank without summing other healers reservoirs', () => {
    const h = harness();
    const local = { id: 'shaman_mending_current', remaining: 12, value: 6, sourceId: 1 };
    h.held.sync(1, actor(7, [local]), 1);
    h.draw();
    const first = JSON.stringify(h.paths);
    h.held.sync(1, actor(7, [{ ...local, sourceId: 9, value: 30 }, local]), 1);
    h.draw();
    expect(JSON.stringify(h.paths)).toBe(first);
    h.held.sync(1, actor(7, [local, { ...local, sourceId: 9, value: 30 }]), 1);
    h.draw();
    expect(JSON.stringify(h.paths)).toBe(first);
  });

  it('tracks Stoneward remaining charges instead of leaving depleted protection', () => {
    const h = harness();
    for (let charges = 6; charges >= 0; charges--) {
      h.held.sync(1, actor(1, [{ id: STONEWARD_ID, remaining: 60, charges }]));
      h.draw();
      expect(h.paths).toHaveLength(charges);
    }
  });

  it('gives protection, mastery, exaltation and haste distinct held contours that can coexist', () => {
    const h = harness();
    const ids = ['elemental_trance', 'elemental_mastery', PRIMAL_EXALTATION_ID, 'bloodlust'];
    const contours = new Set<string>();
    for (const id of ids) {
      h.held.sync(1, actor(1, [{ id, remaining: 12 }]));
      h.draw();
      expect(h.paths).toHaveLength(
        id === 'shaman_primal_exaltation' ? 6 : id === 'bloodlust' ? 4 : 2,
      );
      contours.add(JSON.stringify(h.paths.map((p) => p.points)));
    }
    expect(contours.size).toBe(4);
    h.held.sync(
      1,
      actor(
        1,
        ids.map((id) => ({ id, remaining: 12 })),
      ),
    );
    h.draw();
    expect(h.paths).toHaveLength(14);
  });

  it('freezes cosmetic motion with reduced motion and never creates timed heal bursts', () => {
    const h = harness();
    h.held.sync(
      1,
      actor(1, [
        { id: 'shaman_thunder_charges', remaining: 30, stacks: 3 },
        { id: 'shaman_mending_current', remaining: 12, value: 15 },
        { id: 'elemental_trance', remaining: 15 },
      ]),
    );
    h.draw(1, 1, true);
    const frozen = JSON.stringify([h.paths, h.particles]);
    h.draw(1, 20, true);
    expect(JSON.stringify([h.paths, h.particles])).toBe(frozen);
    h.draw(1, 20, false);
    expect(JSON.stringify([h.paths, h.particles])).not.toBe(frozen);
  });

  it('caps actors at 24 and admits a preferred local wearer under pressure', () => {
    const h = harness();
    for (let id = 1; id <= 40; id++)
      h.held.sync(1, actor(id, [{ id: 'elemental_trance', remaining: 15 }]));
    h.draw();
    expect(h.anchored).toHaveLength(24);
    h.held.sync(1, actor(99, [{ id: 'elemental_trance', remaining: 15 }]), 99);
    h.draw();
    expect(h.anchored).toHaveLength(24);
    expect(h.anchored).toContain(99);
    h.held.clear();
    h.draw();
    expect(h.paths).toHaveLength(0);
    h.held.dispose();
    h.held.sync(1, actor(1, [{ id: 'elemental_trance', remaining: 15 }]));
    h.draw();
    expect(h.paths).toHaveLength(0);
  });

  it('anchors weapon imbues to the real equipment and omits absent equipment', () => {
    const h = harness();
    h.held.sync(1, actor(1, [{ id: 'flametongue_weapon', remaining: 60 }]));
    h.draw();
    expect(h.paths).toHaveLength(0);
    expect(h.particles).toHaveLength(0);
    const sample = Object.assign(
      (out: THREE.Vector3) => {
        out.set(3, 4, 5);
        return true;
      },
      {
        frame: (out: THREE.Matrix4) => {
          out.makeTranslation(3, 4, 5);
          return true;
        },
      },
    );
    h.held.draw(1, 3, false, 1, h.host, h.ribbons, h.overlay, (_id, hand) =>
      hand === 0 ? sample : null,
    );
    expect(h.particles).toHaveLength(2);
    expect(h.particles.every((p) => Math.abs(p[0] - 3) < 0.1)).toBe(true);
    // Two persistent ember faces and two flame tongues, all on actual equipment.
    expect(h.paths).toHaveLength(4);
    expect(h.paths[0].points.every((p) => Math.abs(p[0] - 3) < 0.1)).toBe(true);
  });
});
