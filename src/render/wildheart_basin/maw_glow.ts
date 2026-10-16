// The spirit light in the stone jaguar's maw (maw_glow_core.ts plans it): when
// Zulgar falls and the way out opens in the jaws, jade light wells up out of
// the throat, a gold bloom stands round the portal on the jaw, and the glow
// pools over the jaw and the lip of the terrace. Cosmetic only.
//
// Emissive cards, never a light: the halos share the braziers' sprite program
// and the pools their additive floor program (basin_lights.ts), built with the
// interior so they compile behind its gate; they stand there from the start at
// zero opacity and only their opacity moves (a uniform write, never a program
// change). WildheartFx drives the level (setBasinMawGlow).

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import { MAW_GLOW_COLORS, type MawGlowCard, planMawGlow } from './maw_glow_core';

interface GlowSlot {
  card: MawGlowCard;
  material: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
}

/** One material per card (each fades with its own full opacity), shared
 *  across interior rebuilds like the brazier halos. */
let slots: GlowSlot[] | null = null;
let poolGeometry: THREE.BufferGeometry | null = null;

function glowSlots(): GlowSlot[] {
  if (slots) return slots;
  slots = planMawGlow().map((card) => {
    const common = {
      map: radialGlowTexture(),
      color: MAW_GLOW_COLORS[card.tone],
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: `wildheartMawGlow:${card.kind}:${card.tone}`,
    };
    const material =
      card.kind === 'halo'
        ? new THREE.SpriteMaterial({ ...common, fog: false })
        : new THREE.MeshBasicMaterial(common);
    markSharedMaterial(material);
    return { card, material };
  });
  return slots;
}

/** Plant the maw's glow cards into the basin's interior group (basin frame). */
export function buildMawGlow(group: THREE.Group): void {
  poolGeometry ??= new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  markSharedGeometry(poolGeometry);
  const root = new THREE.Group();
  root.name = 'wildheartMawGlow';
  for (const { card, material } of glowSlots()) {
    if (card.kind === 'halo') {
      const halo = new THREE.Sprite(material as THREE.SpriteMaterial);
      halo.position.set(card.x, card.y, card.z);
      halo.scale.set(card.w, card.h, 1);
      root.add(halo);
      continue;
    }
    const pool = new THREE.Mesh(poolGeometry, material);
    pool.position.set(card.x, card.y, card.z);
    pool.scale.set(card.w, 1, card.h);
    // The world's own light on the floor's lowest rung: every telegraph paints over it.
    pool.renderOrder = floorVfxRenderOrder('ground', 1);
    root.add(pool);
  }
  group.add(root);
}

/** Drive the glow (0 dark, 1 full): an opacity write per card only. */
export function setBasinMawGlow(strength: number): void {
  const k = Math.max(0, Math.min(1, strength));
  for (const { card, material } of glowSlots()) material.opacity = card.opacity * k;
}
