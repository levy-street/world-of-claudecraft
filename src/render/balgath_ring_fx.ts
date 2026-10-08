// Balgath's circle telegraphs, drawn as he means them: the Barrow Smash with its safe gap,
// and his stomp, hammer and Barrowfall as solid circles.
//
// These four used to ride the generic rune circle (mage_ground_fx.ts spawnRune): an outer
// ring, an inner ring at about half the radius and open ground between. On his smash that
// open ring read as a place to stand, and it was not (owner playtest). The smash now HAS
// that refuge (sim/boss_ring_gap.ts), and this draws it from the very fractions the sim's
// hit test reads, so the gap on the ground is the gap in the blast. His other circles hit
// in full, so they are drawn solid: no telegraph of his shows a gap it does not honour.
//
// Every piece is a draped ground mesh on the shared Balgath ranged materials (clones of
// the same two programs the boot stand-in already links, balgath_ranged_fx.ts), on the
// encounter band of the floor ladder.
import * as THREE from 'three';
import { type RingGap, ringGapBands } from '../sim/boss_ring_gap';
import { balgathRangedMaterials, drapedSector, type GroundAt, LIFT } from './balgath_ranged_fx';
import { telegraphFill, telegraphRimAlpha } from './balgath_ranged_fx_core';
import { floorVfxRenderOrder } from './floor_vfx_layer_core';

/** The slam palette: dark earth under an amber fill, a bright rim on every edge. */
const RING_BASE = 0x241a0e;
const RING_FILL = 0xe0a23a;
const RING_RIM = 0xffe08a;
/** The width of a drawn edge line, yards. */
const RIM_WIDTH = 0.4;

interface RingMark {
  group: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  fill: THREE.MeshBasicMaterial;
  rim: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  elapsed: number;
  duration: number;
}

export class BalgathRingFx {
  private rings: RingMark[] = [];
  private clock = 0;

  constructor(
    private scene: THREE.Scene,
    private groundHeightAt: GroundAt,
  ) {}

  /**
   * A circle telegraph of `radius` for `duration` seconds. With a `gap` the disc and the
   * outer band are drawn and the ring between them is left open ground, edged on both sides.
   */
  telegraph(x: number, z: number, radius: number, duration: number, gap: RingGap | null): void {
    const m = balgathRangedMaterials();
    const ground = this.groundHeightAt;
    const { disc, bandIn, bandOut } = ringGapBands(radius, gap);
    const baseMat = m.groundBase.clone();
    baseMat.color.setHex(RING_BASE);
    baseMat.opacity = 0.42;
    const fillMat = m.groundGlow.clone();
    fillMat.color.setHex(RING_FILL);
    fillMat.opacity = 0.2;
    const rimMat = m.groundGlow.clone();
    rimMat.color.setHex(RING_RIM);
    const geos: THREE.BufferGeometry[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, step: number) => {
      geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = floorVfxRenderOrder('encounter', step);
      group.add(mesh);
    };
    const group = new THREE.Group();
    group.name = gap ? 'balgath-smash-gap-ring' : 'balgath-slam-ring';
    const segs = Math.max(32, Math.round(radius * 6));
    // The solid disc round the centre (the whole circle with no gap).
    add(drapedSector(ground, x, z, 0, disc, 0, Math.PI, 1, segs, LIFT - 0.02), baseMat, 1);
    add(drapedSector(ground, x, z, 0, disc, 0, Math.PI, 4, segs), fillMat, 2);
    // The outer rim, always.
    add(
      drapedSector(ground, x, z, bandOut - RIM_WIDTH, bandOut, 0, Math.PI, 1, segs, LIFT + 0.02),
      rimMat,
      3,
    );
    if (gap) {
      // The band out at the rim, and both edges of the gap so it reads as a deliberate
      // ring of open ground rather than a fill that failed to draw.
      add(
        drapedSector(ground, x, z, bandIn, bandOut, 0, Math.PI, 1, segs, LIFT - 0.02),
        baseMat,
        1,
      );
      add(drapedSector(ground, x, z, bandIn, bandOut, 0, Math.PI, 2, segs), fillMat, 2);
      add(
        drapedSector(ground, x, z, disc - RIM_WIDTH, disc, 0, Math.PI, 1, segs, LIFT + 0.02),
        rimMat,
        3,
      );
      add(
        drapedSector(ground, x, z, bandIn, bandIn + RIM_WIDTH, 0, Math.PI, 1, segs, LIFT + 0.02),
        rimMat,
        3,
      );
    }
    this.scene.add(group);
    this.rings.push({
      group,
      mats: [baseMat, fillMat, rimMat],
      geos,
      fill: fillMat,
      rim: rimMat,
      x,
      z,
      elapsed: 0,
      duration: Math.max(0.3, duration),
    });
  }

  /** The blast landed at (x, z): its telegraph goes at once. */
  landed(x: number, z: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (Math.hypot(r.x - x, r.z - z) < 1.5) this.retire(i);
    }
  }

  update(dt: number, reducedMotion: boolean): void {
    this.clock += dt;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.elapsed += dt;
      // A grace past the windup in case the landing event arrives a frame late.
      if (r.elapsed >= r.duration + 0.35) {
        this.retire(i);
        continue;
      }
      const t = Math.min(1, r.elapsed / r.duration);
      r.fill.opacity = 0.12 + 0.4 * telegraphFill(t);
      r.rim.opacity = telegraphRimAlpha(t, this.clock, reducedMotion);
    }
  }

  /** Live ring count, for tests and the perf overlay. */
  count(): number {
    return this.rings.length;
  }

  clear(): void {
    for (let i = this.rings.length - 1; i >= 0; i--) this.retire(i);
  }

  dispose(): void {
    this.clear();
  }

  private retire(i: number): void {
    const r = this.rings[i];
    this.scene.remove(r.group);
    for (const mat of r.mats) mat.dispose();
    for (const geo of r.geos) geo.dispose();
    this.rings.splice(i, 1);
  }
}
