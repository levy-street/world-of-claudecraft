// Paints a held katana with its Katana Table look (src/sim/katana_look.ts):
// blade, guard and wrap colors on the procedural katana GLB's named materials
// (scripts/assets/katana/build_katana.mjs: <key>_blade/_edge/_wrap/_diamond/
// _guard/_metal), plus a scabbard (saya) sleeve over the blade while the
// katana is sheathed on the back. Cosmetic only.
//
// Program safety: a recolor is a `color` UNIFORM change on a hook-preserving
// clone (material_clone_hooks.ts), never a program-key change, so the clone
// draws with the source's already-linked program. Clones are cached per
// (source material, color) and never disposed: the palette is a small closed
// set (content/katana_forge.ts), so the cache stays bounded.
import * as THREE from 'three';
import { KATANA_PALETTES } from '../../sim/content/katana_forge';
import { cloneMaterialWithHooks } from '../material_clone_hooks';

export interface KatanaLookColors {
  blade?: string;
  guard?: string;
  wrap?: string;
  saya?: string;
}

/** Stable signature for diffing a look across frames (null when there is none). */
export function katanaLookSignature(look: KatanaLookColors | null | undefined): string | null {
  if (!look) return null;
  const sig = `${look.blade ?? ''}|${look.guard ?? ''}|${look.wrap ?? ''}|${look.saya ?? ''}`;
  return sig === '|||' ? null : sig;
}

type PartSlot = 'blade' | 'guard' | 'wrap';

/** Which look slot recolors a katana material, by its name suffix. */
export function katanaPartForMaterial(name: string): PartSlot | null {
  const m = /^katana_sword_[a-z]_(blade|guard|metal|wrap)$/.exec(name);
  if (!m) return null;
  if (m[1] === 'metal') return 'guard';
  return m[1] as PartSlot;
}

function colorOf(slot: keyof typeof KATANA_PALETTES, id: string | undefined): number | null {
  if (!id) return null;
  const table = KATANA_PALETTES[slot] as Record<string, number>;
  return Object.hasOwn(table, id) ? table[id] : null;
}

const recolorCache = new Map<string, THREE.Material>();

function recolored(source: THREE.Material, hex: number): THREE.Material {
  const key = `${source.uuid}:${hex}`;
  let m = recolorCache.get(key);
  if (!m) {
    m = cloneMaterialWithHooks(source);
    const c = (m as THREE.MeshStandardMaterial).color;
    if (c) c.setHex(hex);
    recolorCache.set(key, m);
  }
  return m;
}

const SAYA_NAME = 'katana_saya';
let sayaGeometry: THREE.BufferGeometry | null = null;

/** A slim lacquered sleeve over the blade length (katana local frame: blade on +Y). */
function sayaGeo(): THREE.BufferGeometry {
  if (!sayaGeometry) {
    sayaGeometry = new THREE.CylinderGeometry(0.026, 0.03, 1.36, 8);
    sayaGeometry.scale(1, 1, 1.7);
    sayaGeometry.translate(0, 0.72, -0.01);
  }
  return sayaGeometry;
}

/**
 * Apply `look` to every katana mesh under `payloads`. `sheathed` adds the
 * scabbard sleeve (only while the blade rides the back). No-op for non-katana
 * payloads, so it is safe to call on any held weapon.
 */
export function paintKatanaLook(
  payloads: readonly THREE.Object3D[],
  look: KatanaLookColors | null,
  sheathed: boolean,
): void {
  for (const payload of payloads) {
    let bladeMat: THREE.Material | null = null;
    let host: THREE.Object3D | null = null;
    payload.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const slot = katanaPartForMaterial(mesh.material.name);
      if (!slot) return;
      if (slot === 'blade') {
        bladeMat = mesh.material;
        host = mesh.parent;
      }
      const hex = look ? colorOf(slot, look[slot]) : null;
      if (hex !== null) mesh.material = recolored(mesh.material, hex);
    });
    const old = payload.getObjectByName(SAYA_NAME);
    if (old) old.parent?.remove(old);
    const sayaHex = colorOf('saya', look?.saya) ?? KATANA_PALETTES.saya.black;
    if (sheathed && bladeMat && host) {
      const saya = new THREE.Mesh(sayaGeo(), recolored(bladeMat, sayaHex));
      saya.name = SAYA_NAME;
      (host as THREE.Object3D).add(saya);
    }
  }
}
