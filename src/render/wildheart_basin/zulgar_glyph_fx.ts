// The six sun glyphs of Zulgar's hunt and his Sunstruck window (plan:
// zulgar_hunt_fx_core.ts), on WildheartFx's host (its root, kit and pools).
//
// A glyph is carved and painted gold on the terrace floor (the kit's prop),
// so its two states have to be made by this layer, and from any camera:
//  - DARK    an ash veil lies over the carving: no gold, no light, a cold rim;
//  - LIT     the veil is gone, the disc and its rays blaze, a shaft of
//            sunlight stands 13 yd on it and a halo hangs over it;
//  - being lit   a gold ring fills round its rim as the player stands on it
//            (the glyph object's own kindle clock) and the ash thins;
//  - cold    an ember ring burns down round a spent glyph (its cold clock).
// The veil, the disc, the ring and the shaft are shader states of meshes built
// once here: they draw on every graphics tier. Only the sparks, the smoke and
// the bursts are cosmetic and thin with the host's density.
//
// The Sunstruck window: while Zulgar carries the window's aura a gold ring
// lies under him on the shared telegraph kit, its fill the seconds left (the
// spirit jaguar turning gold is zulgar_avatar_fx.ts).
//
// Rules (src/render/CLAUDE.md): every mesh and material is built in the
// constructor under the host's root before its gated attach; the frame path
// allocates nothing; nothing here is a light.

import * as THREE from 'three';
import {
  WILDHEART_GLYPH_LIT_FX,
  ZULGAR_SUNSTRUCK_EXPOSED,
} from '../../sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import type { TelegraphFan, TelegraphPaint } from '../floor_telegraph';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { radialGlowTexture } from '../textures';
import { BASIN_ACCENTS, type BasinPuffOptions } from './basin_fx_core';
import type { BasinFxHost } from './basin_fx_host';
import {
  clockLeft,
  GLYPH_COLORS,
  GLYPH_SHAFT_HEIGHT,
  GLYPH_VEIL_SCALE,
  type GlyphLook,
  glyphLookInto,
  glyphPhase,
  newGlyphLook,
  SUNSTRUCK_RING_RADIUS,
  sunstruckRing,
} from './zulgar_hunt_fx_core';

const GLYPH_SLOTS = 6;

interface GlyphSlot {
  veil: THREE.Mesh;
  veilMat: THREE.ShaderMaterial;
  disc: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  shaft: THREE.Mesh;
  shaftMat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  objectId: number;
  sparks: number;
  smoke: number;
}

/** A colour as a GLSL vec3 literal. */
function glslVec3(c: readonly [number, number, number]): string {
  return `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;
}

const DISC_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The ash over a dark glyph's gold carving: cold stone, pale cracks, a rim. */
const VEIL_FRAG = /* glsl */ `
uniform float uVeil;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  if (r > 1.0) discard;
  float a = atan(vLocal.z, vLocal.x);
  float edge = 1.0 - smoothstep(0.9, 1.0, r);
  float crack = pow(max(0.0, cos(a * 7.0 + r * 11.0)), 14.0) * smoothstep(0.15, 0.3, r);
  float rim = smoothstep(0.78, 0.81, r) * (1.0 - smoothstep(0.85, 0.88, r));
  vec3 col = vec3(0.04, 0.045, 0.06) + vec3(0.17, 0.21, 0.27) * (crack * 0.45 + rim * 0.7);
  gl_FragColor = vec4(col, edge * uVeil * 0.92);
}
`;
/** The light: the lit disc and its rays, and the ring round the rim that
 *  fills as a glyph is lit (gold) or burns down while it is cold (ember). */
const GLYPH_FRAG = /* glsl */ `
uniform float uLit;
uniform float uArc;
uniform float uEmber;
uniform float uAlpha;
uniform float uTime;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  if (r > 1.0) discard;
  float a = atan(vLocal.z, vLocal.x);
  float rays = pow(max(0.0, cos(a * 8.0 + uTime * 0.3)), 6.0) * smoothstep(0.3, 0.42, r)
    * (1.0 - smoothstep(0.7, 0.92, r));
  float disc = 1.0 - smoothstep(0.2, 0.3, r);
  float band = smoothstep(0.8, 0.84, r) * (1.0 - smoothstep(0.9, 0.95, r));
  float shimmer = 0.75 + 0.25 * sin(uTime * 2.0 + r * 10.0);
  float wash = (1.0 - smoothstep(0.0, 1.0, r)) * 0.3;
  float litA = (disc * 0.8 + rays * 0.75 * shimmer + band * 0.9 + wash) * uLit;
  // The ring: drawn round the rim from the north as far as uArc.
  float turn = fract(atan(vLocal.x, vLocal.z) / 6.2831853 + 1.0);
  float ringBand = smoothstep(0.7, 0.78, r) * (1.0 - smoothstep(0.93, 0.99, r));
  float on = step(0.002, uArc);
  float drawn = (1.0 - smoothstep(uArc - 0.012, uArc, turn)) * on;
  float head = (1.0 - smoothstep(0.0, 0.05, abs(turn - uArc))) * on * step(uArc, 0.998);
  float arcA = ringBand * (drawn * 1.25 + head * 1.6) * (1.0 - uLit);
  // The glyph's own face warms from its heart outward as it is lit.
  float warm = (disc * 0.8 + (1.0 - smoothstep(0.0, 0.75, r)) * 0.35) * uArc
    * (1.0 - uEmber) * (1.0 - uLit);
  vec3 gold = ${glslVec3(GLYPH_COLORS.gold)};
  vec3 ember = ${glslVec3(GLYPH_COLORS.ember)};
  vec3 col = gold * litA + mix(gold, ember, uEmber) * (arcA + warm);
  gl_FragColor = vec4(col * uAlpha, 1.0);
}
`;
/** A lit glyph's shaft of sunlight: brightest at its foot, rays turning. */
const SHAFT_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
varying vec3 vLocal;
void main() {
  float a = atan(vLocal.z, vLocal.x);
  float v = vLocal.y;
  float rays = 0.55 + 0.45 * pow(max(0.0, cos(a * 5.0 + uTime * 0.5 + v * 1.5)), 3.0);
  float fall = (1.0 - smoothstep(0.0, 1.0, v)) * smoothstep(0.0, 0.04, v);
  float motes = 0.8 + 0.2 * sin(v * 24.0 - uTime * 3.0 + a * 3.0);
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.45) * fall * rays * motes * uAlpha, 1.0);
}
`;

const GOLD_HEX = 0xffc860;
const EMBER_HEX = 0xc4401a;

export class ZulgarGlyphFx {
  private readonly glyphs: GlyphSlot[] = [];
  private readonly window: TelegraphFan;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly look: GlyphLook = newGlyphLook();
  private readonly paint: TelegraphPaint = { fill: 0, clock: 0, range: 1, fade: 1 };
  private readonly spark: BasinPuffOptions = {
    speed: 0.3,
    up: 2.2,
    life: 1.6,
    size: [0.3, 0.08],
    color: GLYPH_COLORS.gold,
    alpha: 0.9,
    glow: true,
    radius: 1,
  };
  private readonly ash: BasinPuffOptions = {
    speed: 0.25,
    up: 1.1,
    life: 1.8,
    size: [0.5, 1.4],
    color: [0.3, 0.26, 0.24],
    alpha: 0.4,
    radius: 1,
    drag: 1.6,
  };
  private zulgarId = -1;
  private windowShown = false;
  private clock = 0;

  constructor(
    private readonly host: BasinFxHost,
    private readonly world: IWorld,
  ) {
    const { root, kit } = host;
    const discGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    const shaftGeo = new THREE.CylinderGeometry(0.7, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    this.geometries.push(discGeo, shaftGeo);
    const glowTex = radialGlowTexture();
    // Minted per call (not a shared cache): this fx owns and disposes it.
    this.textures.push(glowTex);
    for (let i = 0; i < GLYPH_SLOTS; i++) {
      const veilMat = new THREE.ShaderMaterial({
        name: 'wildheartSunGlyphVeil',
        uniforms: { uVeil: { value: 1 } },
        vertexShader: DISC_VERT,
        fragmentShader: VEIL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const veil = new THREE.Mesh(discGeo, veilMat);
      veil.name = 'wildheart-glyph-veil';
      veil.frustumCulled = false;
      veil.visible = false;
      veil.renderOrder = floorVfxRenderOrder('encounter', 1);
      const mat = new THREE.ShaderMaterial({
        name: 'wildheartSunGlyph',
        uniforms: {
          uLit: { value: 0 },
          uArc: { value: 0 },
          uEmber: { value: 0 },
          uAlpha: { value: 1 },
          uTime: host.uTime,
        },
        vertexShader: DISC_VERT,
        fragmentShader: GLYPH_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const disc = new THREE.Mesh(discGeo, mat);
      disc.name = 'wildheart-glyph-light';
      disc.frustumCulled = false;
      disc.visible = false;
      disc.renderOrder = floorVfxRenderOrder('encounter', 3);
      const shaftMat = new THREE.ShaderMaterial({
        name: 'wildheartSunShaft',
        uniforms: { uAlpha: { value: 0 }, uTime: host.uTime },
        vertexShader: DISC_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.name = 'wildheart-glyph-shaft';
      shaft.frustumCulled = false;
      shaft.visible = false;
      const haloMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: GOLD_HEX,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name: 'wildheartGlyphHalo',
      });
      const halo = new THREE.Sprite(haloMat);
      halo.visible = false;
      this.materials.push(veilMat, mat, shaftMat, haloMat);
      root.add(veil, disc, shaft, halo);
      this.glyphs.push({
        veil,
        veilMat,
        disc,
        mat,
        shaft,
        shaftMat,
        halo,
        haloMat,
        objectId: -1,
        sparks: 0,
        smoke: 0,
      });
    }
    // The Sunstruck window's ring under Zulgar (the shared kit: every tier).
    this.window = kit.fan(14);
    this.window.group.name = 'wildheart-sunstruck-ring';
    kit.layOutFan(this.window, 360, {
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: BASIN_ACCENTS.holy,
    });
  }

  // ------------------------------------------------------------------- scan

  /** The scan saw Zulgar (or, with null, lost him). */
  setZulgar(e: Entity | null): void {
    this.zulgarId = e ? e.id : -1;
  }

  /** Claim a slot for a sun glyph object. */
  scanObject(e: Entity): void {
    if (glyphPhase(e.templateId, e.castingAbility) === null) return;
    for (const g of this.glyphs) if (g.objectId === e.id) return;
    const g = this.glyphs.find((s) => s.objectId < 0);
    if (!g) return;
    g.objectId = e.id;
    g.sparks = 0;
    g.smoke = 0;
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    this.paintGlyphs(dt);
    this.paintWindow();
  }

  private release(g: GlyphSlot): void {
    g.objectId = -1;
    g.veil.visible = false;
    g.disc.visible = false;
    g.shaft.visible = false;
    g.halo.visible = false;
  }

  private paintGlyphs(dt: number): void {
    const host = this.host;
    for (const g of this.glyphs) {
      if (g.objectId < 0) continue;
      const obj = this.world.entities.get(g.objectId);
      const phase = obj ? glyphPhase(obj.templateId, obj.castingAbility) : null;
      if (!obj || phase === null) {
        this.release(g);
        continue;
      }
      const look = glyphLookInto(
        this.look,
        phase,
        clockLeft(obj.castRemaining, obj.castTotal),
        this.clock + g.objectId * 0.61,
      );
      const r = obj.scale || 1;
      const { x, z } = obj.pos;
      const gy = host.groundY(x, z);
      g.veil.visible = look.veil > 0.01;
      if (g.veil.visible) {
        g.veil.position.set(x, gy + 0.09, z);
        g.veil.scale.setScalar(r * GLYPH_VEIL_SCALE);
        g.veilMat.uniforms.uVeil.value = look.veil;
      }
      g.disc.visible = true;
      g.disc.position.set(x, gy + 0.11, z);
      g.disc.scale.setScalar(r);
      g.mat.uniforms.uLit.value = look.lit;
      g.mat.uniforms.uArc.value = look.arc;
      g.mat.uniforms.uEmber.value = look.arcEmber;
      g.halo.visible = look.halo > 0.01;
      if (g.halo.visible) {
        g.halo.position.set(x, gy + 0.9, z);
        g.halo.scale.set(r * 2.8, r * 1.4, 1);
        g.haloMat.color.setHex(look.haloEmber > 0.5 ? EMBER_HEX : GOLD_HEX);
        g.haloMat.opacity = look.halo;
      }
      // A lit glyph stands in a shaft of sunlight; one being lit grows it.
      g.shaft.visible = look.shaft > 0.01;
      if (g.shaft.visible) {
        g.shaft.position.set(x, gy + 0.05, z);
        g.shaft.scale.set(r * 0.9, GLYPH_SHAFT_HEIGHT * look.shaftRise, r * 0.9);
        g.shaftMat.uniforms.uAlpha.value = look.shaft;
      }
      // Cosmetic: gold sparks off the light, grey smoke off a spent glyph.
      g.sparks += dt * look.sparks * host.density;
      this.spark.radius = r * 0.8;
      while (g.sparks >= 1) {
        g.sparks -= 1;
        host.puff(x, gy + 0.2, z, 1, this.spark);
      }
      g.smoke += dt * look.smoke * host.density;
      this.ash.radius = r * 0.7;
      while (g.smoke >= 1) {
        g.smoke -= 1;
        host.puff(x, gy + 0.3, z, 1, this.ash);
      }
    }
  }

  private paintWindow(): void {
    const z = this.zulgarId >= 0 ? this.world.entities.get(this.zulgarId) : undefined;
    let remaining = 0;
    let duration = 0;
    if (z && !z.dead && z.auras) {
      for (let i = 0; i < z.auras.length; i++) {
        const a = z.auras[i];
        if (a.id !== ZULGAR_SUNSTRUCK_EXPOSED) continue;
        remaining = a.remaining;
        duration = a.duration;
      }
    }
    if (!z || !(remaining > 0)) {
      if (this.windowShown) {
        this.windowShown = false;
        this.window.group.visible = false;
      }
      return;
    }
    const host = this.host;
    const { x, z: zz } = z.pos;
    const ring = sunstruckRing(remaining, duration, this.clock);
    host.kit.drapeFan(
      this.window,
      host.groundY,
      x,
      host.groundY(x, zz),
      zz,
      0,
      SUNSTRUCK_RING_RADIUS,
    );
    this.paint.fill = ring.fill;
    this.paint.clock = this.clock;
    this.paint.range = SUNSTRUCK_RING_RADIUS;
    this.paint.fade = ring.fade;
    host.kit.paintFan(this.window, this.paint);
    this.windowShown = true;
    this.window.group.visible = true;
  }

  // ------------------------------------------------------------------- events

  /** A glyph catching light: a gold ring racing off it and a burst of sparks. */
  handleEvent(ev: Extract<SimEvent, { type: 'spellfx' }>): boolean {
    if (ev.ability !== WILDHEART_GLYPH_LIT_FX) return false;
    const obj = this.world.entities.get(ev.targetId);
    if (!obj) return true;
    const host = this.host;
    const { x, z } = obj.pos;
    const r = obj.scale || 1;
    host.shockRing(x, z, GOLD_HEX, r * 2.4, 0.55);
    host.puff(x, host.groundY(x, z) + 0.3, z, 26, {
      speed: 3.2,
      up: 4.5,
      life: 1.1,
      size: [0.42, 0.1],
      color: GLYPH_COLORS.gold,
      alpha: 1,
      glow: true,
      radius: r * 0.9,
      gravity: 3,
    });
    return true;
  }

  // ------------------------------------------------------------------- lifetime

  /** Out of the basin (a wipe, a leave): put every glyph and the ring away. */
  hideAll(): void {
    for (const g of this.glyphs) this.release(g);
    this.window.group.visible = false;
    this.windowShown = false;
    this.zulgarId = -1;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
