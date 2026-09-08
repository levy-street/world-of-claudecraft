import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { abilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { GroundAuras } from '../src/render/ability_vfx/ground_auras';
import { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { ABILITY_VFX_FULL_SPECS } from '../src/render/ability_vfx_full_specs';
import { createVfxAnchor } from '../src/render/vfx_anchor';
import { weaponTrailAnchor } from '../src/render/weapon_trail_anchor';

// The steady-state combat cost of the ability-VFX subsystem: anchors resolved
// every frame must not allocate, and the two immediate-mode buffers must upload
// only the prefix the frame wrote instead of their whole worst-case capacity.
// Both are driven through the REAL classes here (not a stub), because the
// regression these guard against is a call site quietly dropping its scratch or
// its update range, which only shows up when the live update() walk runs.

const FIREBALL_SPEC = ABILITY_VFX_FULL_SPECS.fireball;

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

/** The renderer's real anchor, wrapped to record how each resolve was made. */
function countingAnchor(heightById: (id: number) => number | null) {
  const counts = { withScratch: 0, allocating: 0 };
  const base = createVfxAnchor((id, pose) => {
    const height = heightById(id);
    if (height === null) return false;
    pose.x = id * 2;
    pose.y = 0;
    pose.z = -5;
    pose.height = height;
    return true;
  });
  const anchor = (id: number, frac: number, out?: THREE.Vector3) => {
    if (out) counts.withScratch++;
    else counts.allocating++;
    return base(id, frac, out);
  };
  return { anchor, counts };
}

function rangeOf(attr: THREE.BufferAttribute): { start: number; count: number } | null {
  const ranges = attr.updateRanges;
  return ranges.length === 1 ? { start: ranges[0].start, count: ranges[0].count } : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function queuedWeaponHarness() {
  installCanvasStub();
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.userData.heldPropHolder = true;
  holder.userData.heldSlot = 0;
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 0.1));
  weapon.userData.weaponMesh = true;
  holder.add(weapon);
  root.add(holder);
  const resolve = vi.fn((_id: number, hand: 0 | 1) => weaponTrailAnchor(root, hand));
  const fx = new AbilityVfxFx(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    () => null,
    () => 0,
    undefined,
    resolve,
  );
  const probe = fx as unknown as { overlay: OverlaySprites; orbitBandCount: number };
  const push = vi.spyOn(probe.overlay, 'push');
  const step = (held = true, dt = 1 / 60, reducedMotion = false) => {
    push.mockClear();
    if (held) fx.holdQueuedWeapon(7, 0xffb755);
    fx.update(dt, reducedMotion);
  };
  const dispose = () => {
    fx.dispose();
    weapon.geometry.dispose();
    (weapon.material as THREE.Material).dispose();
  };
  return { fx, probe, push, holder, root, resolve, step, dispose };
}

describe('queued physical weapon readiness', () => {
  it('retains its sampler when a normal aura feeds the same slot before the held queue', () => {
    const h = queuedWeaponHarness();
    try {
      for (let i = 0; i < 40; i++) {
        h.fx.orbit(7, 'weaponGlow', 0x00ffff);
        h.step();
      }
      expect(h.resolve).toHaveBeenCalledTimes(1);
      expect(h.push.mock.calls.every((call) => call[3] === 0xffb755)).toBe(true);
      h.fx.orbit(7, 'weaponGlow', 0x00ffff);
      h.step(false);
      expect(h.push).not.toHaveBeenCalled();
      h.step();
      expect(h.resolve).toHaveBeenCalledTimes(2);
      expect(h.probe.orbitBandCount).toBe(1);
    } finally {
      h.dispose();
    }
  });

  it('follows the animated weapon without a body anchor, circular motion or recurring lookups', () => {
    const h = queuedWeaponHarness();
    try {
      h.step();
      expect(h.push).toHaveBeenCalledTimes(2);
      expect(h.push.mock.calls[0].slice(0, 3)).toEqual([0, 1, 0]);
      h.holder.rotation.z = Math.PI / 2;
      for (let i = 0; i < 100; i++) h.step(true, 1 / 60, true);
      expect(h.push).toHaveBeenCalledTimes(2);
      expect(h.push.mock.calls[0][0]).toBeCloseTo(-1);
      expect(h.push.mock.calls[0][1]).toBeCloseTo(0);
      expect(h.push.mock.calls[0][2]).toBe(0);
      expect(h.resolve).toHaveBeenCalledTimes(1);
      expect(h.probe.orbitBandCount).toBe(1);
      h.step(false);
      expect(h.push).not.toHaveBeenCalled();
      expect(h.probe.orbitBandCount).toBe(0);
      h.step();
      expect(h.resolve).toHaveBeenCalledTimes(2);
      h.fx.sleepEntity(7);
      h.step(false);
      expect(h.push).not.toHaveBeenCalled();
      h.step();
      h.fx.clear();
      h.step(false);
      expect(h.push).not.toHaveBeenCalled();
      expect(h.probe.orbitBandCount).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it('stays quiet for hidden or detached equipment and retries at a bounded cadence', () => {
    const h = queuedWeaponHarness();
    try {
      h.step();
      h.holder.visible = false;
      h.step();
      expect(h.push).not.toHaveBeenCalled();
      h.holder.visible = true;
      for (let i = 0; i < 10; i++) h.step();
      expect(h.resolve).toHaveBeenCalledTimes(1);
      h.step(true, 0.3);
      expect(h.push).toHaveBeenCalledTimes(2);
      expect(h.resolve).toHaveBeenCalledTimes(2);
      h.root.remove(h.holder);
      h.step();
      expect(h.push).not.toHaveBeenCalled();
      h.root.add(h.holder);
      h.step(true, 0.3);
      expect(h.push).toHaveBeenCalledTimes(2);
      h.fx.clear();
      for (let id = 0; id < 50; id++) h.fx.holdQueuedWeapon(id, 0xffffff);
      expect(h.probe.orbitBandCount).toBe(24);
    } finally {
      h.dispose();
    }
  });
});

describe('ability VFX steady-state frame cost', () => {
  it('keeps defensive charges distinct beside mastery and clears held geometry on aura loss', () => {
    installCanvasStub();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const { anchor, counts } = countingAnchor(() => 2);
    const fx = new AbilityVfxFx(scene, camera, anchor, () => 0);
    const ribbons = (fx as unknown as { ribbons: AbilityVfxRibbons }).ribbons;
    const geometry = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
    const step = (charges: number, mastery: boolean) => {
      if (charges > 0) fx.orbit(7, 'wardCharges', 0x7fd6ff, { n: charges });
      if (mastery) fx.orbit(7, 'conduction', 0x71cce9);
      fx.update(0.1);
      return geometry.drawRange.count;
    };
    try {
      const all = step(3, true);
      expect(all).toBeGreaterThan(0);
      const two = step(2, true);
      const one = step(1, true);
      const mastery = step(0, true);
      expect(all).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(one);
      expect(one).toBeGreaterThan(mastery);
      expect(mastery).toBeGreaterThan(0);
      expect(step(0, false)).toBe(0);
      expect(counts.allocating).toBe(0);
      fx.clear();
      expect(geometry.drawRange.count).toBe(0);
    } finally {
      fx.dispose();
    }
  });

  it('lets held filaments exhaust only spare ribbon capacity while preserving attack vertices', () => {
    installCanvasStub();
    const ribbons = new AbilityVfxRibbons(new THREE.Scene(), () => null, abilityVfxTextures());
    const probe = ribbons as unknown as { geo: THREE.BufferGeometry };
    const at = new THREE.Vector3(1, 2, 3);
    ribbons.spawnSlashStyled(at, 0xff6600, 'horizontal', 1);
    const camera = new THREE.Vector3(0, 3, 8);
    ribbons.update(0, camera);
    const count = probe.geo.drawRange.count;
    expect(count).toBeGreaterThan(0);
    const position = probe.geo.getAttribute('position') as THREE.BufferAttribute;
    const before = Array.from(position.array.slice(0, 72));
    const points = [
      new THREE.Vector3(10, 0, 0),
      new THREE.Vector3(10, 1, 0),
      new THREE.Vector3(10, 2, 0),
    ];
    try {
      ribbons.update(0, camera, false, () => {
        for (let i = 0; i < 1000; i++) ribbons.appendHeld(points, 3, 0.1, 0x88ccff, 1);
      });
      expect(Array.from(position.array.slice(0, 72))).toEqual(before);
      expect(probe.geo.drawRange.count).toBeGreaterThan(count);
      expect(probe.geo.drawRange.count).toBeLessThanOrEqual(probe.geo.index?.count ?? 0);
      expect(position.updateRanges[0].count).toBeLessThanOrEqual(position.array.length);
      ribbons.update(0, camera);
      expect(probe.geo.drawRange.count).toBe(count);
    } finally {
      ribbons.dispose();
    }
  });

  it('resolves every per-frame anchor into a scratch vector, allocating none', () => {
    installCanvasStub();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const { anchor, counts } = countingAnchor(() => 2);
    const fx = new AbilityVfxFx(new THREE.Scene(), camera, anchor, () => 0);
    fx.setDelegates(vi.fn(), vi.fn(), vi.fn(), vi.fn());

    // The held families are frame-stamped, so the painter re-holds them every
    // frame: mirror that, or the pools sweep themselves and the walk goes quiet.
    const holdHeldFamilies = () => {
      for (const id of [7, 8]) {
        fx.windup(id, 0xff0000, 0.5, 'runes');
        fx.orbit(id, 'runes', 0x00ff00);
        fx.holdShell(id, 0x0000ff);
        fx.holdGroundAura(id, 0, 0x00ffff, true);
        fx.holdCcBand(id, 'stun', 3);
      }
    };
    holdHeldFamilies();
    // travelling ribbons (both anchored ends) and a live sequence, whose
    // per-frame transients (the release flash) anchor the caster every frame
    fx.cometTrail(7, 8, 0xffff00, 0.2, false);
    fx.jaggedBolt(7, 8, 0xffffff);
    fx.sequenceInstant('fireball', FIREBALL_SPEC, 7, 8, 0xff8800, 0);

    fx.update(1 / 60);
    counts.withScratch = 0;
    counts.allocating = 0;
    // three more frames of the same live state: the steady state is what costs
    for (let i = 0; i < 3; i++) {
      holdHeldFamilies();
      fx.update(1 / 60);
    }

    expect(counts.withScratch).toBeGreaterThan(20);
    expect(counts.allocating).toBe(0);
  });

  it('drops a per-frame anchor cleanly when the entity loses its view', () => {
    installCanvasStub();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld();
    const alive = new Set([7, 8]);
    const { anchor, counts } = countingAnchor((id) => (alive.has(id) ? 2 : null));
    const fx = new AbilityVfxFx(new THREE.Scene(), camera, anchor, () => 0);
    fx.setDelegates(vi.fn(), vi.fn(), vi.fn(), vi.fn());
    fx.holdShell(8, 0x0000ff);
    fx.holdGroundAura(8, 0, 0x00ffff, true);
    fx.update(1 / 60);
    expect(fx.groundAuraCountOf(8)).toBe(1);

    alive.delete(8);
    fx.update(1 / 60);
    // the null reading releases the pools rather than drawing at a stale point
    expect(fx.groundAuraCountOf(8)).toBe(0);
    expect(counts.allocating).toBe(0);
  });

  it('stops re-draping a standing wearer once, instead of chasing the breath', () => {
    installCanvasStub();
    const auras = new GroundAuras(new THREE.Scene(), abilityVfxTextures());
    let samples = 0;
    const groundY = () => {
      samples++;
      return 0;
    };
    const { anchor } = countingAnchor(() => 2);
    auras.hold(7, 0, 0x00ffff, true, 0);
    // Four seconds of a perfectly still wearer: more than a full breath cycle
    // (0.4 Hz), which used to cross the old absolute scale threshold several
    // times a second and re-drape all 42 vertices each time.
    let settledFrom = 0;
    for (let frame = 1; frame <= 240; frame++) {
      auras.hold(7, 0, 0x00ffff, true, frame);
      auras.update(1 / 60, frame / 60, frame, anchor, groundY, 0, 0);
      if (frame === 120) settledFrom = samples;
    }
    // the disc drapes while it grows in, then settles: the whole second half is
    // one center-height read per frame and not a single vertex resample
    expect(samples - settledFrom).toBe(120);
    // 3 drapes in all, every one of them inside the 0.4s grow-in, at the full
    // 42 vertices (this disc is 15 yards from the camera, inside the exact band)
    expect(samples).toBe(240 + 3 * 42);

    // ...and real movement still re-drapes: the terrain under the disc changed
    let moved = 0;
    const movingAnchor = (id: number, frac: number, out?: THREE.Vector3) => {
      const at = anchor(id, frac, out);
      if (at) at.x += moved;
      return at;
    };
    const before = samples;
    for (let frame = 241; frame <= 250; frame++) {
      moved += 0.4;
      auras.hold(7, 0, 0x00ffff, true, frame);
      auras.update(1 / 60, frame / 60, frame, movingAnchor, groundY, 0, 0);
    }
    expect(samples - before).toBeGreaterThan(100);
  });

  it('uploads only the ribbon prefix the frame wrote', () => {
    installCanvasStub();
    const { anchor } = countingAnchor(() => 2);
    const scene = new THREE.Scene();
    const ribbons = new AbilityVfxRibbons(scene, anchor, abilityVfxTextures());
    const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.aCol as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const index = geo.index as THREE.BufferAttribute;

    ribbons.spawnBoltPoints(0, 0, 0, 4, 0, 0, 0xffffff, 0.5, 0.1, 1);
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 8));

    const drawn = geo.drawRange.count;
    expect(drawn).toBeGreaterThan(0);
    // the strip is two vertices per point, and the index prefix IS the draw range
    const verts = (rangeOf(pos)?.count ?? 0) / 3;
    expect(verts).toBeGreaterThan(0);
    expect(rangeOf(pos)).toEqual({ start: 0, count: verts * 3 });
    expect(rangeOf(col)).toEqual({ start: 0, count: verts * 3 });
    expect(rangeOf(uv)).toEqual({ start: 0, count: verts * 2 });
    expect(rangeOf(index)).toEqual({ start: 0, count: drawn });
    // and that prefix is a small fraction of the worst-case buffers it lives in
    expect(verts * 3).toBeLessThan(pos.array.length / 4);

    // a second frame REPLACES the range instead of stacking one per frame
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 8));
    expect(pos.updateRanges.length).toBe(1);
    expect(index.updateRanges.length).toBe(1);
  });

  it('uploads only the overlay sprites the frame pushed', () => {
    installCanvasStub();
    const overlay = new OverlaySprites(new THREE.Scene(), abilityVfxTextures());
    const geo = (overlay as unknown as { geo: THREE.BufferGeometry }).geo;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const size = geo.attributes.aSize as THREE.BufferAttribute;
    const capacity = pos.array.length / 3;

    overlay.beginFrame();
    for (let i = 0; i < 3; i++) overlay.push(i, 1, 0, 0xffffff, 0.3, 0, 1);
    overlay.commit();
    expect(geo.drawRange.count).toBe(3);
    expect(rangeOf(pos)).toEqual({ start: 0, count: 9 });
    expect(rangeOf(size)).toEqual({ start: 0, count: 3 });
    expect(capacity).toBeGreaterThan(3);

    // a busier frame widens the range; a quieter one narrows it back
    overlay.beginFrame();
    for (let i = 0; i < 40; i++) overlay.push(i, 1, 0, 0xffffff, 0.3, 0, 1);
    overlay.commit();
    expect(rangeOf(pos)).toEqual({ start: 0, count: 120 });
    overlay.beginFrame();
    overlay.push(0, 1, 0, 0xffffff, 0.3, 0, 1);
    overlay.commit();
    expect(rangeOf(pos)).toEqual({ start: 0, count: 3 });
    expect(pos.updateRanges.length).toBe(1);
  });
});
