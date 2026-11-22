import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import {
  CAST_SIGIL_DURATION,
  CAST_SIGIL_LIT,
  castSigilAlpha,
  castSigilScale,
  PaladinCastSigil,
  SHIELD_QUAD,
} from '../src/render/ability_vfx/paladin_cast_sigil';
import {
  PALADIN_SPEC_ICONS_URL,
  setPaladinSpecIconsForTest,
} from '../src/render/ability_vfx/paladin_spec_icons';
import { WardOfFaith } from '../src/render/ability_vfx/ward_of_faith';
import {
  clearBastionRiteShields,
  shieldBlockLeft,
  shieldSigilSpec,
} from '../src/render/paladin_shield_buffs';

it('tracks the actual offhand, deduplicates overlapping casts and expires without a lingering emblem', () => {
  const hand = new THREE.Vector3(2, 3, 4);
  const sample = vi.fn((_id, which, out) => {
    expect(which).toBe(1);
    out.copy(hand);
    return true;
  });
  const effect = new PaladinCastSigil(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    (_id, fraction, out = new THREE.Vector3()) => out.set(0, fraction * 2, 0),
    sample,
  );
  expect(effect.cast(1)).toBe(false);
  vi.spyOn(effect.preparation, 'ready').mockReturnValue(true);
  effect.cast(1);
  effect.cast(1);
  effect.update(0.35);
  expect(effect.mesh.geometry.drawRange.count).toBe(6);
  const positions = effect.mesh.geometry.getAttribute('position');
  const before = positions.getX(0);
  hand.x += 3;
  effect.update(0.1);
  expect(positions.getX(0) - before).toBeCloseTo(3);
  effect.update(0.6);
  expect(effect.mesh.visible).toBe(false);
  expect(effect.mesh.geometry.drawRange.count).toBe(0);
  effect.dispose();
  expect(effect.cast(1)).toBe(false);
});

it('pops in with an overshoot, swells on release and is gone by the end of the salute', () => {
  expect(castSigilScale(0)).toBeCloseTo(0.75);
  expect(Math.max(castSigilScale(0.15), castSigilScale(0.2))).toBeGreaterThan(1);
  expect(castSigilScale(0.5)).toBeCloseTo(1);
  expect(castSigilScale(CAST_SIGIL_DURATION)).toBeCloseTo(1.35);
  expect(castSigilAlpha(0)).toBe(0);
  expect(castSigilAlpha(0.3)).toBe(1);
  expect(castSigilAlpha(CAST_SIGIL_DURATION - 0.1)).toBeLessThan(0.5);
  expect(castSigilAlpha(CAST_SIGIL_DURATION)).toBe(0);
});

it('stays lit on the off-hand through a held cast, and swells away when it lands or stops', () => {
  const effect = new PaladinCastSigil(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    (_id, fraction, out = new THREE.Vector3()) => out.set(0, fraction * 2, 0),
    (_id, _which, out) => {
      out.set(0.2, 2, 0);
      return true;
    },
  );
  expect(effect.hold(1)).toBe(false);
  vi.spyOn(effect.preparation, 'ready').mockReturnValue(true);
  const age = () => effect.mesh.geometry.getAttribute('aAge').getX(0);
  // Held for far longer than a salute: it stays fully lit.
  for (let i = 0; i < 60; i++) {
    effect.hold(1);
    effect.update(0.05);
  }
  expect(effect.mesh.visible).toBe(true);
  expect(age()).toBeCloseTo(CAST_SIGIL_LIT);
  // The cast lands: no restart, it swells and fades.
  effect.hold(1);
  effect.cast(1);
  effect.update(0.05);
  expect(age()).toBeGreaterThan(0.7);
  effect.update(0.3);
  expect(effect.mesh.visible).toBe(false);
  // An interrupted hold lets go the same way.
  effect.hold(2);
  effect.update(0.05);
  effect.update(0.05);
  expect(age()).toBeGreaterThan(0.7);
  effect.dispose();
});

it("lies on the held shield's face, on the side the camera sees, and lights the shield", () => {
  clearBastionRiteShields();
  // A shield face at (1, 1.2, 0.5), turned to face +x (right -z, up +y),
  // 0.1 deep behind its face.
  const shield = Object.assign(() => true, {
    frame: (out: THREE.Matrix4) => {
      out.makeBasis(
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(1, 0, 0),
      );
      out.setPosition(1, 1.2, 0.5);
      return true;
    },
    faceHalf: () => 0.25,
    faceDepth: () => 0.1,
  });
  let holding = true;
  const camera = new THREE.PerspectiveCamera();
  const effect = new PaladinCastSigil(
    new THREE.Scene(),
    camera,
    (_id, fraction, out = new THREE.Vector3()) => out.set(0, fraction * 2, 0),
    (_id, _which, out) => {
      out.set(0.2, 2, 0);
      return true;
    },
    () => (holding ? shield : null),
  );
  vi.spyOn(effect.preparation, 'ready').mockReturnValue(true);
  const corners = () => {
    const position = effect.mesh.geometry.getAttribute('position');
    return Array.from({ length: 6 }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(position, i),
    );
  };
  const centreOf = (points: THREE.Vector3[]) =>
    points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(6);
  const look = (x: number) => {
    camera.position.set(x, 1.2, 0.5);
    camera.lookAt(1, 1.2, 0.5);
    camera.updateMatrixWorld(true);
  };

  // Seen from in front: on the face, the icon over the glow's sign.
  look(5);
  effect.cast(1, 'holy');
  effect.update(0.3);
  const front = corners();
  const centre = centreOf(front);
  expect(centre.x).toBeCloseTo(1);
  expect(centre.y).toBeCloseTo(1.2 + 0.25 * 0.06);
  expect(centre.z).toBeCloseTo(0.5);
  for (const p of front) expect(p.x).toBeCloseTo(1);
  const half = Math.max(...front.map((p) => Math.abs(p.z - 0.5)));
  expect(half).toBeCloseTo(0.25 * SHIELD_QUAD * castSigilScale(0.3));
  // Its first corner lies to the viewer's left (the face's right is -z).
  expect(front[0].z).toBeGreaterThan(0.5);
  // The shield lights as Bastion Rite lights it, bearing the caster's icon.
  expect(shieldBlockLeft(1)).toBeCloseTo(1 - 0.3 / CAST_SIGIL_DURATION);
  expect(shieldSigilSpec(1)).toBe(0);

  // Seen from behind: on the shield's back, still read the right way round.
  look(-5);
  effect.update(0.05);
  const back = corners();
  for (const p of back) expect(p.x).toBeCloseTo(1 - 0.1 - 0.09);
  expect(back[0].z).toBeLessThan(0.5);

  // It fades: the shield goes dark with it.
  effect.update(1);
  expect(effect.mesh.visible).toBe(false);
  expect(shieldBlockLeft(1)).toBeNull();
  expect(shieldSigilSpec(1)).toBeNull();

  // No shield: back above the off-hand, and no shield light.
  holding = false;
  effect.cast(1);
  effect.update(0.3);
  const raised = centreOf(corners());
  expect(raised.x).toBeCloseTo(0.2);
  expect(raised.y).toBeGreaterThan(2);
  expect(shieldBlockLeft(1)).toBeNull();
  effect.dispose();
});

it("bears the caster's spec icon, Faithwarden when the spec is unknown", () => {
  const effect = new PaladinCastSigil(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    (_id, fraction, out = new THREE.Vector3()) => out.set(0, fraction * 2, 0),
    (_id, _which, out) => {
      out.set(0.2, 2, 0);
      return true;
    },
  );
  vi.spyOn(effect.preparation, 'ready').mockReturnValue(true);
  const spec = () => effect.mesh.geometry.getAttribute('aSpec').getX(0);
  effect.cast(1, 'holy');
  effect.update(0.1);
  expect(spec()).toBe(0);
  effect.clear();
  effect.cast(1, 'retribution');
  effect.update(0.1);
  expect(spec()).toBe(2);
  effect.clear();
  effect.cast(1);
  effect.update(0.1);
  expect(spec()).toBe(1);
  effect.clear();
  effect.hold(1, 'holy');
  effect.update(0.1);
  expect(spec()).toBe(0);
  effect.dispose();
});

it('draws the approved spec icon atlas in the sigil and the ward plates once it has loaded', () => {
  // A lossless WebP (VP8L): the distance field must survive exactly.
  const webp = readFileSync(new URL(`../public${PALADIN_SPEC_ICONS_URL}`, import.meta.url));
  expect(webp.toString('ascii', 0, 4)).toBe('RIFF');
  expect(webp.toString('ascii', 12, 16)).toBe('VP8L');
  // VP8L packs (width - 1) and (height - 1) as 14-bit fields after its signature byte.
  const bits = webp.readUInt32LE(21);
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  // Three icon cells side by side.
  expect(width).toBe(height * 3);
  const scene = new THREE.Scene();
  const anchor = (_id: number, fraction: number, out = new THREE.Vector3()) =>
    out.set(0, fraction * 2, 0);
  const sigil = new PaladinCastSigil(scene, new THREE.PerspectiveCamera(), anchor);
  const ward = new WardOfFaith(scene, anchor);
  try {
    sigil.update(0.1);
    ward.update(0.1);
    expect(sigil.mesh.material.uniforms.uSpecIconsReady.value).toBe(0);
    expect(ward.mesh.material.uniforms.uSpecIconsReady.value).toBe(0);
    const atlas = new THREE.Texture();
    setPaladinSpecIconsForTest(atlas);
    sigil.update(0.1);
    ward.update(0.1);
    expect(sigil.mesh.material.uniforms.uSpecIcons.value).toBe(atlas);
    expect(ward.mesh.material.uniforms.uSpecIconsReady.value).toBe(1);
  } finally {
    setPaladinSpecIconsForTest(null);
    sigil.dispose();
    ward.dispose();
  }
});

it("knows the local player's spec before their first cast, so the first sigil is right", () => {
  const fx = { update: vi.fn(), learnPaladinSpec: vi.fn() };
  const painter = Object.assign(Object.create(AbilityVfx.prototype), {
    deps: {
      fx,
      localPlayerId: () => 7,
      warriorSpecOf: (id: number) => (id === 7 ? 'retribution' : null),
    },
    edictContacts: new Map(),
    // The release stages Red Harvest's detonation on the frame clock.
    harvestDetonations: { advance: vi.fn() },
    heldSemantic: new Map(),
    semanticFrame: 0,
    beamChannels: new Map(),
  }) as AbilityVfx;
  // Every frame, no cast needed (and a respec is picked up the same way).
  painter.update(1 / 60);
  expect(fx.learnPaladinSpec).toHaveBeenCalledExactlyOnceWith(7, 'retribution');
});
