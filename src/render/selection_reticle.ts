// The target selection reticle: the ring drawn at the current target's feet.
// Extracted from renderer.ts (which now only feeds it the target each frame).
//
// The classic reticle is a base ring plus four inward-pointing ticks. The base
// ring is draped over the terrain (drapeRingLocalY, selection_ring.ts) so it
// stays legible on slopes instead of sinking into the uphill ground; the ticks
// keep the classic spin on a separate pivot. The ring is radially symmetric, so
// only the ticks read spin.
//
// The heavier hostile variant (the Heavier Hostile Reticle option,
// target_highlight_core.ts) swaps the thin band for a wider one and adds a
// faint tinted disc inside it and a dashed ring outside it, every piece draped
// the same way. It applies to hostile targets only; a friendly target keeps
// the classic gold ring.

import * as THREE from 'three';
import { supportHeightAt } from '../sim/colliders';
import { groundHeight } from '../sim/world';
import { compileTargetPrepared } from './compile_target_readiness';
import { rendererContextGeneration } from './context_generation';
import { setRenderCategory } from './renderer_diagnostics';
import { drapeRingLocalY, type HeightSampler } from './selection_ring';
import type { TexturePropertiesLike } from './texture_prep_core';

const SELECTION_RING_SPIN = 0.6; // rad/s, slow classic target-reticle rotation
const HOSTILE_COLOR = 0xcc2222;
const FRIENDLY_COLOR = 0xd4af37;
// Heavy variant geometry, in unit-scale yards (the group scales by creature size).
const HEAVY_BAND_INNER = 0.78;
const HEAVY_BAND_OUTER = 1.28;
const HEAVY_DASH_INNER = 1.82;
const HEAVY_DASH_OUTER = 1.94;
const HEAVY_DASH_COUNT = 20;
const HEAVY_DASH_FILL = 0.6; // fraction of each dash slot that is drawn
const HEAVY_TICK_SCALE = 1.45; // ticks bridge the wide band and reach past it
const DRAPE_LIFT = 0.08;

/** The terrain the reticle sits on, supplied by the renderer. */
export interface SelectionReticleGround {
  /** Terrain height at a point (the reticle's centre footing). */
  terrain(x: number, z: number): number;
  /** Height of a prop top (crate/rock) a unit at `unitY` stands on, so the ring
   *  lands on that surface rather than buried at terrain height under it. */
  support(x: number, z: number, unitY: number): number;
  /** Per-vertex ground sampler the drape follows. */
  sample: HeightSampler;
}

/** One mesh whose vertices ride the terrain. */
interface DrapedPart {
  mesh: THREE.Mesh;
  localXZ: Float32Array;
  drapeY: Float32Array;
}

function drapedPart(geo: THREE.BufferGeometry, mat: THREE.Material): DrapedPart {
  const mesh = new THREE.Mesh(geo, mat);
  // the draped ring deforms every frame; skip frustum culling so the (now
  // out-of-date) bounding sphere can't cull it on steep slopes.
  mesh.frustumCulled = false;
  // cache the center-relative XZ so sync() can re-drape it cheaply.
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const localXZ = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    localXZ[i * 2] = pos.getX(i);
    localXZ[i * 2 + 1] = pos.getZ(i);
  }
  return { mesh, localXZ, drapeY: new Float32Array(pos.count) };
}

function flatRing(inner: number, outer: number, theta: number, phi = 1): THREE.BufferGeometry {
  const geo = new THREE.RingGeometry(inner, outer, theta, phi);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** A dashed annulus lying flat in XZ: `count` arcs, each `fill` of its slot. */
function dashedRing(
  inner: number,
  outer: number,
  count: number,
  fill: number,
): THREE.BufferGeometry {
  const segs = 3;
  const positions: number[] = [];
  const indices: number[] = [];
  const slot = (Math.PI * 2) / count;
  for (let d = 0; d < count; d++) {
    const base = positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const a = d * slot + (slot * fill * s) / segs;
      const c = Math.cos(a);
      const n = Math.sin(a);
      positions.push(inner * c, 0, inner * n, outer * c, 0, outer * n);
    }
    for (let s = 0; s < segs; s++) {
      const i = base + s * 2;
      indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

export class SelectionReticle {
  readonly group = new THREE.Group();
  private readonly heavyGroup = new THREE.Group();
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly dashMat: THREE.MeshBasicMaterial;
  private readonly base: DrapedPart;
  private readonly band: DrapedPart;
  private readonly disc: DrapedPart;
  private readonly dashes: DrapedPart;
  private readonly ticks = new THREE.Group();
  // last drape anchor: the drape is a pure function of (x, z, scale, heavy), so
  // a stationary target skips the per-vertex ground resample entirely.
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastScale = Number.NaN;
  private lastHeavy = false;
  private supportY = 0;
  private readonly sampleOnSupport: HeightSampler;
  private disposed = false;
  private preparationAttempt = 0;
  private attemptedGeneration = -1;
  private readyGeneration = -1;
  private preparing = false;

  constructor(
    scene: THREE.Scene,
    private readonly ground: SelectionReticleGround,
    private readonly prepare: (root: THREE.Object3D) => Promise<boolean>,
    private readonly generation: () => number,
  ) {
    this.sampleOnSupport = (x, z) => Math.max(ground.sample(x, z), this.supportY);
    const translucent = (name: string, opacity: number) =>
      new THREE.MeshBasicMaterial({
        name,
        color: FRIENDLY_COLOR,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    this.ringMat = new THREE.MeshBasicMaterial({
      name: 'selection-reticle:ring',
      color: FRIENDLY_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.discMat = translucent('selection-reticle:disc', 0.2);
    this.dashMat = translucent('selection-reticle:dashes', 0.6);
    this.base = drapedPart(flatRing(0.9, 1.15, 48), this.ringMat);
    this.band = drapedPart(flatRing(HEAVY_BAND_INNER, HEAVY_BAND_OUTER, 48), this.ringMat);
    this.disc = drapedPart(flatRing(0.04, HEAVY_BAND_INNER, 32, 3), this.discMat);
    this.dashes = drapedPart(
      dashedRing(HEAVY_DASH_INNER, HEAVY_DASH_OUTER, HEAVY_DASH_COUNT, HEAVY_DASH_FILL),
      this.dashMat,
    );
    this.group.add(this.base.mesh, this.heavyGroup);
    this.heavyGroup.name = 'selection-reticle-heavy';
    this.heavyGroup.add(this.band.mesh, this.disc.mesh, this.dashes.mesh);
    this.heavyGroup.visible = false;
    // four cardinal ticks on a spinning pivot, sharing the ring material so the
    // per-frame hostile/friendly recolour carries over for free.
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0.72,
          0,
          0, // inner tip (points toward the unit)
          1.2,
          0,
          0.16, // outer corners
          1.2,
          0,
          -0.16,
        ],
        3,
      ),
    );
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tickGeo, this.ringMat);
      t.rotation.y = (i * Math.PI) / 2;
      this.ticks.add(t);
    }
    this.group.add(this.ticks);
    setRenderCategory(this.group, 'ui3d');
    this.group.visible = false;
    scene.add(this.group);
  }

  hide(): void {
    if (this.disposed) return;
    this.group.visible = false;
  }

  /** Only optional heavy pieces wait for their own exact programs. A failed or
   * timed-out gate leaves the classic actionable ring available. */
  private heavyReady(): boolean {
    const generation = this.generation();
    if (this.readyGeneration === generation) return true;
    if (this.attemptedGeneration !== generation) {
      this.attemptedGeneration = generation;
      const attempt = ++this.preparationAttempt;
      this.preparing = true;
      void Promise.resolve()
        .then(() =>
          this.disposed || attempt !== this.preparationAttempt
            ? false
            : this.prepare(this.heavyGroup),
        )
        .then(
          (ready) => {
            if (this.disposed || attempt !== this.preparationAttempt) return;
            this.preparing = false;
            if (ready && generation === this.generation()) this.readyGeneration = generation;
          },
          () => {
            // The existing compile lane owns diagnostics. Never reveal on failure.
            if (attempt === this.preparationAttempt) this.preparing = false;
          },
        );
    }
    return false;
  }

  /** Renderer-owned resources, never a module cache or borrowed material. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.preparationAttempt++;
    this.group.visible = false;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    });
    const errors: unknown[] = [];
    const bestEffort = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    };
    // Collect ownership before dispatching removal events: a listener can throw
    // or mutate the group, but every owned resource still needs one attempt.
    bestEffort(() => this.group.removeFromParent());
    for (const resource of [...geometries, ...materials]) {
      bestEffort(() => resource.dispose());
    }
    // Clear each child independently; one throwing childremoved listener must
    // not strand the remaining siblings in this terminal owner.
    for (const child of [...this.group.children]) bestEffort(() => this.group.remove(child));
    if (errors.length) throw new AggregateError(errors, 'Selection reticle disposal failed');
  }

  /**
   * Show the reticle under a unit centred at (cx, cz) whose rig stands at
   * `unitY`. `heavy` is the Heavier Hostile Reticle option; it only takes
   * effect for a hostile target. `boost` brightens the colour for the bloom
   * edge (1 on low graphics).
   */
  sync(
    cx: number,
    cz: number,
    unitY: number,
    scale: number,
    hostile: boolean,
    heavyOption: boolean,
    dt: number,
    time: number,
    boost: number,
  ): void {
    if (this.disposed) return;
    if (!heavyOption && !this.preparing) this.attemptedGeneration = -1;
    const heavy = heavyOption && hostile && this.heavyReady();
    this.base.mesh.visible = !heavy;
    this.heavyGroup.visible = heavy;
    this.ticks.scale.setScalar(heavy ? HEAVY_TICK_SCALE : 1);
    // anchor the reticle to the ground under the unit (a classic decal: it
    // stays grounded even if the target jumps) and drape it over the slope.
    if (
      cx !== this.lastX ||
      cz !== this.lastZ ||
      scale !== this.lastScale ||
      heavy !== this.lastHeavy
    ) {
      this.lastX = cx;
      this.lastZ = cz;
      this.lastScale = scale;
      this.lastHeavy = heavy;
      const supportY = this.ground.support(cx, cz, unitY);
      const gy = Math.max(this.ground.terrain(cx, cz), supportY);
      this.supportY = supportY;
      this.group.position.set(cx, gy, cz);
      this.group.scale.setScalar(scale);
      // Only the visible pieces are draped; a heavy flip re-enters here.
      if (heavy) {
        this.drape(this.band, cx, cz, gy, scale);
        this.drape(this.disc, cx, cz, gy, scale);
        this.drape(this.dashes, cx, cz, gy, scale);
      } else {
        this.drape(this.base, cx, cz, gy, scale);
      }
      this.ticks.position.y = DRAPE_LIFT; // ticks float just above the footing
    }
    this.ticks.rotation.y += dt * SELECTION_RING_SPIN; // slow reticle spin
    const mat = this.ringMat;
    mat.color.setHex(hostile ? HOSTILE_COLOR : FRIENDLY_COLOR);
    mat.color.multiplyScalar(boost); // subtle bloom edge
    const pulse = Math.sin(time * 4.5);
    mat.opacity = 0.78 + 0.2 * pulse; // gentle pulse
    if (heavy) {
      this.discMat.color.copy(mat.color);
      this.discMat.opacity = 0.17 + 0.06 * pulse;
      this.dashMat.color.copy(mat.color);
    }
    this.group.visible = true;
  }

  private drape(part: DrapedPart, cx: number, cz: number, gy: number, scale: number): void {
    const y = drapeRingLocalY(
      part.localXZ,
      cx,
      cz,
      gy,
      scale,
      DRAPE_LIFT,
      this.sampleOnSupport,
      part.drapeY,
    );
    const pos = part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < y.length; i++) pos.setY(i, y[i]);
    pos.needsUpdate = true;
  }
}

/** Renderer glue: ground sampling and exact reveal proof stay with the owned
 * producer; linking, variant settlement and touch still ride the shared lane. */
export function createSelectionReticle(
  scene: THREE.Scene,
  seed: number,
  sample: HeightSampler,
  compile: (root: THREE.Object3D) => Promise<unknown>,
  webgl: { readonly properties: TexturePropertiesLike },
): SelectionReticle {
  return new SelectionReticle(
    scene,
    {
      terrain: (x, z) => groundHeight(x, z, seed),
      support: (x, z, unitY) => supportHeightAt(seed, x, z, 0.5, unitY + 0.01),
      sample,
    },
    async (root) => {
      await compile(root);
      return compileTargetPrepared(webgl.properties, root);
    },
    () => rendererContextGeneration(webgl),
  );
}
