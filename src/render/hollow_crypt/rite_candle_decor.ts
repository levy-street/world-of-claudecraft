// The four Remembrance Candles' decor, as each crypt interior built it: the
// kit's baked flame (one instance each of the `Kit_RemembranceCandle:glow`
// batch, crypt_kit.ts) and the crypt lights' flame cone, halo and budgeted
// point light (crypt_lights.ts). Morthen's Rite gutters them out and the group
// lights them again (morthen_candle_fx.ts).
//
// No module registry: the builders TAG what they built (userData, so the tags
// live and die with the objects), and a RiteCandleDecor finds the decor of the
// claimed slot it is asked about by walking the scene for that slot's interior
// root (`hollowCryptField`, placed at the slot's origin by dungeon.ts). So a
// Rite in one slot never touches another slot's candles, a retired interior is
// never retained or written to (its root left the scene; the next look-up
// re-walks), and a kit rebuilt in place (the stand-ins swapped for the baked
// kit) is found again.
//
// Nothing here links a program: no material, texture or define changes, only
// visibility, an instance matrix and a light's budget base (a point light stays
// a carrier source, its count untouched).

import * as THREE from 'three';
import { candleIndexAt } from './morthen_rite_fx_core';

/** The interior root's name (crypt_interior.ts). */
export const RITE_INTERIOR_NAME = 'hollowCryptField';

/** The fire flicker's level for a lamp with no budget base of its own
 *  (point_light_budget.ts flickerContributingFireLights). */
const FLICKER_FALLBACK_BASE = 11;

interface LampTag {
  index: number;
  /** The light's own budget base when it was built (null: it carried none). */
  base: number | null;
}

interface GlowTag {
  /** Instance index per candle (-1: none), and each instance's authored matrix. */
  instanceOf: number[];
  matrices: THREE.Matrix4[];
}

/** crypt_lights.ts: tag the lamp a Remembrance Candle's holder burns at the
 *  instance-local spot (x, z). */
export function tagRiteCandleLamp(
  x: number,
  z: number,
  flame: THREE.Object3D | null,
  halo: THREE.Object3D | null,
  light: THREE.PointLight | null,
): void {
  const index = candleIndexAt(x, z);
  if (index < 0) return;
  if (flame) flame.userData.riteCandleFlame = index;
  if (halo) halo.userData.riteCandleFlame = index;
  if (light) {
    const base = light.userData.baseIntensity;
    const tag: LampTag = { index, base: typeof base === 'number' ? base : null };
    light.userData.riteCandleLight = tag;
  }
}

/** crypt_kit.ts: tag the baked-flame batch of the Remembrance Candles with the
 *  instance-local spot of each instance. */
export function tagRiteCandleGlow(
  mesh: THREE.InstancedMesh,
  spots: readonly { x: number; z: number }[],
): void {
  const instanceOf = [-1, -1, -1, -1];
  const matrices: THREE.Matrix4[] = [];
  spots.forEach((s, k) => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(k, m);
    matrices.push(m);
    const i = candleIndexAt(s.x, s.z);
    if (i >= 0) instanceOf[i] = k;
  });
  const tag: GlowTag = { instanceOf, matrices };
  mesh.userData.riteCandleGlow = tag;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** One interior's candle decor, found by its tags. */
interface SlotDecor {
  root: THREE.Object3D;
  ox: number;
  oz: number;
  flames: THREE.Object3D[][];
  lights: (THREE.PointLight | null)[];
  glow: THREE.InstancedMesh | null;
  /** The root's children when collected (the kit swapping its stand-ins for
   *  the baked kit replaces one: the decor is collected again). */
  children: THREE.Object3D[];
  /** The flame shown per candle as last written (null: never written). */
  shown: (boolean | null)[];
}

/** The candle decor of the crypt interiors under one scene, per claimed slot. */
export class RiteCandleDecor {
  private readonly slots: SlotDecor[] = [];

  constructor(private readonly scene: THREE.Object3D) {}

  /** Show or hide candle `i`'s decor flame in the slot anchored at (ox, oz)
   *  (the kit's baked one and the lamp's cone and halo) and set its light to
   *  `level` of its authored base. False when that slot has no interior. */
  set(ox: number, oz: number, i: number, flame: boolean, level: number): boolean {
    const d = this.slotAt(ox, oz);
    if (!d) return false;
    // The flames (and the batch's instance matrix) change only with the flame.
    if (d.shown[i] !== flame) {
      d.shown[i] = flame;
      for (const f of d.flames[i]) f.visible = flame;
      const glow = d.glow;
      const tag = glow?.userData.riteCandleGlow as GlowTag | undefined;
      const k = tag ? tag.instanceOf[i] : -1;
      if (glow && tag && k >= 0) {
        glow.setMatrixAt(k, flame ? tag.matrices[k] : ZERO);
        glow.instanceMatrix.needsUpdate = true;
      }
    }
    const light = d.lights[i];
    const tag = light?.userData.riteCandleLight as LampTag | undefined;
    if (light && tag) {
      // The fire flicker rewrites the light's intensity from its budget base
      // every frame, so the level rides the base; a lamp built without one
      // (the low tier's) gets the flicker's own fallback scaled, and loses it
      // again once restored.
      if (level === 1 && tag.base === null) delete light.userData.baseIntensity;
      else light.userData.baseIntensity = (tag.base ?? FLICKER_FALLBACK_BASE) * level;
    }
    return true;
  }

  /** Put every candle of every live slot back as its interior built it, and
   *  let go of every interior. */
  restoreAll(): void {
    for (const d of this.slots) {
      if (!this.live(d)) continue;
      for (let i = 0; i < 4; i++) this.set(d.ox, d.oz, i, true, 1);
    }
    this.slots.length = 0;
  }

  /** Is this slot's decor still the one in the scene (root attached, kit not
   *  rebuilt under it)? */
  private live(d: SlotDecor): boolean {
    if (d.root.parent !== this.scene) return false;
    const now = d.root.children;
    if (now.length !== d.children.length) return false;
    for (let k = 0; k < now.length; k++) if (now[k] !== d.children[k]) return false;
    return true;
  }

  private slotAt(ox: number, oz: number): SlotDecor | null {
    for (let k = this.slots.length - 1; k >= 0; k--) {
      const d = this.slots[k];
      if (Math.abs(d.ox - ox) > 1 || Math.abs(d.oz - oz) > 1) continue;
      if (this.live(d)) return d;
      this.slots.splice(k, 1);
    }
    for (const root of this.scene.children) {
      if (root.name !== RITE_INTERIOR_NAME) continue;
      if (Math.abs(root.position.x - ox) > 1 || Math.abs(root.position.z - oz) > 1) continue;
      const d = this.collect(root, ox, oz);
      this.slots.push(d);
      return d;
    }
    return null;
  }

  private collect(root: THREE.Object3D, ox: number, oz: number): SlotDecor {
    const d: SlotDecor = {
      root,
      ox,
      oz,
      flames: [[], [], [], []],
      lights: [null, null, null, null],
      glow: null,
      children: root.children.slice(),
      shown: [null, null, null, null],
    };
    root.traverse((o) => {
      const u = o.userData;
      if (typeof u.riteCandleFlame === 'number') d.flames[u.riteCandleFlame]?.push(o);
      else if (u.riteCandleLight)
        d.lights[(u.riteCandleLight as LampTag).index] = o as THREE.PointLight;
      else if (u.riteCandleGlow) d.glow = o as THREE.InstancedMesh;
    });
    return d;
  }
}
