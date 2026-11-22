import * as THREE from 'three';
import type { CrestPrewarmHost } from './crest_prewarm';
import { GuardianCovenant } from './guardian_covenant';
import { KIT_FLARE_GLSL, KIT_IVORY, KIT_WARM, type PaladinKitContext } from './paladin_kit_context';
import { PaladinQuadPool, ramp } from './paladin_quad_pool';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';

export const COVENANT_BONDS = 6;
/** The bond reaches the ally after this long, then lets go. */
export const COVENANT_REACH = 0.28;
export const COVENANT_BOND_DURATION = 0.9;
const SEGMENTS = 10;
const IVORY_SOFT = new THREE.Color(0xfff6dc).multiplyScalar(1.25);
const SHAPE = { strand: 0, sigil: 1, flare: 2 } as const;
const QUADS = COVENANT_BONDS * (SEGMENTS * 2 + 2);

interface Bond {
  active: boolean;
  source: number;
  target: number;
  age: number;
}

/**
 * Life Covenant. A bond of two strands of light twists from the Paladin to the
 * ally, and a ward sigil with the Sunmender's sign flares over them as the
 * covenant takes. While the covenant holds, the ally
 * bears Guardian Covenant's shield of light with the Sunmender's sign at its
 * heart (guardian_covenant.ts).
 */
export class LifeCovenant {
  private readonly pool: PaladinQuadPool<'life_covenant'>;
  private readonly bonds: Bond[] = Array.from({ length: COVENANT_BONDS }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
  }));
  /** The shield held while the covenant lasts. */
  readonly ward: GuardianCovenant;
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'life_covenant', QUADS, {
      uniforms: paladinSpecIconUniforms(),
      helpers: KIT_FLARE_GLSL + PALADIN_SPEC_ICON_GLSL,
      pull: 'aShape>0.5?0.6:0.0',
      body: `
        if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // The ward sigil: the Sunmender's sign inside a bright ring.
          float grow=1.0-sq(max(1.0-clamp(t/0.25,0.0,1.0),0.0));
          float ring=band(r,0.82,0.03)*1.1+band(r,0.74,0.012)*0.6;
          float line=0.0;
          if(uSpecIconsReady>0.5){
            vec3 icon=paladinSpecIcon(p/(0.6*grow+0.001),0.0);
            line=1.0-smoothstep(0.0,0.03,icon.y-0.006);
          } else {
            line=band(r,0.4,0.02);
          }
          mask=(ring+line*1.0+exp(-r*r*5.0)*0.2)*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,line*0.5+ring*0.3);
        } else {
          // A strand of the bond.
          float core=exp(-vUv.y*vUv.y*36.0);
          mask=exp(-vUv.y*vUv.y*4.0)*0.35+core;
          color=mix(vColor,HOT,core*0.8);
        }
      `,
    });
    this.ward = new GuardianCovenant(ctx.scene, ctx.anchor, ctx.camera, 'sunmender');
  }

  readonly preparation = {
    units: (host: CrestPrewarmHost) => [
      ...this.pool.preparation.units(host),
      ...this.ward.preparation.units(host),
    ],
  };

  /** The covenant is sworn on `target`. */
  bind(source: number, target: number): boolean {
    if (!this.pool.ready()) return false;
    let slot = this.bonds.find((b) => !b.active);
    if (!slot) {
      slot = this.bonds[0];
      for (const b of this.bonds) if (b.age > slot.age) slot = b;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    return true;
  }

  /** Once a frame while `target` holds the covenant. */
  hold(target: number): void {
    this.ward.hold(target, 0, this.ctx.facing(target) ?? 0);
  }

  /** A point `u` of the way along a bond strand, twisting about its partner. */
  private strandPoint(
    u: number,
    spin: number,
    dx: number,
    dy: number,
    dz: number,
    sx: number,
    sz: number,
    out: THREE.Vector3,
  ): void {
    const swell = Math.sin(u * Math.PI) * 0.22;
    const turn = u * 9 + spin;
    const side = Math.cos(turn) * swell,
      up = Math.sin(turn) * swell + Math.sin(u * Math.PI) * 0.35;
    out.set(
      this.from.x + dx * u + sx * side,
      this.from.y + dy * u + up,
      this.from.z + dz * u + sz * side,
    );
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    bindPaladinSpecIcons(pool.mesh.material);
    pool.begin(this.ctx.camera);
    for (const b of this.bonds) {
      if (!b.active) continue;
      b.age += dt;
      if (
        b.age >= COVENANT_BOND_DURATION ||
        !this.ctx.anchor(b.target, 0.6, this.to) ||
        !this.ctx.anchor(b.source, 0.62, this.from)
      ) {
        b.active = false;
        continue;
      }
      const t = b.age;
      const head = reduced ? 1 : ramp(t / COVENANT_REACH, 0, 1);
      const fade = 1 - ramp(t, COVENANT_REACH + 0.15, COVENANT_BOND_DURATION);
      if (b.source !== b.target) {
        // Two strands twisting about each other from the Paladin to the ally.
        const dx = this.to.x - this.from.x,
          dy = this.to.y - this.from.y,
          dz = this.to.z - this.from.z;
        const len = Math.hypot(dx, dz) || 1;
        const sx = -dz / len,
          sz = dx / len;
        for (const phase of [0, Math.PI]) {
          for (let i = 0; i < SEGMENTS; i++) {
            const u0 = (head * i) / SEGMENTS,
              u1 = (head * (i + 1)) / SEGMENTS;
            const spin = phase + (reduced ? 0 : this.clock * 4);
            this.strandPoint(u0, spin, dx, dy, dz, sx, sz, this.a);
            this.strandPoint(u1, spin, dx, dy, dz, sx, sz, this.b);
            pool.time = 0;
            pool.beam(
              this.a.x,
              this.a.y,
              this.a.z,
              this.b.x,
              this.b.y,
              this.b.z,
              0.045,
              IVORY_SOFT,
              fade,
              SHAPE.strand,
            );
          }
        }
      }
      if (t >= COVENANT_REACH * 0.8) {
        const since = t - COVENANT_REACH * 0.8;
        pool.time = since;
        pool.billboard(
          this.to.x,
          this.to.y + 0.1,
          this.to.z,
          0.7,
          KIT_WARM,
          (1 - ramp(since, 0.3, 0.6)) * 1.2,
          SHAPE.sigil,
        );
        pool.billboard(
          this.to.x,
          this.to.y,
          this.to.z,
          1.1,
          KIT_IVORY,
          Math.exp(-since * 8) * 1.2,
          SHAPE.flare,
        );
      }
    }
    pool.end();
    this.ward.update(dt, reduced);
  }

  clear(): void {
    for (const b of this.bonds) b.active = false;
    this.pool.clear();
    this.ward.clear();
  }

  dispose(): void {
    this.pool.dispose();
    this.ward.dispose();
  }
}
