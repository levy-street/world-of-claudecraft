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
  const host = {
    anchorOf(id: number, _frac: number, out?: { x: number; y: number; z: number }) {
      const o = out ?? { x: 0, y: 0, z: 0 };
      if (id === CASTER) {
        o.x = casterX;
        o.y = 1;
        o.z = 0;
        return o;
      }
      if (id === TARGET) {
        o.x = targetX;
        o.y = 1;
        o.z = 0;
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
  } as unknown as SequencerHost;
  return { host, flipbookAt, bakedAt, fragmentsAt, contact, burstAt, pulseLight, countPrimitive };
}

// ── warriorHammerCel ─────────────────────────────────────────────────────────

it('warriorHammerCel cycles through 8 cels at 24 fps and freezes at cel 0 under reduced motion', () => {
  for (let cel = 0; cel < 8; cel++) {
    expect(warriorHammerCel(cel / 24, false)).toBe(cel);
  }
  expect(warriorHammerCel(8 / 24, false)).toBe(0); // full cycle wraps back to 0
  expect(warriorHammerCel(0.5, true)).toBe(0);
  expect(warriorHammerCel(5, true)).toBe(0);
});

// ── launchWarriorHammer + trail flight ───────────────────────────────────────

it('hammer trail head advances at 26 yards per second', () => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 26), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);

  // 26 yd/s × 0.5 s = 13 yd
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
  // time = 3/24 s → warriorHammerCel(3/24, false) = 3 → emits hammer0 + 3
  ribbons.drawHeads(3 / 24, (_x, _y, _z, _c, _s, cell) => cells.push(cell));

  expect(cells).toHaveLength(1);
  expect(cells[0]).toBeGreaterThanOrEqual(OVERLAY_CELL.hammer0);
  expect(cells[0]).toBeLessThan(OVERLAY_CELL.hammer0 + 8);
  expect(cells[0]).not.toBe(OVERLAY_CELL.glow);

  ribbons.dispose();
  texture.dispose();
});

it('reduced motion freezes tumble at cel 0 while flight still advances', () => {
  const { textures, texture } = fakeTextures();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), fixedAnchor(0, 26), textures);
  launchWarriorHammer(launchHost(), ribbons, CASTER, TARGET, 0);

  ribbons.update(0.3, CAM, true /* reducedMotion */);

  // With reducedMotion=true, warriorHammerCel(3/24, true) = 0 → cel = hammer0 exactly
  const seen: { x: number; cell: number }[] = [];
  ribbons.drawHeads(3 / 24, (x, _y, _z, _c, _s, cell) => seen.push({ x, cell }), true);

  expect(seen).toHaveLength(1);
  expect(seen[0].x).toBeGreaterThan(0); // flight advanced: 26 yd/s × 0.3 s ≈ 7.8 yd
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
  // Target 0.3 yd away: first update step (26 × 0.2 = 5.2 yd) exceeds distance → arrives
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

// ── drawWarriorHammerContact ─────────────────────────────────────────────────

it('outcome zero creates no contact flash or collision VFX', () => {
  const { host, flipbookAt, contact } = makeContactHost();
  drawWarriorHammerContact(host, CASTER, TARGET, 0, 0);
  expect(flipbookAt).not.toHaveBeenCalled();
  expect(contact).not.toHaveBeenCalled();
});

it('absorbed outcome emits a contact flash but no flesh reaction or metal fragments', () => {
  const { host, flipbookAt, bakedAt, fragmentsAt, contact } = makeContactHost();
  drawWarriorHammerContact(host, CASTER, TARGET, 2, 0);
  expect(flipbookAt).toHaveBeenCalledOnce();
  expect(flipbookAt.mock.calls[0][5]).toBe('contact_crush'); // impact sheet
  expect(bakedAt).not.toHaveBeenCalled(); // no shout_dust flesh reaction
  expect(fragmentsAt).not.toHaveBeenCalled(); // no metal_splinter fragments
  expect(contact).not.toHaveBeenCalled(); // no hit registration
});

it('actual hit registers recipient contact once and does not fire a caster attack', () => {
  const { host, contact, flipbookAt, bakedAt, fragmentsAt } = makeContactHost();
  drawWarriorHammerContact(host, CASTER, TARGET, 1, 0);

  // Recipient contact registered exactly once
  expect(contact).toHaveBeenCalledTimes(1);
  const [sourceId, targetId] = contact.mock.calls[0] as [number, number];
  expect(sourceId).toBe(CASTER);
  expect(targetId).toBe(TARGET);

  // Physical hit adds dust reaction and metal splinters
  expect(bakedAt).toHaveBeenCalledOnce();
  expect(fragmentsAt).toHaveBeenCalledOnce();

  // Impact flash present
  expect(flipbookAt).toHaveBeenCalledOnce();
});

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
