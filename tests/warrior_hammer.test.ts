import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { OVERLAY_CELL } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { warriorHammerCel } from '../src/render/ability_vfx/warrior_control_atlas';
import {
  drawWarriorHammerContact,
  launchWarriorHammer,
} from '../src/render/ability_vfx/warrior_hammer';

const CASTER = 1;
const TARGET = 2;
const CAM = new THREE.Vector3(0, 0, 10);

// Fake texture proxy: every property access returns the same placeholder texture,
// satisfying AbilityVfxTextures without a real canvas context.
function fakeTextures(): { textures: AbilityVfxTextures; texture: THREE.CanvasTexture } {
  const texture = new THREE.CanvasTexture({} as HTMLCanvasElement);
  return { texture, textures: new Proxy({}, { get: () => texture }) as AbilityVfxTextures };
}

// Ribbon-internal anchor: CASTER lands at x=cx, TARGET at x=tx, both at y=1.
// Ignores heightFrac so the test positions are stable across spawn and update.
function fixedAnchor(cx: number, tx: number) {
  return (id: number, _frac: number, out?: THREE.Vector3): THREE.Vector3 | null => {
    const v = out ?? new THREE.Vector3();
    if (id === CASTER) return v.set(cx, 1, 0);
    if (id === TARGET) return v.set(tx, 1, 0);
    return null;
  };
}

// Minimal host for launchWarriorHammer: anchorOf always resolves the caster so the
// function does not early-return, and abilityAudio is stubbed.
function launchHost(audio = vi.fn()) {
  return {
    anchorOf(_id: number, _frac: number, out?: { x: number; y: number; z: number }) {
      const o = out ?? { x: 0, y: 0, z: 0 };
      o.x = 0;
      o.y = 1;
      o.z = 0;
      return o;
    },
    abilityAudio: audio,
  } as unknown as SequencerHost;
}

// Contact host with individually spy-able effect methods for drawWarriorHammerContact.
function makeContactHost(casterX = 0, targetX = 5) {
  const flipbookAt = vi.fn();
  const bakedAt = vi.fn();
  const fragmentsAt = vi.fn();
  const contact = vi.fn();
  const burstAt = vi.fn();
  const pulseLight = vi.fn();
  const countPrimitive = vi.fn();
  const pathRibbon = vi.fn<SequencerHost['pathRibbon']>(() => true);
  const abilityAudio = vi.fn();
  const shakeAt = vi.fn();
  const target = { x: targetX, y: 3, z: 0, height: 2, yaw: 0.2, present: true };
  const host = {
    anchorOf(id: number, fraction: number, out?: { x: number; y: number; z: number }) {
      const o = out ?? { x: 0, y: 0, z: 0 };
      if (id === CASTER) {
        o.x = casterX;
        o.y = 3 + fraction * 2;
        o.z = 0;
        return o;
      }
      if (id === TARGET && target.present) {
        o.x = target.x;
        o.y = target.y + fraction * target.height;
        o.z = target.z;
        return o;
      }
      return null;
    },
    flipbookAt,
    bakedAt,
    fragmentsAt,
    contact,
    burstAt,
    pulseLight,
    countPrimitive,
    pathRibbon,
    abilityAudio,
    shakeAt,
    facingAt: (id: number) => (id === TARGET ? target.yaw : 0),
  } as unknown as SequencerHost;
  return {
    host,
    flipbookAt,
    bakedAt,
    fragmentsAt,
    contact,
    burstAt,
    pulseLight,
    countPrimitive,
    pathRibbon,
    abilityAudio,
    shakeAt,
    target,
  };
}

// warriorHammerCel

it('warriorHammerCel cycles through 8 cels at 24 fps and freezes at cel 0 under reduced motion', () => {
  for (let cel = 0; cel < 8; cel++) {
    expect(warriorHammerCel(cel / 24, false)).toBe(cel);
  }
  expect(warriorHammerCel(8 / 24, false)).toBe(0); // full cycle wraps back to 0
  expect(warriorHammerCel(0.5, true)).toBe(0);
  expect(warriorHammerCel(5, true)).toBe(0);
});

// launchWarriorHammer + trail flight

it('hammer trail head advances at 26 yards per second', () => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 26), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);

  // 26 yd/s x 0.5 s = 13 yd
  ribbons.update(0.5, CAM);

  const xs: number[] = [];
  ribbons.drawHeads(0, (x) => xs.push(x));
  expect(xs).toHaveLength(1);
  expect(xs[0]).toBeCloseTo(13, 6);

  ribbons.dispose();
  texture.dispose();
});

it('drawHeads emits hammer atlas cells and never the glow cell', () => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 20), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);
  ribbons.update(0.1, CAM);

  const cells: number[] = [];
  // time = 3/24 s so warriorHammerCel(3/24, false) = 3 so emits hammer0 + 3
  ribbons.drawHeads(3 / 24, (_x, _y, _z, _c, _s, cell) => cells.push(cell));

  expect(cells).toHaveLength(1);
  expect(cells[0]).toBeGreaterThanOrEqual(OVERLAY_CELL.hammer0);
  expect(cells[0]).toBeLessThan(OVERLAY_CELL.hammer0 + 8);
  expect(cells[0]).not.toBe(OVERLAY_CELL.glow);

  ribbons.dispose();
  texture.dispose();
});

it('uses the prepared solid on the same flight, falls back and expires without duplicating heads', () => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 26), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);
  ribbons.update(0.1, CAM);
  const sprite = vi.fn(),
    solid = vi.fn((_x: number) => true);
  ribbons.drawHeads(0.1, sprite, false, solid);
  expect(sprite).not.toHaveBeenCalled();
  expect(solid).toHaveBeenCalledOnce();
  expect(solid.mock.calls[0][0]).toBeCloseTo(2.6);
  solid.mockClear();
  ribbons.drawHeads(400, sprite, false, solid);
  expect((solid.mock.calls[0] as unknown[])[5]).toBeCloseTo(0.1);
  solid.mockReturnValue(false);
  ribbons.drawHeads(0.1, sprite, true, solid);
  expect(sprite).toHaveBeenCalledOnce();
  expect(sprite.mock.calls[0][5]).toBe(OVERLAY_CELL.hammer0);
  ribbons.update(1, CAM);
  solid.mockClear();
  sprite.mockClear();
  ribbons.drawHeads(1.1, sprite, false, solid);
  expect(solid).not.toHaveBeenCalled();
  expect(sprite).not.toHaveBeenCalled();
  ribbons.dispose();
  texture.dispose();
});

it('reduced motion freezes tumble at cel 0 while flight still advances', () => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 26), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);

  ribbons.update(0.3, CAM, true /* reducedMotion */);

  // With reducedMotion=true, warriorHammerCel(3/24, true) = 0 so cel = hammer0 exactly
  const seen: { x: number; cell: number }[] = [];
  ribbons.drawHeads(3 / 24, (x, _y, _z, _c, _s, cell) => seen.push({ x, cell }), true);

  expect(seen).toHaveLength(1);
  expect(seen[0].x).toBeGreaterThan(0); // flight advanced: 26 yd/s x 0.3 s approximately 7.8 yd
  expect(seen[0].cell).toBe(OVERLAY_CELL.hammer0); // tumble frozen at cel 0

  // Without reducedMotion the same time produces cel 3
  const cellsMotion: number[] = [];
  ribbons.drawHeads(3 / 24, (_x, _y, _z, _c, _s, cell) => cellsMotion.push(cell), false);
  expect(cellsMotion[0]).toBe(OVERLAY_CELL.hammer0 + 3);

  ribbons.dispose();
  texture.dispose();
});

it('missing target terminates flight without triggering arrival effects', () => {
  const { textures, texture } = fakeTextures();
  // Target anchor always null: spawnTrailSlot starts the slot but update calls terminateTrail
  const anchor = (id: number, _frac: number, out?: THREE.Vector3): THREE.Vector3 | null => {
    if (id !== CASTER) return null;
    return (out ?? new THREE.Vector3()).set(0, 1, 0);
  };
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), anchor, textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);

  ribbons.update(0.1, CAM);

  // terminateTrail fires: slot becomes inactive; no head is drawn
  const heads: number[] = [];
  ribbons.drawHeads(0, (x) => heads.push(x));
  expect(heads).toHaveLength(0);

  ribbons.dispose();
  texture.dispose();
});

it('arrival fires no predicted damage callback', () => {
  const { textures, texture } = fakeTextures();
  // Target 0.3 yd away: first update step (26 x 0.2 = 5.2 yd) exceeds distance so arrives
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 0.3), textures);
  const audio = vi.fn();
  launchWarriorHammer(launchHost(audio), ribbons, CASTER, TARGET, 0);

  expect(audio).toHaveBeenCalledTimes(1); // release cue emitted at launch

  ribbons.update(0.2, CAM);

  // Slot deactivated on arrival: no head visible
  const heads: number[] = [];
  ribbons.drawHeads(0, (x) => heads.push(x));
  expect(heads).toHaveLength(0);

  // Arrival does not fire a second audio cue or any other predicted-damage callback
  expect(audio).toHaveBeenCalledTimes(1);

  ribbons.dispose();
  texture.dispose();
});

// drawWarriorHammerContact

it('outcome zero creates no contact flash or collision VFX', () => {
  const {
    host,
    flipbookAt,
    contact,
    pathRibbon,
    shakeAt,
    fragmentsAt,
    bakedAt,
    burstAt,
    abilityAudio,
  } = makeContactHost();
  drawWarriorHammerContact(host, CASTER, TARGET, 0, 0);
  expect(flipbookAt).not.toHaveBeenCalled();
  expect(contact).not.toHaveBeenCalled();
  for (const effect of [pathRibbon, shakeAt, fragmentsAt, bakedAt, burstAt, abilityAudio])
    expect(effect).not.toHaveBeenCalled();
});

it('absorbed outcome emits a contact flash but no flesh reaction or metal fragments', () => {
  const {
    host,
    flipbookAt,
    bakedAt,
    fragmentsAt,
    contact,
    pathRibbon,
    shakeAt,
    abilityAudio,
    burstAt,
  } = makeContactHost();
  drawWarriorHammerContact(host, CASTER, TARGET, 2, 0);
  expect(flipbookAt).toHaveBeenCalledOnce();
  expect(flipbookAt.mock.calls[0][5]).toBe('contact_crush'); // impact sheet
  expect(bakedAt).not.toHaveBeenCalled(); // no shout_dust flesh reaction
  expect(fragmentsAt).not.toHaveBeenCalled(); // no metal_splinter fragments
  expect(contact).not.toHaveBeenCalled(); // no hit registration
  for (const effect of [pathRibbon, shakeAt, abilityAudio]) expect(effect).not.toHaveBeenCalled();
  expect(burstAt.mock.calls.every((call) => call[6] === 'sparks')).toBe(true);
});

it.each([0, 1])(
  'actual hit owns one surface collision and live body creases at tier %s',
  (tier) => {
    const {
      host,
      contact,
      flipbookAt,
      bakedAt,
      fragmentsAt,
      pathRibbon,
      abilityAudio,
      shakeAt,
      burstAt,
      target,
    } = makeContactHost();
    drawWarriorHammerContact(host, CASTER, TARGET, 1, tier);
    expect(contact).toHaveBeenCalledExactlyOnceWith(
      CASTER,
      TARGET,
      'physical-crush',
      1.85,
      'storm_bolt',
      0,
    );
    expect(bakedAt).toHaveBeenCalledOnce();
    expect(bakedAt.mock.calls[0][0]).toBe('warrior_shear');
    expect(fragmentsAt).toHaveBeenCalledOnce();
    expect(flipbookAt).toHaveBeenCalledOnce();
    const surface = [target.x - target.height * 0.14, target.y + target.height * 0.68, target.z];
    const flash = flipbookAt.mock.calls[0];
    surface.forEach((coordinate, i) => {
      expect(flash[i]).toBeCloseTo(coordinate);
    });
    expect(flash[5]).toBe('contact_crush');
    expect(flash[3]).toBe(10.2);
    expect(flash[7]).toBe(0.085);
    expect(bakedAt.mock.calls[0].slice(1, 4)).toEqual(flash.slice(0, 3));
    expect(bakedAt.mock.calls[0][4]).toBe(16.4);
    expect(fragmentsAt.mock.calls[0].slice(1, 4)).toEqual(flash.slice(0, 3));
    expect(fragmentsAt.mock.calls[0][5]).toBe(tier === 0 ? 14 : 6);
    expect(abilityAudio).toHaveBeenCalledTimes(1);
    expect(abilityAudio.mock.calls[0].slice(3, 6)).toEqual(flash.slice(0, 3));
    expect(shakeAt).toHaveBeenCalledExactlyOnceWith(...flash.slice(0, 3), 0.32, true);
    expect(burstAt.mock.calls.every((call) => call[6] === 'sparks')).toBe(true);
    for (const burst of burstAt.mock.calls) expect(burst.slice(0, 3)).toEqual(flash.slice(0, 3));
    const creases = pathRibbon.mock.calls.filter((call) => call[9]);
    expect(pathRibbon.mock.calls.filter((call) => !call[9])).toHaveLength(2);
    expect(creases).toHaveLength(tier === 0 ? 6 : 2);
    expect(creases.every((call) => call[9] === true)).toBe(true);
    const sample = (call: Parameters<SequencerHost['pathRibbon']>) => {
      const points = Array.from({ length: 25 }, () => new THREE.Vector3());
      expect(call[3](points)).toBe(points.length);
      expect(points.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
      return points;
    };
    const before = creases.map(sample);
    const pivot = new THREE.Vector3(target.x, target.y, target.z);
    const translation = new THREE.Vector3(2, 1, 3);
    target.x += translation.x;
    target.y += translation.y;
    target.z += translation.z;
    target.yaw += 0.8;
    creases.forEach((call, i) => {
      const after = sample(call);
      before[i].forEach((point, j) => {
        const expected = point
          .clone()
          .sub(pivot)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.8)
          .add(pivot)
          .add(translation);
        expect(after[j].distanceTo(expected)).toBeLessThan(1e-8);
      });
    });
    target.present = false;
    for (const crease of creases)
      expect(crease[3]([new THREE.Vector3(), new THREE.Vector3()])).toBe(0);
    expect(contact).toHaveBeenCalledTimes(1);
    expect(abilityAudio).toHaveBeenCalledTimes(1);
    expect(shakeAt).toHaveBeenCalledTimes(1);
  },
);

it.each([CASTER, TARGET])('cancels only hammers involving dead participant %s', (entityId) => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 26), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);
  ribbons.cancelWarriorHammer(entityId);
  const sink = vi.fn();
  ribbons.drawHeads(0, sink);
  expect(sink).not.toHaveBeenCalled();
  ribbons.dispose();
  texture.dispose();
});
it('a missing source view cancels a flying hammer before reaching a live target', () => {
  const { textures, texture } = fakeTextures();
  let sourceExists = true;
  const anchor = fixedAnchor(0, 26);
  const ribbons = new AbilityVfxRibbons(
    new THREE.Scene(),
    (id, frac, out) => (id === CASTER && !sourceExists ? null : anchor(id, frac, out)),
    textures,
  );
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);
  sourceExists = false;
  ribbons.update(0.1, CAM);
  const sink = vi.fn();
  ribbons.drawHeads(0, sink);
  expect(sink).not.toHaveBeenCalled();
  ribbons.dispose();
  texture.dispose();
});

it('holds the spirit hammer at the animated hand before releasing it on the original arrival schedule', () => {
  const { textures, texture } = fakeTextures();
  const hand = new THREE.Vector3(0.5, 2, 0);
  const ribbons = new AbilityVfxRibbons(
    new THREE.Scene(),
    fixedAnchor(0, 26),
    textures,
    (_id, out) => {
      out.copy(hand);
      return true;
    },
  );
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);
  const solid = vi.fn((..._args: [number, number, number, number, number, number]) => true),
    sprite = vi.fn();
  ribbons.update(0.08, CAM);
  ribbons.drawHeads(0.08, sprite, false, solid);
  expect(solid).toHaveBeenCalledTimes(1);
  expect(solid.mock.calls[0][0]).toBeCloseTo(hand.x);
  expect(solid.mock.calls[0][5]).toBe(0);
  hand.x = 1;
  solid.mockClear();
  ribbons.update(0.05, CAM);
  ribbons.drawHeads(0.13, sprite, false, solid);
  expect(solid.mock.calls[0][0]).toBeCloseTo(1);
  solid.mockClear();
  ribbons.update(0.12, CAM);
  ribbons.drawHeads(0.25, sprite, false, solid);
  expect(solid.mock.calls[0][0]).toBeGreaterThan(1);
  expect(solid.mock.calls[0][5]).toBeCloseTo(0.11);
  ribbons.update(0.76, CAM);
  solid.mockClear();
  ribbons.drawHeads(1.01, sprite, false, solid);
  expect(solid).not.toHaveBeenCalled();
  ribbons.dispose();
  texture.dispose();
});

it('keeps homing after the original flight duration when a target retreats', () => {
  const { textures, texture } = fakeTextures();
  let target = 26;
  const anchor = (id: number, _fraction: number, out?: THREE.Vector3) =>
    (out ?? new THREE.Vector3()).set(id === CASTER ? 0 : target, 1, 0);
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), anchor, textures, (_id, out) => {
    out.set(0, 1 - 2.1 * (70 / 64) * 0.38, 0);
    return true;
  });
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);
  for (let frame = 0; frame < 60; frame++) {
    target += 0.1;
    ribbons.update(1 / 60, CAM);
  }
  const seen: number[] = [];
  ribbons.drawHeads(1, (x) => seen.push(x));
  expect(seen).toHaveLength(1);
  expect(seen[0]).toBeCloseTo(26, 5);
  expect(target - seen[0]).toBeGreaterThan(5);
  const second: number[] = [];
  target += 0.6;
  ribbons.update(0.1, CAM);
  ribbons.drawHeads(1.1, (x) => second.push(x));
  expect(second[0] - seen[0]).toBeCloseTo(2.6, 5);
  ribbons.dispose();
  texture.dispose();
});
