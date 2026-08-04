import * as THREE from 'three';
import { type MoonTerminator, moonTerminator } from './day_night_core';

// celestial_sprites: the sun and moon as they appear in the sky. Billboard
// sprites (always camera-facing, so they read as perfect circles anywhere on
// screen; a dome-shader disc would project to an ellipse off-axis) with
// canvas-drawn faces:
// - the sun is a white-hot core whose HDR material color pushes its texels
//   over the composer's bloom threshold (so it genuinely glares on bloom
//   tiers), under a soft corona and a wide horizontal lens streak;
// - the moon is a cratered face, normal-blended so its maria and craters read
//   DARK against the sky, over a modest cool glow that never washes the face.
//
// All textures are deterministic canvas paints (module-local LCG, the
// textures.ts convention: no Math.random, same face every boot). The renderer
// owns placement: it aims each sprite along the live sun/moon direction every
// frame and fades material.opacity from userData.baseOpacity by how far the
// body sits above the horizon (updateCelestialSprites).

// Per-painter LCG factory: each texture painter seeds its own instance, so
// the moon face repaints IDENTICALLY at every lunar-phase redraw (same
// craters, new shadow).
function makeRng(s: number): () => number {
  let seed = s >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

// The crisp solar disc: a white-hot plateau, a thin warm limb, a feathered rim
// to anti-alias the edge. The HDR push to bloom comes from the material color,
// not the texture (canvas pixels are LDR).
function sunCoreTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 120);
  g.addColorStop(0, 'rgba(255, 255, 248, 1)');
  g.addColorStop(0.62, 'rgba(255, 250, 232, 1)'); // hot plateau = crisp disc
  g.addColorStop(0.88, 'rgba(255, 226, 164, 1)'); // warm limb
  g.addColorStop(1, 'rgba(255, 214, 140, 0)'); // feathered rim
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(ctx.canvas);
}

// Soft round corona around the disc: a smooth gaussian-like falloff with no
// structure of its own, so it reads as the sun's bloom spilling into the sky
// (ray spokes looked like drawn lines and are gone).
function sunCoronaTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255, 226, 168, 0.6)');
  g.addColorStop(0.22, 'rgba(255, 218, 156, 0.34)');
  g.addColorStop(0.5, 'rgba(255, 210, 146, 0.13)');
  g.addColorStop(0.78, 'rgba(255, 206, 140, 0.04)');
  g.addColorStop(1, 'rgba(255, 206, 140, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(ctx.canvas);
}

// The horizontal lens streak: a radial gradient squashed flat, the classic
// anamorphic glare line. Drawn in its own texture so the sprite can be scaled
// wide and shallow.
function sunGlareTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 64);
  ctx.save();
  ctx.translate(128, 32);
  ctx.scale(1, 0.25);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255, 238, 200, 0.5)');
  g.addColorStop(0.4, 'rgba(255, 226, 170, 0.18)');
  g.addColorStop(1, 'rgba(255, 220, 160, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(-128, -128, 256, 256);
  ctx.restore();
  return new THREE.CanvasTexture(ctx.canvas);
}

// The cratered lunar face, repainted whenever the lunar phase crosses a
// repaint bucket: the craters come from a fresh fixed-seed LCG every paint
// (identical face each time), only the phase shadow changes. Light reads from
// the upper-left: every crater is a darker floor with a bright arc on its lit
// rim and a soft shadow arc opposite.
function paintMoonFace(ctx: CanvasRenderingContext2D, term: MoonTerminator | null): void {
  const rnd = makeRng(97);
  ctx.clearRect(0, 0, 256, 256);
  const R = 118;
  // base disc with limb darkening and a feathered anti-aliasing rim
  const base = ctx.createRadialGradient(118, 118, 0, 128, 128, R + 4);
  base.addColorStop(0, 'rgba(236, 240, 251, 1)');
  base.addColorStop(0.72, 'rgba(219, 225, 242, 1)');
  base.addColorStop(0.94, 'rgba(196, 204, 228, 1)');
  base.addColorStop(1, 'rgba(188, 196, 222, 0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  // everything else stays inside the disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, R, 0, Math.PI * 2);
  ctx.clip();
  // maria: a few broad soft basins
  for (let i = 0; i < 5; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = Math.sqrt(rnd()) * 62;
    const mx = 128 + Math.cos(ang) * dist;
    const my = 128 + Math.sin(ang) * dist;
    const mr = 26 + rnd() * 34;
    const m = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    m.addColorStop(0, 'rgba(148, 158, 194, 0.38)');
    m.addColorStop(0.7, 'rgba(156, 166, 200, 0.22)');
    m.addColorStop(1, 'rgba(160, 170, 204, 0)');
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, 256, 256);
  }
  // craters: darker floors, lit rim toward the upper-left light
  for (let i = 0; i < 18; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = Math.sqrt(rnd()) * 100;
    const cx = 128 + Math.cos(ang) * dist;
    const cy = 128 + Math.sin(ang) * dist;
    const cr = 4 + rnd() * 11;
    const floor = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    floor.addColorStop(0, 'rgba(132, 142, 180, 0.42)');
    floor.addColorStop(0.75, 'rgba(140, 150, 186, 0.3)');
    floor.addColorStop(1, 'rgba(150, 160, 194, 0)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, 256, 256);
    // lit rim arc (upper-left) and shadow arc (lower-right)
    ctx.strokeStyle = 'rgba(246, 249, 255, 0.5)';
    ctx.lineWidth = Math.max(1.1, cr * 0.16);
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 0.82, Math.PI * 0.8, Math.PI * 1.6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 130, 168, 0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 0.82, Math.PI * -0.2, Math.PI * 0.6);
    ctx.stroke();
  }
  ctx.restore();
  // The lunar-phase shadow: one path made of the shadow-side half of the
  // disc's circle plus the terminator ellipse's half back up, composited onto
  // the face only ('source-atop'). The fill stays a whisper short of opaque
  // so the dark limb keeps a hint of earthshine instead of vanishing into a
  // bite mark. Canvas angles: -pi/2 = top, +pi/2 = bottom, y grows downward.
  if (term && term.litFrac < 0.985) {
    ctx.save();
    // ERASE the shadowed region rather than darkening it: the dark side of a
    // real moon is just sky, so those pixels go transparent and whatever sky
    // is behind (day blue, dusk orange, night black) shows straight through.
    // The 0.95 leaves a 5% ghost of the face, the faint earthshine limb you
    // can just pick out against a dark night sky.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.beginPath();
    // The shadow sweeps a radius PAST the visible disc (R + 5 covers the
    // feathered anti-aliasing rim): 'source-atop' clips it to face pixels, so
    // overshooting is free, while an exact-R sweep left the rim as a bright
    // ring around the dark side.
    const RS = R + 5;
    // circle half on the shadow side, top to bottom (anticlockwise = left)
    ctx.arc(128, 128, RS, -Math.PI / 2, Math.PI / 2, term.shadowSide === -1);
    // terminator ellipse half, bottom back to top, through the bulge side
    // (in canvas, anticlockwise from +pi/2 passes through 0 = the right side)
    ctx.ellipse(
      128,
      128,
      Math.max(term.rx * RS, 0.001),
      RS,
      0,
      Math.PI / 2,
      -Math.PI / 2,
      term.bulgeSide === 1,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function moonGlowTexture(): THREE.CanvasTexture {
  const ctx = makeCanvas(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(168, 186, 232, 0.45)');
  g.addColorStop(0.4, 'rgba(158, 176, 224, 0.16)');
  g.addColorStop(1, 'rgba(150, 170, 220, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(ctx.canvas);
}

export interface CelestialSprites {
  /** aimed along the sun direction; [corona, glare streak, core disc] */
  sunSprites: THREE.Sprite[];
  /** aimed along the moon direction; [glow, cratered face] */
  moonSprites: THREE.Sprite[];
  /** Repaint the moon face for a lunar phase (0 = new, 0.5 = full). Cheap to
   *  call every frame: a no-op until the phase crosses its next repaint
   *  bucket (the shape moves imperceptibly between buckets). */
  setMoonPhase(p: number): void;
  /** Shift the sun's disc, corona, and glare toward deep sunset orange:
   *  0 = high noon white-gold, 1 = full horizon-crossing orange. Driven per
   *  frame from duskWarmAmount, so the disc itself sets the way the sky does. */
  setSunWarmth(w: number): void;
}

function makeSprite(
  tex: THREE.CanvasTexture,
  scaleX: number,
  scaleY: number,
  opacity: number,
  blending: THREE.Blending,
  renderOrder: number,
  color?: readonly [number, number, number],
): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    fog: false,
    depthWrite: false,
    // depth-tested so mountains, buildings, and trees occlude the discs: the
    // sun genuinely rises from BEHIND the skyline. They ride at 760u from the
    // camera, inside the 950 far plane and past all world geometry, so only
    // real silhouettes clip them (the dome draws at forced far depth).
    depthTest: true,
    blending,
    opacity,
  });
  // HDR push (pre-tonemap): values over 1 send the sun core past the bloom
  // threshold on composer tiers so the disc genuinely glares; harmless on
  // tiers without bloom (tonemapping just shoulders it back down).
  if (color) material.color.setRGB(color[0], color[1], color[2]);
  const sp = new THREE.Sprite(material);
  sp.scale.set(scaleX, scaleY, 1);
  sp.renderOrder = renderOrder;
  sp.frustumCulled = false; // rides the camera at a fixed offset; never cull it
  sp.userData.baseOpacity = opacity;
  return sp;
}

// The phase shadow's shape moves imperceptibly within 1/64th of the lunar
// cycle, so repaints snap to these buckets: at most 64 canvas paints per full
// cycle (eight world days), free in any given frame.
const MOON_PHASE_BUCKETS = 64;

/** Build the sun and moon sprite sets. The caller (renderer) categorizes and
 *  adds them to the scene, then drives position/opacity per frame and feeds
 *  the lunar phase through setMoonPhase. */
export function buildCelestialSprites(lowGfx: boolean): CelestialSprites {
  const sunSprites = [
    makeSprite(sunCoronaTexture(), 230, 230, lowGfx ? 0.6 : 0.5, THREE.AdditiveBlending, -9),
    // the anamorphic glare streak is a composer-tier flourish; low skips the draw
    ...(lowGfx ? [] : [makeSprite(sunGlareTexture(), 320, 80, 0.3, THREE.AdditiveBlending, -9)]),
    // the HDR push sits well past the bloom threshold so the disc genuinely
    // flares; the sun also stays visibly LARGER than the moon
    makeSprite(sunCoreTexture(), 46, 46, 1, THREE.AdditiveBlending, -8, [3.3, 2.95, 2.2]),
  ];
  // sunset tint rig: each sun sprite remembers its noon color and a sunset
  // target; setSunWarmth lerps between them allocation-free. The sunset core
  // drops most of its ENERGY as well as shifting hue: a high HDR value just
  // tonemaps back to white, so the saturated orange only exists at low
  // intensity, exactly like the real thing (a setting sun is dim enough to
  // look at). Red alone stays above the bloom threshold for a soft flare.
  // Order matches sunSprites: [corona, (glare), core].
  const sunsetTargets = [
    new THREE.Color(0.95, 0.4, 0.15),
    ...(lowGfx ? [] : [new THREE.Color(1.0, 0.42, 0.16)]),
    new THREE.Color(1.55, 0.6, 0.2),
  ];
  for (let i = 0; i < sunSprites.length; i++) {
    sunSprites[i].userData.baseColor = sunSprites[i].material.color.clone();
    sunSprites[i].userData.sunsetColor = sunsetTargets[i];
  }
  let lastWarmth = -1;
  // the moon face paints into a canvas the phase repaints reuse
  const faceCtx = makeCanvas(256, 256);
  paintMoonFace(faceCtx, null); // full face until the first setMoonPhase
  const faceTex = new THREE.CanvasTexture(faceCtx.canvas);
  const moonSprites = [
    makeSprite(moonGlowTexture(), 92, 92, 0.3, THREE.AdditiveBlending, -9),
    // normal-blended so maria/craters read dark; a light HDR lift lets the
    // bright face bloom gently against the night sky. Deliberately smaller
    // than the sun disc.
    makeSprite(faceTex, 38, 38, 1, THREE.NormalBlending, -8, [1.12, 1.15, 1.22]),
  ];
  let lastBucket = -1;
  return {
    sunSprites,
    moonSprites,
    setMoonPhase(p: number): void {
      const bucket = Math.floor((((p % 1) + 1) % 1) * MOON_PHASE_BUCKETS);
      if (bucket === lastBucket) return;
      lastBucket = bucket;
      const term = moonTerminator((bucket + 0.5) / MOON_PHASE_BUCKETS);
      paintMoonFace(faceCtx, term);
      faceTex.needsUpdate = true;
      // the halo follows the lit fraction: a full moon glows, a new one barely
      moonSprites[0].userData.baseOpacity = 0.3 * (0.2 + 0.8 * term.litFrac);
    },
    setSunWarmth(w: number): void {
      if (w === lastWarmth) return; // constant 0 through the high day: free
      lastWarmth = w;
      for (const sp of sunSprites) {
        sp.material.color
          .copy(sp.userData.baseColor as THREE.Color)
          .lerp(sp.userData.sunsetColor as THREE.Color, w);
      }
    },
  };
}
