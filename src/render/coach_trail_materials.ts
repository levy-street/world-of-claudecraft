// The Proving Shore coach's guidance materials (coach_trail.ts): the chevron
// ribbon, the target ring, the body aura, the objective beam and the camp's
// area ring, minted ONCE per page and shared by every rebuild.
//
// They used to be minted by the trail itself, lazily, on the frame the
// coach's route or target first changed, and disposed with every ribbon or
// area-ring rebuild: three keys a program on `map`, `transparent` and
// `side`, so the first quest accepted on the island linked the ribbon, the
// ring and the aura inside a live frame (measured 1.5 s with the reveal lane
// behind it), and every rebuild that disposed the sole material holding a
// program linked it again. This module is the lazy-cache idiom the boot
// manifest already drains (ability_material_prewarm.ts): the stand-in below
// wears these very materials on the mesh kinds the trail draws, so the boot
// compile links the three programs the island's first quest would otherwise
// pay for, and the trail's rebuilds only ever swap geometry.
import * as THREE from 'three';

export const COACH_GOLD = 0xffc860;
export const COACH_RING_INNER = 0.95;
export const COACH_RING_OUTER = 1.35;
export const COACH_BEAM_HEIGHT = 25;
export const COACH_BEAM_RADIUS = 0.55;

export interface CoachTrailMaterials {
  ribbon: THREE.MeshBasicMaterial;
  ring: THREE.MeshBasicMaterial;
  aura: THREE.SpriteMaterial;
  beam: THREE.MeshBasicMaterial;
  areaRing: THREE.MeshBasicMaterial;
}

/** A texture painted on a 2D canvas, or a 1x1 white DataTexture where no
 *  document exists (the Node test host): both carry `map` into the program
 *  key, which is all the prewarm stand-in needs to link the live program. */
function paintedTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    data.needsUpdate = true;
    return data;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d') as CanvasRenderingContext2D);
  return new THREE.CanvasTexture(canvas);
}

/** The race_line chevron strip, narrower: one arrow per repeat, pointing +u. */
function chevronTexture(): THREE.Texture {
  const w = 64;
  const h = 32;
  const tex = paintedTexture(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(10, 4);
    ctx.lineTo(34, 16);
    ctx.lineTo(10, 28);
    ctx.lineTo(22, 16);
    ctx.closePath();
    ctx.fill();
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A soft radial glow disc, drawn once (the aura sprite's face). */
function radialGlowTexture(): THREE.Texture {
  const size = 128;
  return paintedTexture(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

/** A vertical alpha falloff strip for the beam (bright at the ground, gone
 *  at the top). */
function beamFadeTexture(): THREE.Texture {
  const tex = paintedTexture(1, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 64, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1, 64);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

let coachMaterials: CoachTrailMaterials | null = null;

/** The one material set every coach trail and its prewarm stand-in wear. */
export function coachTrailMaterials(): CoachTrailMaterials {
  if (coachMaterials) return coachMaterials;
  const gold = (scale: number): THREE.Color => new THREE.Color(COACH_GOLD).multiplyScalar(scale);
  coachMaterials = {
    // Named, so a capture's live-program row can name a coach program.
    ribbon: new THREE.MeshBasicMaterial({
      name: 'coach:ribbon',
      map: chevronTexture(),
      color: gold(1.7),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    ring: new THREE.MeshBasicMaterial({
      name: 'coach:ring',
      color: gold(1.9),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    aura: new THREE.SpriteMaterial({
      name: 'coach:aura',
      map: radialGlowTexture(),
      color: gold(1.6),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    beam: new THREE.MeshBasicMaterial({
      name: 'coach:beam',
      map: beamFadeTexture(),
      color: gold(1.8),
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    areaRing: new THREE.MeshBasicMaterial({
      name: 'coach:areaRing',
      color: gold(1.8),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
  return coachMaterials;
}

/** The ring's geometry, shared by the live ring and the stand-in. */
export function coachRingGeometry(): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(COACH_RING_INNER, COACH_RING_OUTER, 40);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** The beam's geometry, shared by the live beam and the stand-in. */
export function coachBeamGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(
    COACH_BEAM_RADIUS,
    COACH_BEAM_RADIUS * 1.5,
    COACH_BEAM_HEIGHT,
    14,
    1,
    true,
  );
}

/** A two-triangle strip: the ribbon's and the area ring's geometry before any
 *  route exists, and the stand-in's, so every mesh carries the attribute set
 *  three keys the program on from birth. Fresh arrays per call: a geometry
 *  owns its buffers. */
export const COACH_STRIP_INDEX: readonly number[] = [0, 1, 2, 1, 3, 2];
export function coachStripPositions(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
}
export function coachStripUvs(): Float32Array {
  return new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]);
}

/** A draped strip with the ribbon's attribute set (position + uv, indexed). */
export function coachRibbonGeometry(
  positions: Float32Array,
  uvs: Float32Array,
  index: readonly number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([...index]);
  return geo;
}

/** An annulus strip with the area ring's attribute set (position only, indexed). */
export function coachAreaRingGeometry(
  positions: Float32Array,
  index: readonly number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([...index]);
  return geo;
}

/**
 * A hidden group drawing every coach material on the mesh kind the trail
 * draws it with (a plain Mesh with the ribbon's position+uv geometry, the
 * ring and beam geometries, a Sprite, the area ring's position-only strip):
 * three keys the geometry's attributes and the object kind into the program
 * cache key, so each stand-in links exactly the program the live trail asks
 * for. Staged by the boot manifest through ABILITY_MATERIAL_SOURCES.
 */
export function buildCoachTrailStandIn(): THREE.Group {
  const mats = coachTrailMaterials();
  const group = new THREE.Group();
  group.name = 'coach-trail-stand-in';
  const ribbon = new THREE.Mesh(
    coachRibbonGeometry(coachStripPositions(), coachStripUvs(), COACH_STRIP_INDEX),
    mats.ribbon,
  );
  const ring = new THREE.Mesh(coachRingGeometry(), mats.ring);
  const aura = new THREE.Sprite(mats.aura);
  const beam = new THREE.Mesh(coachBeamGeometry(), mats.beam);
  const areaRing = new THREE.Mesh(
    coachAreaRingGeometry(coachStripPositions(), COACH_STRIP_INDEX),
    mats.areaRing,
  );
  for (const object of [ribbon, ring, aura, beam, areaRing]) {
    object.visible = false;
    object.frustumCulled = false;
    group.add(object);
  }
  return group;
}

export function resetCoachTrailMaterialsForTest(): void {
  coachMaterials = null;
}
