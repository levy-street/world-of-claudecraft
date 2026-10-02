// Balgath's ranged-punish kit and his cleave, on the ground and in the air.
//
// Composed by BalgathFx (balgath_fx.ts), which owns routing and the shared dust, ring and
// crater layer; this module owns the pieces that layer cannot express:
//
//  - BOULDER TOSS   a draped ground mark per victim (dark base, an amber fill that grows
//                   from the centre and reaches the rim exactly when it lands, a pulsing
//                   rim) and the Blender-built boulder itself: in the ground at his hands,
//                   torn free, lifted overhead, hurled on an arc that lands on the mark.
//                   On landing it shatters into the kit's chunks over the shared dust.
//  - FOREMAN'S GLARE a draped teal rectangle from his feet through the victim that fills
//                   outward from him, with bright edges, outward chevrons and a thin aiming
//                   ray from his eye; then the beam, eye to ground, stopped on whatever
//                   solid thing the sim said stopped it.
//  - BARROW BURDEN  the shared-soak marker (ignivar_soak_telegraph.ts, the Shared Pyre's own
//                   marker in a brown palette) at the carrier's feet, and our own vortex of
//                   dust arcs, a funnel and the kit's stone shards spinning over their head,
//                   winding tighter, lower and faster as it comes due.
//  - BARROW CLEAVE  a draped fan that fills from him outward, a bright rim and edges, and
//                   upward chevrons standing on the fan that climb as the arm comes: the
//                   telegraph literally says "up". Then a dust and rock-chip wave that runs
//                   along the arc in the direction the arm swept.
//
// Every telegraph piece here is actionable information and is drawn on EVERY graphics
// preset (the gameplay-neutral-graphics invariant); only the landing debris is scaled by
// the quality knob (the shared dust layer's own, and this layer's shatter chunk count). Reduced motion stills the spin and bob and
// keeps every fill, since the fill IS the timer.
//
// GPU: the four material kinds live in one module-level bundle, registered as a boot
// prewarm source (ability_material_prewarm.ts), and every live piece draws a CLONE of one
// of them, so no spawn ever links a program inside a combat frame.

import * as THREE from 'three';
import {
  BALGATH_BOULDER_CHUNKS,
  BALGATH_BOULDER_SHARDS,
  balgathBoulderGeometry,
  balgathChunkGeometry,
  balgathShardGeometry,
} from './balgath_boulder_kit';
import { BALGATH_CLEAVE_HALF_ARC } from './balgath_fx_core';
import {
  BALGATH_BOULDER_GRIP,
  BALGATH_BOULDER_OVERHEAD,
  BALGATH_BOULDER_RIP_SECONDS,
  BALGATH_BOULDER_SCALE,
  BALGATH_BOULDER_TRAUMA,
  BALGATH_BURDEN_AURA_ID,
  BALGATH_BURDEN_RADIUS,
  BALGATH_BURDEN_TRAUMA,
  BALGATH_CLEAVE_WAVE_SECONDS,
  BALGATH_GLARE_BEAM_SECONDS,
  BALGATH_GLARE_HALF_WIDTH,
  BALGATH_GLARE_TRAUMA,
  BALGATH_SHATTER_SECONDS,
  boulderInFlight,
  boulderPosition,
  burdenProgress,
  burdenVortexPlan,
  cleaveChevronLift,
  cleaveWaveAngle,
  playersInsideBurden,
  telegraphFill,
  telegraphRimAlpha,
  type Vec3Like,
} from './balgath_ranged_fx_core';
import {
  buildIgnivarSoakTelegraph,
  type SoakTelegraphStyle,
  syncIgnivarSoakTelegraph,
} from './ignivar_soak_telegraph';

// ---- palette -----------------------------------------------------------------------
// Boulder: earth and ember amber on a dark base, so it reads on marsh green and mud alike.
const BOULDER_BASE = 0x24150a;
const BOULDER_FILL = 0xff9a3c;
const BOULDER_RIM = 0xffcf7a;
// Glare: the Barrowglass teal his eye burns with.
const GLARE_BASE = 0x04241c;
const GLARE_FILL = 0x3fd6ae;
const GLARE_EDGE = 0xb8fff0;
const GLARE_CORE = 0xe6fffa;
// Cleave: dusty amber, distinct from both.
const CLEAVE_BASE = 0x2a2016;
const CLEAVE_FILL = 0xffb14e;
const CLEAVE_EDGE = 0xffe3a8;
const CLEAVE_CHEVRON = 0xfff4c8;
// Burden: brown earth, with pale sand for the lines that must pop against it.
const BURDEN_ARC = 0xf0c58a;
const BURDEN_ARC_HOT = 0xffe6b8;
const BURDEN_FUNNEL = 0x9a6a36;

/** The Barrow Burden's marker: the Shared Pyre's marker, re-dressed in the fen's earth. */
export const BURDEN_SOAK_STYLE: Readonly<SoakTelegraphStyle> = Object.freeze({
  radius: BALGATH_BURDEN_RADIUS,
  fill: 0x6b3f1a,
  fillOpacity: 0.3,
  rim: 0xe8a860,
  swirl: 0xb87838,
  arrows: 0xf6d6a0,
  timer: 0xfff0c8,
  ready: 0xfff4d8,
  occupied: 0xffd89a,
  empty: 0x3a2412,
  fireCallIn: false,
});

// ---- the one material bundle -------------------------------------------------------

export interface BalgathRangedMaterials {
  /** Dark, normal-blended ground base: contrast under every bright line. */
  groundBase: THREE.MeshBasicMaterial;
  /** Additive ground fills, rims, edges and chevrons. */
  groundGlow: THREE.MeshBasicMaterial;
  /** Additive airborne pieces: the beam, the aim ray, the vortex arcs and funnel. */
  airGlow: THREE.MeshBasicMaterial;
  /** The vertex-coloured granite of the boulder kit. Shared, never animated. */
  rock: THREE.MeshStandardMaterial;
}

let balgathRangedMats: BalgathRangedMaterials | null = null;

export function balgathRangedMaterials(): BalgathRangedMaterials {
  if (balgathRangedMats) return balgathRangedMats;
  const glow = (): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  const groundGlow = glow();
  groundGlow.polygonOffset = true;
  groundGlow.polygonOffsetFactor = -4;
  groundGlow.polygonOffsetUnits = -4;
  const groundBase = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  balgathRangedMats = {
    groundBase,
    groundGlow,
    airGlow: glow(),
    rock: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      flatShading: true,
    }),
  };
  return balgathRangedMats;
}

/**
 * The boot prewarm stand-in: one hidden mesh per material kind, on the mesh kinds the live
 * pieces draw (plain Meshes; the rock on a vertex-coloured geometry), so every program a
 * live boulder, glare, burden or cleave draws is linked behind the loading cover.
 */
export function buildBalgathRangedStandIn(): THREE.Group {
  const m = balgathRangedMaterials();
  const group = new THREE.Group();
  group.name = 'balgath-ranged-standin';
  // Two geometry kinds, because a geometry's normal attribute is part of three's program
  // key: every draped ground piece and the cleave's chevrons are position-only, while the
  // beam, the vortex arcs and the funnels carry normals.
  const draped = drapedSector(() => 0, 0, 0, 0, 1, 0, Math.PI, 1, 8);
  const plane = new THREE.PlaneGeometry(1, 1);
  group.add(
    new THREE.Mesh(draped, m.groundBase),
    new THREE.Mesh(draped, m.groundGlow),
    new THREE.Mesh(draped, m.airGlow),
    new THREE.Mesh(plane, m.airGlow),
    new THREE.Mesh(balgathBoulderGeometry(), m.rock),
  );
  // The burden marker's own soak rings, in its palette (the same programs as the Shared
  // Pyre's; built here too so a Balgath-only session never depends on Varkhul's warm-up).
  group.add(buildIgnivarSoakTelegraph(4, BURDEN_SOAK_STYLE));
  group.visible = false;
  return group;
}

// ---- draped geometry ---------------------------------------------------------------
// Built in WORLD space with each vertex sampled onto the terrain, so a seventy-yard glare
// line over a rise hugs the rise instead of vanishing into it. Band order is inner to
// outer (or origin to far end), so `setDrawRange` reveals a fill from the centre outward.

export type GroundAt = (x: number, z: number) => number;
export const LIFT = 0.12;

function finish(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * An indexed draped grid: `rows + 1` by `cols + 1` shared vertices, each sampled onto the
 * ground ONCE, and two triangles per cell ordered row-major, so `setDrawRange(0, k * cols
 * * 6)` reveals exactly the first k rows. Sharing the vertices (rather than six copies per
 * cell) is what keeps a boulder's two marks to a few hundred terrain samples in the frame
 * the event arrives, instead of fifteen thousand.
 */
export function drapedGrid(
  rows: number,
  cols: number,
  point: (row: number, col: number) => [number, number],
  ground: GroundAt,
  lift: number,
): THREE.BufferGeometry {
  const positions = new Float32Array((rows + 1) * (cols + 1) * 3);
  let o = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [x, z] = point(r, c);
      positions[o++] = x;
      positions[o++] = ground(x, z) + lift;
      positions[o++] = z;
    }
  }
  const index: number[] = [];
  const w = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * w + c;
      const i1 = (r + 1) * w + c;
      index.push(i0, i1, i1 + 1, i0, i1 + 1, i0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** A draped annular sector, `bands` rings from rIn to rOut; full circle when half >= PI. */
export function drapedSector(
  ground: GroundAt,
  cx: number,
  cz: number,
  rIn: number,
  rOut: number,
  aim: number,
  half: number,
  bands: number,
  segs: number,
  lift = LIFT,
): THREE.BufferGeometry {
  return drapedGrid(
    bands,
    segs,
    (b, sIdx) => {
      const r = rIn + ((rOut - rIn) * b) / bands;
      const a = aim - half + (2 * half * sIdx) / segs;
      return [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
    },
    ground,
    lift,
  );
}

/** A draped strip along (dirX, dirZ), `from` to `to` yards, between offsets A and B. */
export function drapedStrip(
  ground: GroundAt,
  ox: number,
  oz: number,
  dirX: number,
  dirZ: number,
  from: number,
  to: number,
  offA: number,
  offB: number,
  step = 1,
  lift = LIFT,
): THREE.BufferGeometry {
  const px = dirZ;
  const pz = -dirX;
  const n = Math.max(1, Math.ceil((to - from) / step));
  return drapedGrid(
    n,
    1,
    (i, side) => {
      const d = from + ((to - from) * i) / n;
      const off = side === 0 ? offA : offB;
      return [ox + dirX * d + px * off, oz + dirZ * d + pz * off];
    },
    ground,
    lift,
  );
}

/** Flat arrow heads pointing down the line, every `every` yards. */
function drapedChevrons(
  ground: GroundAt,
  ox: number,
  oz: number,
  dirX: number,
  dirZ: number,
  length: number,
  every: number,
  size: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const px = dirZ;
  const pz = -dirX;
  for (let d = every; d < length - 1; d += every) {
    const tipX = ox + dirX * (d + size * 0.6);
    const tipZ = oz + dirZ * (d + size * 0.6);
    const lx = ox + dirX * (d - size * 0.4) + px * size * 0.7;
    const lz = oz + dirZ * (d - size * 0.4) + pz * size * 0.7;
    const rx = ox + dirX * (d - size * 0.4) - px * size * 0.7;
    const rz = oz + dirZ * (d - size * 0.4) - pz * size * 0.7;
    const y = (x: number, z: number) => ground(x, z) + LIFT + 0.02;
    pos.push(tipX, y(tipX, tipZ), tipZ, lx, y(lx, lz), lz, rx, y(rx, rz), rz);
  }
  return finish(pos);
}

/** One upright "jump" chevron: a caret made of two slanted bars, 1 unit tall, facing +Z. */
function chevronGeometry(): THREE.BufferGeometry {
  const w = 0.55;
  const t = 0.26;
  const pos = [
    // left bar
    -w,
    0,
    0,
    -w + t,
    0,
    0,
    0,
    0.62,
    0,
    -w + t,
    0,
    0,
    t * 0.5,
    0.62 - t,
    0,
    0,
    0.62,
    0,
    // right bar
    w,
    0,
    0,
    0,
    0.62,
    0,
    w - t,
    0,
    0,
    w - t,
    0,
    0,
    0,
    0.62,
    0,
    -t * 0.5,
    0.62 - t,
    0,
  ];
  return finish(pos);
}

// ---- live pieces -------------------------------------------------------------------

interface Owned {
  group: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

interface BoulderMark extends Owned {
  sourceId: number;
  slot: number;
  land: Vec3Like;
  elapsed: number;
  duration: number;
  fill: THREE.Mesh;
  rim: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  rock: THREE.Mesh;
  launch: Vec3Like | null;
  ripped: boolean;
  spin: THREE.Vector3;
}

interface GlareMark extends Owned {
  sourceId: number;
  elapsed: number;
  duration: number;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  edgeMat: THREE.MeshBasicMaterial;
  chevronMat: THREE.MeshBasicMaterial;
  ray: THREE.Mesh;
  rayMat: THREE.MeshBasicMaterial;
  end: Vec3Like;
}

interface Fade extends Owned {
  elapsed: number;
  life: number;
  mat: THREE.MeshBasicMaterial[];
  peak: number[];
}

interface CleaveMark extends Owned {
  elapsed: number;
  duration: number;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  edgeMat: THREE.MeshBasicMaterial;
  chevrons: THREE.Mesh[];
  chevronMat: THREE.MeshBasicMaterial;
  ground: number[];
}

interface Chunk {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  spin: THREE.Vector3;
  floor: number;
  scale: number;
}

interface Shatter {
  group: THREE.Group;
  chunks: Chunk[];
  elapsed: number;
  life: number;
}

interface Wave {
  x: number;
  z: number;
  radius: number;
  aim: number;
  elapsed: number;
  fired: number;
}

interface BurdenMarker {
  root: THREE.Group;
  soak: THREE.Group;
  vortex: THREE.Group;
  arcs: THREE.Mesh[];
  funnel: THREE.Mesh;
  shards: THREE.Mesh[];
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  seen: boolean;
  elapsed: number;
  lastX: number;
  lastY: number;
  lastZ: number;
}

/** What the ranged layer needs from its owner: the shared dust, ring, crater and shake. */
export interface BalgathRangedHooks {
  felt(trauma: number, x: number, z: number): void;
  ground(x: number, z: number, radius: number, power: number): void;
  ring(x: number, z: number, radius: number, power: number): void;
  crater(x: number, z: number, radius: number): void;
}

/** The entity shape read each frame (the owner's world walk hands these in). */
export interface RangedBody {
  id: number;
  kind?: string;
  templateId?: string;
  dead?: boolean;
  facing?: number;
  scale?: number;
  pos: { x: number; y: number; z: number };
  auras?: {
    id?: string;
    remaining?: number;
    duration?: number;
    stacks?: number;
    sourceId?: number;
  }[];
}

const MAX_SHATTERS = 16;

export class BalgathRangedFx {
  private boulders: BoulderMark[] = [];
  private glares: GlareMark[] = [];
  private fades: Fade[] = [];
  private cleaves: CleaveMark[] = [];
  private shatters: Shatter[] = [];
  private waves: Wave[] = [];
  private burdens = new Map<number, BurdenMarker>();
  private bosses = new Map<number, RangedBody>();
  private carriers: RangedBody[] = [];
  private players: RangedBody[] = [];
  private clock = 0;
  private quality = 1;
  private cylinder: THREE.CylinderGeometry | null = null;
  private chevron: THREE.BufferGeometry | null = null;

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: GroundAt,
    private hooks: BalgathRangedHooks,
  ) {}

  /** Cosmetic density knob (0..1): scales shatter chunks only, never a telegraph. */
  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, level));
  }

  // ---- per-frame world intake (one pass, driven by the owner's entity walk) ----------

  /** Start a frame's intake. */
  beginFrame(): void {
    this.bosses.clear();
    this.carriers.length = 0;
    this.players.length = 0;
  }

  /** Note one entity from the world walk: a Balgath body, a player, a burden carrier. */
  note(e: RangedBody, isBalgath: boolean): void {
    if (isBalgath) {
      this.bosses.set(e.id, e);
      return;
    }
    if (e.kind !== 'player') return;
    this.players.push(e);
    const auras = e.auras;
    if (!auras) return;
    for (let i = 0; i < auras.length; i++) {
      if (auras[i].id === BALGATH_BURDEN_AURA_ID) {
        this.carriers.push(e);
        return;
      }
    }
  }

  // ---- Boulder Toss -------------------------------------------------------------------

  boulderTelegraph(sourceId: number, x: number, z: number, radius: number, duration: number): void {
    const m = balgathRangedMaterials();
    const ground = this.groundHeightAt;
    const group = new THREE.Group();
    group.name = 'balgath-boulder-mark';
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(BOULDER_BASE);
    baseMat.opacity = 0.5;
    const fillMat = m.groundGlow.clone();
    fillMat.color.setHex(BOULDER_FILL);
    fillMat.opacity = 0.5;
    const rimMat = m.groundGlow.clone();
    rimMat.color.setHex(BOULDER_RIM);
    const base = drapedSector(ground, x, z, 0, radius, 0, Math.PI, 1, 48, LIFT - 0.02);
    const fillGeo = drapedSector(ground, x, z, 0, radius, 0, Math.PI, 24, 48);
    const rimGeo = drapedSector(
      ground,
      x,
      z,
      radius - 0.38,
      radius,
      0,
      Math.PI,
      1,
      64,
      LIFT + 0.02,
    );
    const innerGeo = drapedSector(ground, x, z, 0.6, 0.85, 0, Math.PI, 1, 32, LIFT + 0.02);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.userData.bands = 24;
    fill.userData.segs = 48;
    const lead = leadingEdge(fill, fillGeo, rimMat);
    group.add(
      withOrder(new THREE.Mesh(base, baseMat), 1),
      withOrder(fill, 2),
      lead,
      withOrder(new THREE.Mesh(rimGeo, rimMat), 3),
      withOrder(new THREE.Mesh(innerGeo, rimMat), 3),
    );
    const rock = new THREE.Mesh(balgathBoulderGeometry(), m.rock);
    rock.scale.setScalar(BALGATH_BOULDER_SCALE);
    rock.visible = false;
    group.add(rock);
    this.scene.add(group);
    const slot = this.boulders.filter((b) => b.sourceId === sourceId && b.elapsed < 0.05).length;
    this.boulders.push({
      group,
      mats: [baseMat, fillMat, rimMat],
      geos: [base, fillGeo, lead.geometry, rimGeo, innerGeo],
      sourceId,
      slot,
      land: { x, y: ground(x, z) + BALGATH_BOULDER_SCALE * 0.6, z },
      elapsed: 0,
      duration: Math.max(0.3, duration),
      fill,
      rim: rimMat,
      fillMat,
      rock,
      launch: null,
      ripped: false,
      spin: new THREE.Vector3(2.1 + slot, 1.3, 0.7 - slot),
    });
  }

  /** The rock arrives: shatter it where it landed (the dust, crater and shake are the owner's). */
  boulderLanded(x: number, z: number, radius: number): void {
    this.hooks.felt(BALGATH_BOULDER_TRAUMA, x, z);
    this.shatter(x, z, BALGATH_BOULDER_CHUNKS, 1, radius * 1.4, 'chunk');
    // Retire the mark whose boulder this was, so the rock never lingers on the ground.
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.boulders.length; i++) {
      const b = this.boulders[i];
      const d = Math.hypot(b.land.x - x, b.land.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0 && bestD < 1.5) this.retire(this.boulders, best);
  }

  // ---- Foreman's Glare ----------------------------------------------------------------

  glareTelegraph(
    sourceId: number,
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    length: number,
    duration: number,
  ): void {
    const m = balgathRangedMaterials();
    const ground = this.groundHeightAt;
    const hw = BALGATH_GLARE_HALF_WIDTH;
    const group = new THREE.Group();
    group.name = 'balgath-glare-mark';
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(GLARE_BASE);
    baseMat.opacity = 0.5;
    const fillMat = m.groundGlow.clone();
    fillMat.color.setHex(GLARE_FILL);
    fillMat.opacity = 0.42;
    const edgeMat = m.groundGlow.clone();
    edgeMat.color.setHex(GLARE_EDGE);
    const chevronMat = m.groundGlow.clone();
    chevronMat.color.setHex(GLARE_EDGE);
    chevronMat.opacity = 0.6;
    const base = drapedStrip(ground, ox, oz, dirX, dirZ, 0, length, -hw, hw, 2, LIFT - 0.02);
    const fillGeo = drapedStrip(ground, ox, oz, dirX, dirZ, 0, length, -hw, hw, 1);
    const edgeA = drapedStrip(ground, ox, oz, dirX, dirZ, 0, length, hw - 0.32, hw, 2, LIFT + 0.02);
    const edgeB = drapedStrip(
      ground,
      ox,
      oz,
      dirX,
      dirZ,
      0,
      length,
      -hw,
      -hw + 0.32,
      2,
      LIFT + 0.02,
    );
    const cap = drapedStrip(
      ground,
      ox,
      oz,
      dirX,
      dirZ,
      length - 0.45,
      length,
      -hw,
      hw,
      1,
      LIFT + 0.02,
    );
    const chev = drapedChevrons(ground, ox, oz, dirX, dirZ, length, 5, 1.1);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.userData.bands = Math.max(1, Math.ceil(length));
    fill.userData.segs = 1;
    const lead = leadingEdge(fill, fillGeo, edgeMat);
    const endX = ox + dirX * length;
    const endZ = oz + dirZ * length;
    const rayMat = m.airGlow.clone();
    rayMat.color.setHex(GLARE_FILL);
    rayMat.opacity = 0;
    const ray = new THREE.Mesh(this.unitCylinder(), rayMat);
    ray.renderOrder = 6;
    group.add(
      withOrder(new THREE.Mesh(base, baseMat), 1),
      withOrder(fill, 2),
      lead,
      withOrder(new THREE.Mesh(edgeA, edgeMat), 3),
      withOrder(new THREE.Mesh(edgeB, edgeMat), 3),
      withOrder(new THREE.Mesh(cap, edgeMat), 3),
      withOrder(new THREE.Mesh(chev, chevronMat), 3),
      ray,
    );
    this.scene.add(group);
    this.glares.push({
      group,
      mats: [baseMat, fillMat, edgeMat, chevronMat, rayMat],
      geos: [base, fillGeo, lead.geometry, edgeA, edgeB, cap, chev],
      sourceId,
      elapsed: 0,
      duration: Math.max(0.3, duration),
      fill,
      fillMat,
      edgeMat,
      chevronMat,
      ray,
      rayMat,
      end: { x: endX, y: ground(endX, endZ) + 0.6, z: endZ },
    });
  }

  /** The beam fires down the line and stops at `reach` (short of the end when covered). */
  glareFired(
    sourceId: number,
    ox: number,
    oz: number,
    dirX: number,
    dirZ: number,
    reach: number,
  ): void {
    // Any glare telegraph from this caster is spent.
    for (let i = this.glares.length - 1; i >= 0; i--) {
      if (this.glares[i].sourceId === sourceId) this.retire(this.glares, i);
    }
    const m = balgathRangedMaterials();
    const ground = this.groundHeightAt;
    const endX = ox + dirX * reach;
    const endZ = oz + dirZ * reach;
    const end = { x: endX, y: ground(endX, endZ) + 0.4, z: endZ };
    const eye = this.eyeOf(sourceId, ox, oz);
    const group = new THREE.Group();
    group.name = 'balgath-glare-beam';
    const outer = m.airGlow.clone();
    outer.color.setHex(GLARE_FILL);
    const core = m.airGlow.clone();
    core.color.setHex(GLARE_CORE);
    const scorch = m.groundGlow.clone();
    scorch.color.setHex(GLARE_FILL);
    const beamOuter = new THREE.Mesh(this.unitCylinder(), outer);
    const beamCore = new THREE.Mesh(this.unitCylinder(), core);
    placeBetween(beamOuter, eye, end, 1.15);
    placeBetween(beamCore, eye, end, 0.42);
    beamOuter.renderOrder = 6;
    beamCore.renderOrder = 7;
    const trail = drapedStrip(ground, ox, oz, dirX, dirZ, 0, reach, -1.2, 1.2, 1, LIFT + 0.03);
    group.add(beamOuter, beamCore, withOrder(new THREE.Mesh(trail, scorch), 3));
    this.scene.add(group);
    this.fades.push({
      group,
      mats: [outer, core, scorch],
      geos: [trail],
      elapsed: 0,
      life: BALGATH_GLARE_BEAM_SECONDS,
      mat: [outer, core, scorch],
      peak: [0.75, 1, 0.8],
    });
    // Ploughed earth down the line, and a burst where it stopped.
    for (let d = 6; d < reach; d += 7) this.hooks.ground(ox + dirX * d, oz + dirZ * d, 1.6, 0.45);
    this.hooks.ring(endX, endZ, 3, 0.8);
    this.hooks.ground(endX, endZ, 2.2, 1.1);
    this.hooks.felt(BALGATH_GLARE_TRAUMA, endX, endZ);
  }

  // ---- Barrow Cleave ------------------------------------------------------------------

  cleaveTelegraph(x: number, z: number, radius: number, aim: number, duration: number): void {
    const m = balgathRangedMaterials();
    const ground = this.groundHeightAt;
    const half = BALGATH_CLEAVE_HALF_ARC;
    const group = new THREE.Group();
    group.name = 'balgath-cleave-mark';
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(CLEAVE_BASE);
    baseMat.opacity = 0.5;
    const fillMat = m.groundGlow.clone();
    fillMat.color.setHex(CLEAVE_FILL);
    fillMat.opacity = 0.45;
    const edgeMat = m.groundGlow.clone();
    edgeMat.color.setHex(CLEAVE_EDGE);
    const chevronMat = m.airGlow.clone();
    chevronMat.color.setHex(CLEAVE_CHEVRON);
    const rIn = radius * 0.1;
    const base = drapedSector(ground, x, z, rIn, radius, aim, half, 1, 40, LIFT - 0.02);
    const fillGeo = drapedSector(ground, x, z, rIn, radius, aim, half, 20, 40);
    const rim = drapedSector(ground, x, z, radius - 0.45, radius, aim, half, 1, 48, LIFT + 0.02);
    const sideA = drapedStrip(
      ground,
      x,
      z,
      Math.sin(aim - half),
      Math.cos(aim - half),
      rIn,
      radius,
      -0.18,
      0.18,
      1,
      LIFT + 0.02,
    );
    const sideB = drapedStrip(
      ground,
      x,
      z,
      Math.sin(aim + half),
      Math.cos(aim + half),
      rIn,
      radius,
      -0.18,
      0.18,
      1,
      LIFT + 0.02,
    );
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.userData.bands = 20;
    fill.userData.segs = 40;
    const lead = leadingEdge(fill, fillGeo, edgeMat);
    group.add(
      withOrder(new THREE.Mesh(base, baseMat), 1),
      withOrder(fill, 2),
      lead,
      withOrder(new THREE.Mesh(rim, edgeMat), 3),
      withOrder(new THREE.Mesh(sideA, edgeMat), 3),
      withOrder(new THREE.Mesh(sideB, edgeMat), 3),
    );
    // The "up" chevrons: five carets standing on the fan, facing out from him (where the
    // raid is), each doubled so it reads as a stacked "jump" glyph.
    const chevrons: THREE.Mesh[] = [];
    const groundY: number[] = [];
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const a = aim - half * 0.8 + (1.6 * half * i) / (steps - 1);
      const r = radius * 0.6;
      const cx = x + Math.sin(a) * r;
      const cz = z + Math.cos(a) * r;
      for (let k = 0; k < 2; k++) {
        const c = new THREE.Mesh(this.chevronGeo(), chevronMat);
        c.position.set(cx, 0, cz);
        c.rotation.y = a;
        c.scale.setScalar(1.7);
        c.userData.stack = k;
        c.renderOrder = 6;
        group.add(c);
        chevrons.push(c);
        groundY.push(ground(cx, cz));
      }
    }
    this.scene.add(group);
    this.cleaves.push({
      group,
      mats: [baseMat, fillMat, edgeMat, chevronMat],
      geos: [base, fillGeo, lead.geometry, rim, sideA, sideB],
      elapsed: 0,
      duration: Math.max(0.3, duration),
      fill,
      fillMat,
      edgeMat,
      chevrons,
      chevronMat,
      ground: groundY,
    });
  }

  /** The arm comes across: a dust and rock-chip wave that runs along the arc. */
  cleaveLanded(x: number, z: number, radius: number, aim: number): void {
    for (let i = this.cleaves.length - 1; i >= 0; i--) this.retire(this.cleaves, i);
    this.waves.push({ x, z, radius, aim, elapsed: 0, fired: 0 });
  }

  // ---- Barrow Burden ------------------------------------------------------------------

  /** The weight lands on the carrier: the shards come down with the dust. */
  burdenLanded(x: number, z: number, radius: number): void {
    this.hooks.felt(BALGATH_BURDEN_TRAUMA, x, z);
    this.hooks.ring(x, z, radius, 1);
    this.hooks.crater(x, z, radius * 0.8);
    this.hooks.ground(x, z, radius, 1.3);
    this.shatter(x, z, BALGATH_BOULDER_SHARDS * 3, 1.5, radius, 'shard');
  }

  private buildBurden(recommended: number): BurdenMarker {
    const m = balgathRangedMaterials();
    const root = new THREE.Group();
    root.name = 'balgath-burden-marker';
    const soak = buildIgnivarSoakTelegraph(recommended, BURDEN_SOAK_STYLE);
    root.add(soak);
    const vortex = new THREE.Group();
    vortex.name = 'balgath-burden-vortex';
    const mats: THREE.Material[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const arcs: THREE.Mesh[] = [];
    // Five partial dust arcs stacked into a spinning column, each on its own tilt and
    // spun at its own rate (and alternate ones the other way) below: bright thin lines over
    // soft mass, which is what makes a vortex read at a glance rather than as a blob.
    for (let i = 0; i < 5; i++) {
      const mat = m.airGlow.clone();
      mat.color.setHex(i % 2 === 0 ? BURDEN_ARC : BURDEN_ARC_HOT);
      mat.opacity = 0.95 - i * 0.1;
      const geo = new THREE.TorusGeometry(
        1.1 + i * 0.32,
        0.15 - i * 0.018,
        6,
        56,
        Math.PI * (1.15 + 0.14 * i),
      );
      const arc = new THREE.Mesh(geo, mat);
      arc.rotation.x = Math.PI / 2 + ((i % 3) - 1) * 0.28;
      arc.rotation.z = i * 2.1;
      arc.position.y = -0.9 + i * 0.45;
      arc.renderOrder = 7;
      vortex.add(arc);
      arcs.push(arc);
      mats.push(mat);
      geos.push(geo);
    }
    // An inverted dust funnel under the arcs, narrowing down onto the carrier, with a
    // brighter inner core so it holds its shape against a bright sky and a dark fen alike.
    const funnelMat = m.airGlow.clone();
    funnelMat.color.setHex(BURDEN_FUNNEL);
    funnelMat.opacity = 0.5;
    const funnelGeo = new THREE.ConeGeometry(2.3, 3.4, 24, 1, true);
    const funnel = new THREE.Mesh(funnelGeo, funnelMat);
    funnel.rotation.x = Math.PI;
    funnel.position.y = -0.4;
    funnel.renderOrder = 6;
    vortex.add(funnel);
    mats.push(funnelMat);
    geos.push(funnelGeo);
    const coreMat = m.airGlow.clone();
    coreMat.color.setHex(BURDEN_ARC);
    coreMat.opacity = 0.32;
    const coreGeo = new THREE.ConeGeometry(1.1, 3, 18, 1, true);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.rotation.x = Math.PI;
    core.position.y = -0.55;
    core.renderOrder = 6;
    funnel.add(core);
    core.position.set(0, 0.1, 0);
    core.rotation.set(0, 0, 0);
    mats.push(coreMat);
    geos.push(coreGeo);
    // The kit's stone shards, tumbling round the column.
    const shards: THREE.Mesh[] = [];
    for (let i = 0; i < BALGATH_BOULDER_SHARDS * 3; i++) {
      const s = new THREE.Mesh(balgathShardGeometry(i), m.rock);
      s.scale.setScalar(2.6 + (i % 3) * 0.4);
      vortex.add(s);
      shards.push(s);
    }
    root.add(vortex);
    this.scene.add(root);
    return {
      root,
      soak,
      vortex,
      arcs,
      funnel,
      shards,
      mats,
      geos,
      seen: true,
      elapsed: 0,
      lastX: 0,
      lastY: 0,
      lastZ: 0,
    };
  }

  private syncBurdens(dt: number, reducedMotion: boolean): void {
    for (const marker of this.burdens.values()) marker.seen = false;
    for (const carrier of this.carriers) {
      let aura: NonNullable<RangedBody['auras']>[number] | undefined;
      for (const a of carrier.auras ?? []) {
        if (a.id === BALGATH_BURDEN_AURA_ID) {
          aura = a;
          break;
        }
      }
      if (!aura) continue;
      // A mark whose boss has fallen will never land: do not keep promising it.
      const boss = aura.sourceId !== undefined ? this.bosses.get(aura.sourceId) : undefined;
      if (boss?.dead) continue;
      let marker = this.burdens.get(carrier.id);
      if (!marker) {
        marker = this.buildBurden(Math.max(1, Math.floor(aura.stacks ?? 4)));
        this.burdens.set(carrier.id, marker);
      }
      marker.seen = true;
      marker.elapsed += dt;
      const t = burdenProgress(aura);
      const gx = carrier.pos.x;
      const gz = carrier.pos.z;
      const gy = this.groundHeightAt(gx, gz);
      marker.lastX = gx;
      marker.lastY = gy;
      marker.lastZ = gz;
      marker.soak.position.set(gx, gy + 0.02, gz);
      const inside = playersInsideBurden({ x: gx, z: gz }, this.players);
      syncIgnivarSoakTelegraph(
        marker.soak,
        true,
        inside,
        Math.max(1, Math.floor(aura.stacks ?? 4)),
        t,
        1,
        dt,
        reducedMotion,
      );
      const plan = burdenVortexPlan(t);
      const head = Math.max(gy, carrier.pos.y) + plan.height;
      marker.vortex.position.set(gx, head, gz);
      marker.vortex.scale.setScalar(plan.radius / 1.7);
      const time = reducedMotion ? 0 : marker.elapsed;
      for (let i = 0; i < marker.arcs.length; i++) {
        marker.arcs[i].rotation.z = i * 2.1 + time * plan.spin * (i % 2 === 0 ? 1 : -1.3);
      }
      marker.funnel.rotation.y = time * plan.spin * 0.8;
      const n = marker.shards.length;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + time * plan.spin * 0.9;
        const r = 1.9 + (i % 3) * 0.35;
        const s = marker.shards[i];
        s.position.set(
          Math.sin(a) * r,
          -0.8 + (i % 4) * 0.5 + 0.25 * Math.sin(time * 3 + i),
          Math.cos(a) * r,
        );
        s.rotation.set(time * 2.3 + i, time * 1.7 + i * 0.5, time * 1.1);
      }
    }
    for (const [id, marker] of this.burdens) {
      if (marker.seen) continue;
      this.disposeBurden(marker);
      this.burdens.delete(id);
    }
  }

  private disposeBurden(marker: BurdenMarker): void {
    this.scene.remove(marker.root);
    for (const mat of marker.mats) mat.dispose();
    for (const geo of marker.geos) geo.dispose();
    marker.soak.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material;
      for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
    });
  }

  // ---- shared pieces ------------------------------------------------------------------

  private shatter(
    x: number,
    z: number,
    count: number,
    size: number,
    reach: number,
    kind: 'chunk' | 'shard',
  ): void {
    if (this.shatters.length >= MAX_SHATTERS) this.retireShatter(0);
    // Debris is cosmetic: the low presets keep the rock visibly breaking, with fewer pieces.
    const pieces = Math.max(1, Math.round(count * (0.35 + 0.65 * this.quality)));
    const m = balgathRangedMaterials();
    const group = new THREE.Group();
    group.name = 'balgath-shatter';
    const floor = this.groundHeightAt(x, z);
    const chunks: Chunk[] = [];
    for (let i = 0; i < pieces; i++) {
      const geo = kind === 'chunk' ? balgathChunkGeometry(i) : balgathShardGeometry(i);
      const mesh = new THREE.Mesh(geo, m.rock);
      const a = (i / pieces) * Math.PI * 2 + 0.37 * i;
      const out = (reach / BALGATH_SHATTER_SECONDS) * (0.45 + 0.1 * (i % 3));
      const scale = size * (kind === 'chunk' ? 1.6 : 1.8) * (0.8 + 0.15 * (i % 3));
      mesh.position.set(x, floor + (kind === 'chunk' ? 1.2 : 3.2), z);
      mesh.scale.setScalar(scale);
      group.add(mesh);
      chunks.push({
        mesh,
        vx: Math.sin(a) * out,
        vy: kind === 'chunk' ? 6 + (i % 3) * 1.6 : -2,
        vz: Math.cos(a) * out,
        spin: new THREE.Vector3(3 + i, 2 - i * 0.5, 1.5 + (i % 2)),
        floor: this.groundHeightAt(x + Math.sin(a) * reach * 0.5, z + Math.cos(a) * reach * 0.5),
        scale,
      });
    }
    this.scene.add(group);
    this.shatters.push({ group, chunks, elapsed: 0, life: BALGATH_SHATTER_SECONDS });
  }

  private retireShatter(i: number): void {
    this.scene.remove(this.shatters[i].group);
    this.shatters.splice(i, 1);
  }

  private unitCylinder(): THREE.CylinderGeometry {
    if (!this.cylinder) this.cylinder = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    return this.cylinder;
  }

  private chevronGeo(): THREE.BufferGeometry {
    if (!this.chevron) this.chevron = chevronGeometry();
    return this.chevron;
  }

  /** His eye, from the live body when there is one, else a point over the line's origin. */
  private eyeOf(sourceId: number, ox: number, oz: number): Vec3Like {
    const body = this.bosses.get(sourceId);
    const scale = body?.scale ?? 4.2;
    const x = body?.pos.x ?? ox;
    const z = body?.pos.z ?? oz;
    const facing = body?.facing ?? 0;
    return {
      x: x + Math.sin(facing) * 0.35 * scale,
      y: this.groundHeightAt(x, z) + 2.85 * scale,
      z: z + Math.cos(facing) * 0.35 * scale,
    };
  }

  private retire<T extends Owned>(list: T[], i: number): void {
    const item = list[i];
    this.scene.remove(item.group);
    for (const mat of item.mats) mat.dispose();
    for (const geo of item.geos) geo.dispose();
    list.splice(i, 1);
  }

  // ---- the frame ----------------------------------------------------------------------

  update(dt: number, reducedMotion: boolean): void {
    this.clock += dt;
    this.updateBoulders(dt, reducedMotion);
    this.updateGlares(dt, reducedMotion);
    this.updateCleaves(dt, reducedMotion);
    this.updateWaves(dt);
    this.updateShatters(dt);
    this.syncBurdens(dt, reducedMotion);
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i];
      f.elapsed += dt;
      if (f.elapsed >= f.life) {
        this.retire(this.fades, i);
        continue;
      }
      const k = 1 - f.elapsed / f.life;
      for (let j = 0; j < f.mat.length; j++) f.mat[j].opacity = f.peak[j] * k * k;
    }
  }

  /** Reveal the fill up to `fraction`, with its bright leading band on the frontier. */
  private revealFill(mesh: THREE.Mesh, fraction: number): void {
    const bands = Number(mesh.userData.bands ?? 1);
    const segs = Number(mesh.userData.segs ?? 1);
    const shown = Math.max(1, Math.round(bands * Math.min(1, fraction)));
    mesh.geometry.setDrawRange(0, shown * segs * 6);
    const lead = mesh.userData.lead as THREE.Mesh | undefined;
    lead?.geometry.setDrawRange((shown - 1) * segs * 6, segs * 6);
  }

  private updateBoulders(dt: number, reducedMotion: boolean): void {
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      b.elapsed += dt;
      // A small grace past the landing in case the impact event arrives a frame late.
      if (b.elapsed >= b.duration + 0.35) {
        this.retire(this.boulders, i);
        continue;
      }
      const t = Math.min(1, b.elapsed / b.duration);
      this.revealFill(b.fill, telegraphFill(t));
      b.rim.opacity = telegraphRimAlpha(t, this.clock, reducedMotion);
      b.fillMat.opacity = 0.2 + 0.2 * t;
      const body = this.bosses.get(b.sourceId);
      if (!b.launch && body) {
        const scale = body.scale ?? 4.2;
        const facing = body.facing ?? 0;
        const sign = b.slot === 0 ? -1 : 1;
        const fx = Math.sin(facing);
        const fz = Math.cos(facing);
        const grip = BALGATH_BOULDER_GRIP;
        const lift = BALGATH_BOULDER_OVERHEAD;
        const gx = body.pos.x + fx * grip.forward * scale + fz * sign * grip.side * scale;
        const gz = body.pos.z + fz * grip.forward * scale - fx * sign * grip.side * scale;
        const hand = { x: gx, y: this.groundHeightAt(gx, gz) + 0.4, z: gz };
        const overhead = {
          x: body.pos.x + fx * lift.forward * scale + fz * sign * lift.side * scale,
          y: this.groundHeightAt(body.pos.x, body.pos.z) + lift.height * scale,
          z: body.pos.z + fz * lift.forward * scale - fx * sign * lift.side * scale,
        };
        if (!b.ripped && b.elapsed >= BALGATH_BOULDER_RIP_SECONDS) {
          b.ripped = true;
          this.hooks.ground(hand.x, hand.z, 2.4, 0.8);
        }
        if (boulderInFlight(b.elapsed, b.duration)) b.launch = overhead;
        const p = boulderPosition(b.elapsed, b.duration, hand, overhead, b.land);
        b.rock.position.set(p.x, p.y, p.z);
        b.rock.visible = true;
      } else if (b.launch) {
        const p = boulderPosition(b.elapsed, b.duration, b.launch, b.launch, b.land);
        b.rock.position.set(p.x, p.y, p.z);
        b.rock.visible = true;
      } else {
        // No body in view (he is out of the entity band): the mark still counts down; the
        // rock simply drops in from above so the landing is never unannounced.
        const k = Math.max(0, (t - 0.6) / 0.4);
        b.rock.visible = k > 0;
        b.rock.position.set(b.land.x, b.land.y + 30 * (1 - k), b.land.z);
      }
      if (!reducedMotion && boulderInFlight(b.elapsed, b.duration)) {
        b.rock.rotation.x += b.spin.x * dt;
        b.rock.rotation.y += b.spin.y * dt;
        b.rock.rotation.z += b.spin.z * dt;
      }
    }
  }

  private updateGlares(dt: number, reducedMotion: boolean): void {
    for (let i = this.glares.length - 1; i >= 0; i--) {
      const g = this.glares[i];
      g.elapsed += dt;
      if (g.elapsed >= g.duration + 0.5) {
        this.retire(this.glares, i);
        continue;
      }
      const t = Math.min(1, g.elapsed / g.duration);
      this.revealFill(g.fill, telegraphFill(t));
      g.edgeMat.opacity = telegraphRimAlpha(t, this.clock, reducedMotion);
      g.fillMat.opacity = 0.3 + 0.25 * t;
      g.chevronMat.opacity = reducedMotion
        ? 0.7
        : 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(this.clock * 8 - t * 6));
      // The aiming ray from his eye brightens as the wind-up runs out.
      const eye = this.eyeOf(g.sourceId, g.end.x, g.end.z);
      if (this.bosses.has(g.sourceId)) {
        placeBetween(g.ray, eye, g.end, 0.12 + 0.12 * t);
        g.rayMat.opacity =
          (0.15 + 0.55 * t) * (reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(this.clock * 30));
        g.ray.visible = true;
      } else g.ray.visible = false;
    }
  }

  private updateCleaves(dt: number, reducedMotion: boolean): void {
    for (let i = this.cleaves.length - 1; i >= 0; i--) {
      const c = this.cleaves[i];
      c.elapsed += dt;
      if (c.elapsed >= c.duration + 0.35) {
        this.retire(this.cleaves, i);
        continue;
      }
      const t = Math.min(1, c.elapsed / c.duration);
      this.revealFill(c.fill, telegraphFill(t));
      c.edgeMat.opacity = telegraphRimAlpha(t, this.clock, reducedMotion);
      c.fillMat.opacity = 0.2 + 0.2 * t;
      c.chevronMat.opacity = 0.65 + 0.35 * t;
      for (let k = 0; k < c.chevrons.length; k++) {
        const ch = c.chevrons[k];
        const stack = Number(ch.userData.stack ?? 0);
        const lift = cleaveChevronLift(t, this.clock + k * 0.13, reducedMotion);
        ch.position.y = c.ground[k] + lift + stack * 0.75;
      }
    }
  }

  private updateWaves(dt: number): void {
    const steps = 9;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.elapsed += dt;
      const due = Math.min(
        steps,
        Math.floor((w.elapsed / BALGATH_CLEAVE_WAVE_SECONDS) * steps) + 1,
      );
      while (w.fired < due) {
        const a =
          w.aim +
          cleaveWaveAngle(
            (w.fired / (steps - 1)) * BALGATH_CLEAVE_WAVE_SECONDS,
            BALGATH_CLEAVE_HALF_ARC,
          );
        const r = w.radius * (0.55 + 0.2 * (w.fired % 2));
        const px = w.x + Math.sin(a) * r;
        const pz = w.z + Math.cos(a) * r;
        this.hooks.ground(px, pz, w.radius * 0.24, 1);
        this.hooks.ring(px, pz, w.radius * 0.28, 0.5);
        this.shatter(px, pz, 3, 0.7, 4, 'chunk');
        w.fired++;
      }
      if (w.fired >= steps) this.waves.splice(i, 1);
    }
  }

  private updateShatters(dt: number): void {
    const g = 16;
    for (let i = this.shatters.length - 1; i >= 0; i--) {
      const s = this.shatters[i];
      s.elapsed += dt;
      if (s.elapsed >= s.life) {
        this.retireShatter(i);
        continue;
      }
      const fade =
        s.elapsed > s.life * 0.65 ? 1 - (s.elapsed - s.life * 0.65) / (s.life * 0.35) : 1;
      for (const c of s.chunks) {
        c.vy -= g * dt;
        c.mesh.position.x += c.vx * dt;
        c.mesh.position.y += c.vy * dt;
        c.mesh.position.z += c.vz * dt;
        if (c.mesh.position.y < c.floor + 0.1) {
          c.mesh.position.y = c.floor + 0.1;
          c.vy = Math.abs(c.vy) * 0.25;
          c.vx *= 0.5;
          c.vz *= 0.5;
        }
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
        c.mesh.scale.setScalar(c.scale * Math.max(0.01, fade));
      }
    }
  }

  /** Live piece counts, for tests and the perf overlay. */
  counts(): {
    boulders: number;
    glares: number;
    cleaves: number;
    burdens: number;
    shatters: number;
  } {
    return {
      boulders: this.boulders.length,
      glares: this.glares.length,
      cleaves: this.cleaves.length,
      burdens: this.burdens.size,
      shatters: this.shatters.length,
    };
  }

  clear(): void {
    for (let i = this.boulders.length - 1; i >= 0; i--) this.retire(this.boulders, i);
    for (let i = this.glares.length - 1; i >= 0; i--) this.retire(this.glares, i);
    for (let i = this.fades.length - 1; i >= 0; i--) this.retire(this.fades, i);
    for (let i = this.cleaves.length - 1; i >= 0; i--) this.retire(this.cleaves, i);
    for (let i = this.shatters.length - 1; i >= 0; i--) this.retireShatter(i);
    this.waves.length = 0;
    for (const marker of this.burdens.values()) this.disposeBurden(marker);
    this.burdens.clear();
  }

  dispose(): void {
    this.clear();
    this.cylinder?.dispose();
    this.cylinder = null;
    this.chevron?.dispose();
    this.chevron = null;
  }
}

/**
 * The fill's leading band: the fill's own buffers drawn in the rim's bright colour
 * over ONLY the outermost revealed band, so the growing fill has a hard, bright frontier
 * that visibly races toward the rim. When it touches the rim, it lands.
 */
export function leadingEdge(
  fill: THREE.Mesh,
  fillGeo: THREE.BufferGeometry,
  mat: THREE.Material,
): THREE.Mesh {
  // Shares the fill's vertex and index buffers; only its draw range differs.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', fillGeo.getAttribute('position'));
  const index = fillGeo.getIndex();
  if (index) geo.setIndex(index);
  geo.boundingSphere = fillGeo.boundingSphere;
  const lead = new THREE.Mesh(geo, mat);
  lead.renderOrder = 3;
  fill.userData.lead = lead;
  return lead;
}

export function withOrder(mesh: THREE.Mesh, order: number): THREE.Mesh {
  mesh.renderOrder = order;
  return mesh;
}

/** Stretch a unit cylinder (Y axis, height 1) between two points at `radius`. */
function placeBetween(mesh: THREE.Mesh, a: Vec3Like, b: Vec3Like, radius: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.max(0.01, Math.hypot(dx, dy, dz));
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(UP, TMP.set(dx / len, dy / len, dz / len));
  mesh.scale.set(radius, len, radius);
}

const UP = new THREE.Vector3(0, 1, 0);
const TMP = new THREE.Vector3();
