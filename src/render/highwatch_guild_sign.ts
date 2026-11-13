// Lantern Hall's name over its doors: the guild's localized name and the line under it, painted
// once on a canvas and shown on the face of the name board the hall wears between its doors'
// arch and its jettied storey. The board itself is part of the guild's model (the
// `G_SignBoard` object of scripts/assets/eastbrook_houses/lots.py guild), so the lettering
// always sits on timber, never in the air. The harbor route markers' recipe
// (harbor_route_markers.ts): a language switch (woc:languagechange) or the web font arriving
// repaints the canvas in place: a texture upload, never a material or program change.
//
// GPU work and the camera fade: the plane is added to the guild's own model, in its frame,
// before the town kit converts its materials (highwatch_town.ts highwatchBuildingExtras, the
// kit's `decorate` hook), so it takes the building's material conversion, its fade twins, its
// fog cull and its reveal compile with the rest of the guild. Nothing here runs per frame.
import * as THREE from 'three';
import { guildSignLabels } from './entity_labels';

/** The name board over the hall's doors, in the guild's model frame (yards over its ground
 *  line; the doors look down model -z): the centre of the board's oak, and the size of the
 *  lettering painted on it. tests/highwatch_guild_sign.test.ts pins it to the `G_SignBoard`
 *  object of the shipped model, so a rebuilt hall can never leave the lettering behind. */
export const HIGHWATCH_GUILD_SIGN = {
  x: 0,
  y: 7.9,
  z: -10.99,
  width: 7,
  height: 1.477,
  /** The painted face's offset out from the board's centre plane (a real gap proud of the
   *  oak, behind the gilded frame's lip). */
  face: 0.13,
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

/** The painted face of the name board, in the guild's model frame (yards over its ground
 *  line), for the town kit to add to the model. Empty without a document (a Node host builds
 *  the town without the lettering). */
export function buildHighwatchGuildSign(): THREE.Group {
  const s = HIGHWATCH_GUILD_SIGN;
  const group = new THREE.Group();
  group.name = 'highwatchGuildSign';
  if (typeof document === 'undefined') return group;
  group.position.set(s.x, s.y, s.z);
  // One face, looking down model -z with the doors: the board is fixed to the wall, so
  // there is no far side to letter.
  const face = new THREE.Mesh(signGeometry(), signMaterial());
  face.name = 'GuildSignText';
  face.position.z = -s.face;
  face.rotation.y = Math.PI;
  group.add(face);
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
