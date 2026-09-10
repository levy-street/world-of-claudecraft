import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { harvestBeat } from '../src/render/ability_vfx/harvest_choreography';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { SeqSlot, SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorShout } from '../src/render/ability_vfx/warrior_shouts';
import { WARRIOR_VFX_FULL_SPECS } from '../src/render/warrior_vfx_specs';

// Pooled-ribbon admission tests: verify that priority-1 tracked paths (weapon
// motion) are shielded from eviction by priority-0 decorations, and that the
// preserveActive guard works regardless of the incoming priority.
//
// ARC_SLOTS = 20 (ribbons.ts constant, not exported; hardcoded here to match).
const ARC_SLOTS = 20;

interface ArcSlotProbe {
  active: boolean;
  priority: number;
  age: number;
  life: number;
  core: THREE.Color;
  pts: THREE.Vector3[];
}
type RibbonsProbe = { arcs: ArcSlotProbe[] };

function installCanvasStub(): void {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = {
    arc: noop,
    beginPath: noop,
    clip: noop,
    closePath: noop,
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    ellipse: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    putImageData: noop,
    rect: noop,
    restore: noop,
    rotate: noop,
    save: noop,
    scale: noop,
    stroke: noop,
    translate: noop,
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

function makeRibbons(): { ribbons: AbilityVfxRibbons; probe: RibbonsProbe } {
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), () => null, abilityVfxTextures());
  const probe = ribbons as unknown as RibbonsProbe;
  return { ribbons, probe };
}

const CAM = new THREE.Vector3(0, 2, 8);

// Two-point fill that always succeeds.
const simpleFill = (pts: THREE.Vector3[]) => {
  pts[0].set(0, 0, 0);
  pts[1].set(1, 0, 0);
  return 2;
};

// Sample that always reports the given position.
const sampleAt = (x: number) => (out: THREE.Vector3) => {
  out.set(x, 0, 0);
  return true;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it('retains both Harvest extraction ribbons and receiving seams under same-frame saturation', () => {
  installCanvasStub();
  const { ribbons, probe } = makeRibbons();
  try {
    for (let i = 0; i < ARC_SLOTS; i++)
      ribbons.spawnPath(0x668899, 0.1, 1, simpleFill, true, null, false, false, 1);
    const host = new Proxy(
      {
        anchorOf: (id: number, fraction: number, out: THREE.Vector3) =>
          Object.assign(out, { x: id === 1 ? 0 : 4, y: fraction * 2, z: 0 }),
        crestAt: () => false,
        bakedAt: () => false,
        pathRibbon: ((colour, width, life, fill, brushed, motion, preserve, priority, sweep) =>
          ribbons.spawnPath(
            colour,
            width,
            life,
            fill,
            brushed,
            motion,
            preserve,
            false,
            priority,
            sweep,
          )) as SequencerHost['pathRibbon'],
      },
      { get: (target, key) => Reflect.get(target, key) ?? vi.fn() },
    ) as unknown as SequencerHost;
    harvestBeat(
      host,
      {
        abilityId: 'red_harvest',
        casterId: 1,
        targetId: 2,
        tier: 0,
        componentOutcomes: 21,
        spec: WARRIOR_VFX_FULL_SPECS.red_harvest,
      } as SeqSlot,
      2,
    );
    const extractions = () =>
      probe.arcs.filter(
        (a) =>
          a.active && Math.max(...a.pts.map((p) => p.y)) - Math.min(...a.pts.map((p) => p.y)) > 7.5,
      );
    expect(extractions()).toHaveLength(2);
    expect(probe.arcs.filter((a) => a.active && a.life < 1)).toHaveLength(4);
    ribbons.update(1 / 60, CAM);
    expect(extractions()).toHaveLength(2);
  } finally {
    ribbons.dispose();
  }
});

describe('ribbon contact admission', () => {
  it('fills normal slots then admits a priority-1 tracked path into the last free slot', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Fill ARC_SLOTS - 1 slots with priority-0 paths.
      for (let i = 0; i < ARC_SLOTS - 1; i++) {
        expect(ribbons.spawnPath(0xff0000, 0.1, 1, simpleFill)).toBe(true);
      }
      expect(probe.arcs.filter((a) => a.active).length).toBe(ARC_SLOTS - 1);

      // The tracked path uses the one remaining free slot.
      ribbons.spawnTrackedPath(0x00ff00, 0.1, 2, sampleAt(5));
      ribbons.update(0, CAM);

      const active = probe.arcs.filter((a) => a.active);
      expect(active.length).toBe(ARC_SLOTS);
      expect(active.filter((a) => a.priority === 1).length).toBe(1);
    } finally {
      ribbons.dispose();
    }
  });

  it('floods with priority-0 decorations and proves the priority-1 color/slot survive', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Spawn one priority-1 tracked path.
      ribbons.spawnTrackedPath(0xffd700, 0.15, 10, sampleAt(3));
      const trackedSlot = probe.arcs.find((a) => a.active && a.priority === 1)!;
      expect(trackedSlot).toBeDefined();

      // Fill the remaining slots with priority-0 paths.
      for (let i = 0; i < ARC_SLOTS - 1; i++) {
        ribbons.spawnPath(0xff0000, 0.1, 1, simpleFill);
      }
      expect(probe.arcs.filter((a) => a.active).length).toBe(ARC_SLOTS);

      // Flood with 80 more priority-0 decoration attempts.
      for (let i = 0; i < 80; i++) {
        ribbons.spawnPath(0xaabbcc + i, 0.1, 1, simpleFill);
      }

      ribbons.update(0, CAM);

      // The priority-1 slot object is unchanged.
      expect(trackedSlot.active).toBe(true);
      expect(trackedSlot.priority).toBe(1);
      // Pool count did not grow.
      expect(probe.arcs.length).toBe(ARC_SLOTS);
      // Exactly one priority-1 slot remains.
      expect(probe.arcs.filter((a) => a.active && a.priority === 1).length).toBe(1);
    } finally {
      ribbons.dispose();
    }
  });

  it('rejects priority-0 decoration when every slot is priority-1', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Fill all slots with priority-1 tracked paths.
      for (let i = 0; i < ARC_SLOTS; i++) {
        ribbons.spawnTrackedPath(0x00ff00, 0.1, 100, sampleAt(i));
      }
      expect(probe.arcs.filter((a) => a.active && a.priority === 1).length).toBe(ARC_SLOTS);

      // A priority-0 decoration finds no eligible slot.
      const result = ribbons.spawnPath(0xff0000, 0.1, 1, simpleFill);
      expect(result).toBe(false);

      // Nothing was evicted.
      expect(probe.arcs.filter((a) => a.active && a.priority === 1).length).toBe(ARC_SLOTS);
    } finally {
      ribbons.dispose();
    }
  });

  it('rejects any spawn when preserveActive is true and all slots are occupied', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Fill all slots with priority-0 paths.
      for (let i = 0; i < ARC_SLOTS; i++) {
        ribbons.spawnPath(0xff0000, 0.1, 1, simpleFill);
      }
      expect(probe.arcs.filter((a) => a.active).length).toBe(ARC_SLOTS);

      // preserveActive=true blocks eviction regardless of incoming priority.
      expect(ribbons.spawnPath(0x00ff00, 0.1, 1, simpleFill, false, null, true, false, 0)).toBe(
        false,
      );
      expect(ribbons.spawnPath(0x00ff00, 0.1, 1, simpleFill, false, null, true, false, 1)).toBe(
        false,
      );

      expect(probe.arcs.filter((a) => a.active).length).toBe(ARC_SLOTS);
    } finally {
      ribbons.dispose();
    }
  });

  it('frees capacity when priority-1 slots expire', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Fill all slots with very short-lived priority-1 tracked paths.
      for (let i = 0; i < ARC_SLOTS; i++) {
        ribbons.spawnTrackedPath(0x00ff00, 0.1, 0.05, sampleAt(i));
      }
      expect(probe.arcs.filter((a) => a.active && a.priority === 1).length).toBe(ARC_SLOTS);

      // Advance past their life; all slots deactivate.
      ribbons.update(0.1, CAM);
      expect(probe.arcs.filter((a) => a.active).length).toBe(0);

      // Priority-0 decorations can now fill the freed slots.
      for (let i = 0; i < 5; i++) {
        expect(ribbons.spawnPath(0xff0000, 0.1, 1, simpleFill)).toBe(true);
      }
      expect(probe.arcs.filter((a) => a.active).length).toBe(5);
    } finally {
      ribbons.dispose();
    }
  });

  it('tracked weapon path survives decoration flood and pool count stays at cap', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Spawn the tracked weapon path (priority 1, long life).
      ribbons.spawnTrackedPath(0xffd700, 0.15, 30, sampleAt(3));
      const trackedSlot = probe.arcs.find((a) => a.active && a.priority === 1)!;
      expect(trackedSlot).toBeDefined();

      // Saturate the pool and then keep flooding.
      for (let i = 0; i < 300; i++) {
        ribbons.spawnPath(0xff0000 + (i & 0xffffff), 0.1, 0.5, simpleFill);
      }

      ribbons.update(1 / 60, CAM);

      // Weapon slot is intact.
      expect(trackedSlot.active).toBe(true);
      expect(trackedSlot.priority).toBe(1);
      // No allocation growth: pool array stays at ARC_SLOTS.
      expect(probe.arcs.length).toBe(ARC_SLOTS);
      // Active count never exceeds the cap.
      expect(probe.arcs.filter((a) => a.active).length).toBeLessThanOrEqual(ARC_SLOTS);
    } finally {
      ribbons.dispose();
    }
  });

  it('evicts lowest-priority oldest slot among eligible candidates', () => {
    installCanvasStub();
    const { ribbons, probe } = makeRibbons();
    try {
      // Spawn 10 slots with life=2 (will have lower normalized age after a tick).
      for (let i = 0; i < 10; i++) {
        ribbons.spawnPath(0xaaaaaa, 0.1, 2, simpleFill);
      }
      // Spawn 10 slots with life=0.5 (will have higher normalized age after the same tick).
      for (let i = 0; i < 10; i++) {
        ribbons.spawnPath(0xbbbbbb, 0.1, 0.5, simpleFill);
      }
      expect(probe.arcs.filter((a) => a.active).length).toBe(ARC_SLOTS);

      // Advance time so the short-life slots have a much higher normalized age.
      // short-life: age/life = 0.25/0.5 = 0.50; long-life: 0.25/2.0 = 0.125.
      ribbons.update(0.25, CAM);
      // All still alive (0.25 < 0.5).
      expect(probe.arcs.filter((a) => a.active).length).toBe(ARC_SLOTS);

      // Capture the slot with the highest normalized age (should be a short-life one).
      const preEviction = probe.arcs
        .filter((a) => a.active)
        .map((a) => ({ slot: a, normAge: a.life > 0 ? a.age / a.life : 1 }))
        .sort((x, y) => y.normAge - x.normAge);
      const expectedEvictee = preEviction[0].slot;

      // Spawn one more priority-0 path: evicts the slot with the highest normalized age.
      ribbons.spawnPath(0x00ccff, 0.1, 1, simpleFill);

      // The evicted slot should now carry the new color (core was overwritten).
      // We verify indirectly: the previously highest-norm-age slot is now the
      // one with the most recently reset age (age <= 0 if no delay).
      expect(expectedEvictee.age).toBeLessThanOrEqual(0);
    } finally {
      ribbons.dispose();
    }
  });
});

it('real repeated shout accents cannot evict a retained blade contact ribbon', () => {
  installCanvasStub();
  const { ribbons, probe } = makeRibbons();
  try {
    ribbons.spawnPath(0xff1100, 0.16, 0.8, simpleFill, true, null, false, false, 1);
    const contact = probe.arcs.find((slot) => slot.active)!;
    const core = contact.core.clone();
    for (let i = 1; i < 20; i++) ribbons.spawnPath(0x668899, 0.1, 1, simpleFill);
    const pathRibbon: SequencerHost['pathRibbon'] = (
      colour,
      width,
      life,
      fill,
      brushed,
      motion,
      preserve,
      priority,
    ) => ribbons.spawnPath(colour, width, life, fill, brushed, motion, preserve, false, priority);
    const host = {
      anchorOf: (_id: number, _fraction: number, out: THREE.Vector3) =>
        Object.assign(out, { x: 0, y: 0, z: 0 }),
      groundYAt: () => 0,
      facingAt: () => 0,
      crestAt: vi.fn(),
      pulseLight: vi.fn(),
      bakedAt: vi.fn(),
      fragmentsAt: vi.fn(),
      countPrimitive: vi.fn(),
      pathRibbon,
    } as unknown as SequencerHost;
    const slot = {
      abilityId: 'piercing_howl',
      casterId: 1,
      targetId: 1,
      tier: 0,
      spec: WARRIOR_VFX_FULL_SPECS.piercing_howl,
    } as SeqSlot;
    for (let cast = 0; cast < 10; cast++)
      for (let beat = 0; beat < 3; beat++) drawWarriorShout(host, slot, beat);
    expect(contact.active).toBe(true);
    expect(contact.core.equals(core)).toBe(true);
    expect(contact.priority).toBe(1);
    expect(contact.life).toBe(0.8);
  } finally {
    ribbons.dispose();
  }
});
