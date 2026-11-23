// Lantern Hall's name on its gateway (the gateway itself is part of the guild's model,
// scripts/assets/highwatch_guild/guild_yard.py): the guild's localized name and the line
// under it, painted once on a canvas and shown on both faces of the name board, so it reads
// the right way round from the road and from the yard. The harbor route markers' recipe
// (harbor_route_markers.ts): the back face is the same plane turned half a turn, never a
// mirrored one, and a language switch (woc:languagechange) or the web font arriving repaints
// the canvas in place: a texture upload, never a material or program change.
//
// GPU work and the camera fade: the two planes are added to the guild's own model, in its
// frame, before the town kit converts its materials (highwatch_town.ts highwatchBuildingExtras,
// the kit's `decorate` hook), so they take the building's material conversion, its fade twins,
// its fog cull and its reveal compile with the rest of the guild. Nothing here runs per frame.
import * as THREE from 'three';
import { guildSignLabels } from './entity_labels';

/** The gateway's name board in the guild's model frame (yards over its ground line), the
 *  model's own `highwatchGuild.sign` extras, pinned equal by tests/highwatch_guild_asset. */
export const HIGHWATCH_GUILD_SIGN = {
  x: -8,
  y: 4.05,
  z: -24.3,
  width: 5.6,
  height: 1.18,
  /** Each painted face's offset from the board's centre plane. */
  face: 0.14,
} as const;

const CANVAS_W = 1024;
const CANVAS_H = 216;
const FONT_STACK = '"Cinzel", "Palatino Linotype", Palatino, Georgia, serif';
const FIELD_TOP = '#1f3266';
const FIELD_BOTTOM = '#14214a';
const GILT = '#f0c262';
const GILT_SHADOW = 'rgba(20, 10, 2, 0.75)';

interface PaintedSign {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

let painted: PaintedSign | null = null;
let geometry: THREE.BufferGeometry | null = null;
let repaintHooked = false;

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  start: number,
  max: number,
): void {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ${FONT_STACK}`;
    if (ctx.measureText(text).width <= max) return;
    size -= 4;
  } while (size > 20);
}

function paint(p: PaintedSign): void {
  const ctx = p.canvas.getContext('2d');
  if (!ctx) return;
  const w = p.canvas.width;
  const h = p.canvas.height;
  const field = ctx.createLinearGradient(0, 0, 0, h);
  field.addColorStop(0, FIELD_TOP);
  field.addColorStop(1, FIELD_BOTTOM);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  // a fine gilded keyline inside the edge, the sign-writer's frame
  ctx.strokeStyle = 'rgba(240, 194, 98, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  const { name, subtitle } = guildSignLabels();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = w * 0.9;
  // the guild's name, gilded, a carved shadow under it; the line under it smaller
  fitFont(ctx, name, 700, Math.round(h * 0.46), maxW);
  ctx.fillStyle = GILT_SHADOW;
  ctx.fillText(name, w / 2 + 3, h * 0.42 + 4, maxW);
  ctx.fillStyle = GILT;
  ctx.fillText(name, w / 2, h * 0.42, maxW);
  if (subtitle) {
    fitFont(ctx, subtitle, 600, Math.round(h * 0.25), maxW * 0.8);
    ctx.fillStyle = GILT_SHADOW;
    ctx.fillText(subtitle, w / 2 + 2, h * 0.78 + 2, maxW * 0.8);
    ctx.fillStyle = GILT;
    ctx.fillText(subtitle, w / 2, h * 0.78, maxW * 0.8);
  }
  p.texture.needsUpdate = true;
}

function repaint(): void {
  if (painted) paint(painted);
}

function hookRepaint(): void {
  if (repaintHooked || typeof document === 'undefined') return;
  repaintHooked = true;
  document.addEventListener('woc:languagechange', repaint);
  document.fonts?.ready.then(repaint).catch(() => undefined);
  document.fonts?.addEventListener?.('loadingdone', repaint);
}

function paintedSign(): PaintedSign {
  if (!painted) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    painted = { canvas, texture };
    paint(painted);
  }
  hookRepaint();
  return painted;
}

function signGeometry(): THREE.BufferGeometry {
  geometry ??= new THREE.PlaneGeometry(HIGHWATCH_GUILD_SIGN.width, HIGHWATCH_GUILD_SIGN.height);
  return geometry;
}

let material: THREE.MeshStandardMaterial | null = null;

/** The sign's source material (the kit converts it per building at the live tier, as it does
 *  the model's own). */
function signMaterial(): THREE.MeshStandardMaterial {
  material ??= new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: paintedSign().texture,
    roughness: 0.85,
    metalness: 0,
  });
  return material;
}

/** The two painted faces of the gateway's board, in the guild's model frame (yards over its
 *  ground line), for the town kit to add to the model. Empty without a document (a Node host
 *  builds the town without the lettering). */
export function buildHighwatchGuildSign(): THREE.Group {
  const s = HIGHWATCH_GUILD_SIGN;
  const group = new THREE.Group();
  group.name = 'highwatchGuildSign';
  if (typeof document === 'undefined') return group;
  group.position.set(s.x, s.y, s.z);
  const mat = signMaterial();
  // the road face looks down model -z (out of the yard), the yard face up +z
  for (const [z, yaw] of [
    [-s.face, Math.PI],
    [s.face, 0],
  ] as const) {
    const face = new THREE.Mesh(signGeometry(), mat);
    face.name = 'GuildSignText';
    face.position.z = z;
    face.rotation.y = yaw;
    group.add(face);
  }
  return group;
}

export const highwatchGuildSignInternalsForTest = {
  /** Repaint the canvas (what a language switch or the web font does). */
  repaint,
  /** Forget the painted canvas (it belongs to one test's document). */
  clearForTest(): void {
    painted = null;
    material = null;
  },
};
