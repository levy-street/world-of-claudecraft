// The Gale Cocoon and Skyrend Nova (encounters/smith_heart/breath_isles.ts,
// the 50 percent phase), a part of BreathIslesFx (looks:
// breath_isle_phase_core.ts and, for the cocoon's vortex, breath_isles_fx_core.ts):
//
//  - the cocoon round the guardian while it wears ISLE_AURAS.cocoon: three
//    bands of wind wheeling each its own way, a faint cracked shell, a ring
//    of wind runes at its foot and stones orbiting in the gale;
//  - Skyrend Nova over it, GROWING WITH ITS BAR (castRemaining of castTotal,
//    never a clock of its own): a sphere of storm light swelling, its heart
//    whitening, lightning crawling over it faster and faster, a halo the
//    whole raid sees from the farthest isle, the sky round the Cornice
//    darkening into storm, a tremble in its last seconds;
//  - its two seals: a crackling tether from the nova out to each Stillstone
//    over the void (the road the raid follows), broken as each stone is
//    stilled; the stilling's bolt of calm racing home along it;
//  - the endings: the cocoon SHATTERING (both stones stilled: its shell
//    flung out in shards, a white flash, a shockwave, the sky clearing, a
//    hard shake) and the NOVA's blast (it ran out: a white sun going off, a
//    wave sweeping out past every isle, the sky blazing, the hardest shake).
// The cocoon, the nova's growth and the seals draw on EVERY tier (the raid
// reads its clock and its road off them); sparks, shards and debris thin on
// the low tier. Built in the constructor under the host's root (its one
// gated attach); fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { BREATH } from '../../sim/content/smith_heart_layout';
import { ISLE_CASTS } from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import { BreathEntranceBolts } from './breath_entrance_bolts';
import {
  COCOON_ENDS,
  cocoonRadius,
  type EndLook,
  endLook,
  type NovaLook,
  novaCharge,
  novaLook,
  PHASE_COLORS as PC,
  phaseRgb,
  SKY_DOME_R,
  sealArc,
  sealEnd,
  sealLives,
} from './breath_isle_phase_core';
import {
  NOVA_CORE_FRAG,
  NOVA_FRAG,
  PHASE_SHELL_VERT,
  SKY_DOME_FRAG,
  SKY_DOME_VERT,
} from './breath_isle_phase_glsl';
import type { BreathIslesHost } from './breath_isles_fx';
import {
  BULWARK_BANDS,
  BULWARK_DEBRIS,
  bulwarkBandLife,
  bulwarkDebris,
  bulwarkDebrisCount,
  bulwarkLook,
} from './breath_isles_fx_core';
import {
  BULWARK_BAND_FRAG,
  BULWARK_BAND_VERT,
  BULWARK_FRAG,
  BULWARK_VERT,
  ISLE_RUNE_FRAG,
  ISLE_UV_VERT,
} from './breath_isles_glsl';

/** The cocoon's bands' light (the Bulwark's whole vortex washed white over
 *  a body this big: the wind reads in ropes, the guardian through them). */
const COCOON_BAND_LIGHT = 0.45;
/** Seconds a seal takes to break (its pieces flung and fading). */
const SEAL_BREAK = 1.4;
/** Bolts per seal (the arc drawn in pieces). */
const SEAL_PIECES = 4;
const WHITE = phaseRgb(0xffffff);
const NOVA_RGB = phaseRgb(PC.nova);
const HOT_RGB = phaseRgb(PC.novaHot);
const STILL_RGB = phaseRgb(PC.stilled);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = { x: 0, y: 0, z: 0, spin: 0, size: 0 };
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _c = { x: 0, y: 0, z: 0 };
const _n = { x: 0, y: 0, z: 0 };
const _look: NovaLook = {
  radius: 0,
  lift: 0,
  glow: 0,
  crackle: 0,
  throb: 0,
  sky: 0,
  hum: 0,
  hot: 0,
  tremble: 0,
};
const _end: EndLook = { flash: 0, wave: 0, waveGlow: 0, left: 0, sky: 0 };
const _lives: [number, number] = [1, 1];

export class BreathCocoonFx {
  private readonly group = new THREE.Group();
  private readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;
  private readonly bands: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly runes: THREE.Mesh;
  private readonly runeMat: THREE.ShaderMaterial;
  private readonly stones: THREE.InstancedMesh;
  private readonly nova: THREE.Mesh;
  private readonly novaMat: THREE.ShaderMaterial;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly flare: THREE.Sprite;
  private readonly flareMat: THREE.SpriteMaterial;
  private readonly wave: THREE.Mesh;
  private readonly waveMat: THREE.ShaderMaterial;
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly bolts: BreathEntranceBolts;
  /** The seals: their crackle and the wide glow under it (camera-facing
   *  strips, never a crossed ribbon seen end-on). */
  private readonly sealBolts: BreathEntranceBolts;
  private flash = 0;
  private clock = 0;
  private seed = 0x6c3a;
  private R = 3.4;
  /** The nova's middle and the cocoon's foot last frame (world). */
  private readonly novaAt = { x: 0, y: 0, z: 0 };
  private readonly foot = { x: 0, y: 0, z: 0 };
  private shown = false;
  private charge = 0;
  private sky = 0;
  /** The seals: their life now and when each broke (NaN: whole). */
  private readonly sealLife: [number, number] = [1, 1];
  private readonly sealBroke: [number, number] = [Number.NaN, Number.NaN];
  /** A stilling's bolt racing home along a seal: its start (NaN: none). */
  private readonly sealRush: [number, number] = [Number.NaN, Number.NaN];
  /** The ending playing (null: none), when it began and where. */
  private ending: 'shatter' | 'blast' | null = null;
  private endAt = 0;
  private readonly endPos = { x: 0, y: 0, z: 0 };
  private endR = 3.4;
  private crackle = 0;
  /** The vortex's middle (world) and radius, for the bands' camera veil. */
  private readonly center = { value: new THREE.Vector3() };
  private readonly radius = { value: 1 };
  /** The hum's gain this frame (the audio reads it). */
  hum = 0;

  constructor(
    private readonly h: BreathIslesHost,
    glowTex: THREE.Texture | null,
  ) {
    this.group.name = 'smithHeartBreathCocoon';
    this.group.visible = false;
    h.root.add(this.group);
    // ---- the cocoon (the vortex) ----
    this.shellMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathBulwark',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(PC.cocoon) },
        uEdge: { value: new THREE.Color(PC.cocoonEdge) },
        uSolid: { value: 1 },
        uCrack: { value: 0 },
        uSpin: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: BULWARK_VERT,
      fragmentShader: BULWARK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.shellMat);
    const sphere = new THREE.SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
    h.geometries.push(sphere);
    this.shell = new THREE.Mesh(sphere, this.shellMat);
    this.shell.frustumCulled = false;
    this.group.add(this.shell);
    for (const b of BULWARK_BANDS) {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const bulge = Math.sin(t * Math.PI) * 0.06;
        pts.push(new THREE.Vector2(b.r0 + (b.r1 - b.r0) * t + bulge, b.y0 + (b.y1 - b.y0) * t));
      }
      const geo = new THREE.LatheGeometry(pts, 48);
      h.geometries.push(geo);
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathBulwarkBand',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.cocoon) },
          uEdge: { value: new THREE.Color(PC.cocoonEdge) },
          uLive: { value: 1 },
          uSpin: { value: b.spin },
          uSlant: { value: b.slant },
          uFlash: { value: 0 },
          uCenter: this.center,
          uRadius: this.radius,
        },
        vertexShader: BULWARK_BAND_VERT,
        fragmentShader: BULWARK_BAND_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.bands.push({ mesh, mat });
    }
    // The ring of wind runes turning on the floor at its foot (the ladder).
    const ring = new THREE.RingGeometry(1.15, 1.55, 72, 1);
    const pos = ring.getAttribute('position');
    const uv = ring.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      uv.setXY(k, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - 1.15) / 0.4);
    }
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.06, 0);
    h.geometries.push(ring);
    this.runeMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathBulwarkRunes',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(PC.cocoon) },
        uWake: { value: 1 },
      },
      vertexShader: ISLE_UV_VERT,
      fragmentShader: ISLE_RUNE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.runeMat);
    this.runes = new THREE.Mesh(ring, this.runeMat);
    this.runes.renderOrder = floorVfxRenderOrder('encounter', 5);
    this.runes.frustumCulled = false;
    this.group.add(this.runes);
    const stone = new THREE.DodecahedronGeometry(1, 0);
    const n = stone.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const v = 0.42 + 0.12 * ((k * 7) % 5) * 0.25;
      col[k * 3] = v;
      col[k * 3 + 1] = v * 1.01;
      col[k * 3 + 2] = v * 1.04;
    }
    stone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    h.geometries.push(stone);
    this.stones = new THREE.InstancedMesh(stone, heartKitSlotMaterial('stone'), BULWARK_DEBRIS);
    this.stones.name = 'smithHeartBreathCocoonStones';
    this.stones.frustumCulled = false;
    this.stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.stones);

    // ---- the nova (world space: it outlives the cocoon by its blast) ----
    this.novaMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathNova',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(PC.nova) },
        uCore: { value: new THREE.Color(PC.novaCore) },
        uHot: { value: new THREE.Color(PC.novaHot) },
        uGlow: { value: 1 },
        uHotK: { value: 0 },
        uThrob: { value: 0 },
        uCharge: { value: 0 },
        uFade: { value: 1 },
      },
      vertexShader: PHASE_SHELL_VERT,
      fragmentShader: NOVA_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.novaMat);
    const novaGeo = new THREE.SphereGeometry(1, 48, 32);
    h.geometries.push(novaGeo);
    this.nova = new THREE.Mesh(novaGeo, this.novaMat);
    this.nova.name = 'smithHeartBreathNova';
    this.nova.frustumCulled = false;
    this.nova.visible = false;
    h.root.add(this.nova);
    // Its storm core inside the light (drawn first: a dark ball lit within).
    this.coreMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathNovaCore',
      uniforms: {
        uTime: h.uTime,
        uStorm: { value: new THREE.Color(PC.storm) },
        uColor: { value: new THREE.Color(PC.nova) },
        uCore: { value: new THREE.Color(PC.novaCore) },
        uHot: { value: new THREE.Color(PC.novaHot) },
        uHotK: { value: 0 },
        uCharge: { value: 0 },
        uThrob: { value: 0 },
        uFade: { value: 1 },
      },
      vertexShader: PHASE_SHELL_VERT,
      fragmentShader: NOVA_CORE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    h.materials.push(this.coreMat);
    const core = new THREE.Mesh(novaGeo, this.coreMat);
    core.name = 'smithHeartBreathNovaCore';
    core.scale.setScalar(0.96);
    core.renderOrder = -1;
    core.frustumCulled = false;
    this.nova.add(core);
    // Its halo (seen from the farthest isle) and the ending's flare.
    this.haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: PC.nova,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      name: 'smithHeartBreathNovaHalo',
    });
    h.materials.push(this.haloMat);
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.visible = false;
    h.root.add(this.halo);
    this.flareMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      name: 'smithHeartBreathNovaFlare',
    });
    h.materials.push(this.flareMat);
    this.flare = new THREE.Sprite(this.flareMat);
    this.flare.visible = false;
    h.root.add(this.flare);
    // The ending's shockwave: the cocoon's shell flung out (its own material).
    this.waveMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathCocoonWave',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(PC.cocoon) },
        uEdge: { value: new THREE.Color(PC.cocoonEdge) },
        uSolid: { value: 1 },
        uCrack: { value: 1 },
        uSpin: { value: 3 },
        uFlash: { value: 0 },
      },
      vertexShader: BULWARK_VERT,
      fragmentShader: BULWARK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.waveMat);
    const waveGeo = new THREE.SphereGeometry(1, 40, 20);
    h.geometries.push(waveGeo);
    this.wave = new THREE.Mesh(waveGeo, this.waveMat);
    this.wave.frustumCulled = false;
    this.wave.visible = false;
    h.root.add(this.wave);
    // ---- the storm sky round the Cornice ----
    this.domeMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathNovaSky',
      uniforms: {
        uTime: h.uTime,
        uDark: { value: 0 },
        uFlash: { value: 0 },
        uStorm: { value: new THREE.Color(PC.storm) },
        uLit: { value: new THREE.Color(PC.novaHot) },
      },
      vertexShader: SKY_DOME_VERT,
      fragmentShader: SKY_DOME_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    h.materials.push(this.domeMat);
    const domeGeo = new THREE.SphereGeometry(SKY_DOME_R, 40, 20);
    h.geometries.push(domeGeo);
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.name = 'smithHeartBreathNovaSky';
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    this.dome.position.set(BREATH.cornice.x, BREATH.cornice.h, BREATH.cornice.z);
    // The first of the see-through things: it darkens what lies past it and
    // never the fight's own light drawn after it.
    this.dome.renderOrder = -100;
    h.local.add(this.dome);
    // The lightning: the seals, the arcs over the nova, the endings' bolts.
    this.bolts = new BreathEntranceBolts(h.root, h);
    this.sealBolts = new BreathEntranceBolts(h.root, h);
  }

  /** The cocoon's flash (it rose, a stone was stilled). */
  flashShell(k: number): void {
    this.flash = Math.max(this.flash, k);
  }

  /** A Stillstone was stilled (the cue, its body at `x, z`): its seal's bolt
   *  of calm races home and the seal breaks behind it. */
  stilled(x: number, z: number): void {
    const o = this.h.local.position;
    let side: 0 | 1 = 0;
    let best = 1e9;
    for (const k of [0, 1] as const) {
      const e = sealEnd(k);
      const d = Math.hypot(x - o.x - e.x, z - o.z - e.z);
      if (d < best) {
        best = d;
        side = k;
      }
    }
    this.sealRush[side] = this.clock;
    this.flash = Math.max(this.flash, 1.1);
    this.h.shakeNear(this.foot.x, this.foot.z, 0.3, 50);
  }

  /** The cocoon shatters (`blast` false) or the nova goes off (true). */
  end(blast: boolean, g: Entity | undefined): void {
    this.ending = blast ? 'blast' : 'shatter';
    this.endAt = this.clock;
    if (this.shown || g) {
      const at = blast ? this.novaAt : this.foot;
      if (g && !this.shown) {
        const a = fxAnchor(g);
        this.endPos.x = a.x;
        this.endPos.y = g.pos.y + this.R * (blast ? 3 : 0.8);
        this.endPos.z = a.z;
      } else {
        this.endPos.x = at.x;
        this.endPos.y = blast ? at.y : at.y + this.R * 0.8;
        this.endPos.z = at.z;
      }
    }
    this.endR = this.R;
    const p = this.h.particles;
    const E = this.endPos;
    const dens = this.h.density;
    // The shell flung out in shards and grit, white sparks, rings.
    const n = Math.round((blast ? 90 : 70) * (0.4 + 0.6 * dens));
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      const up = this.rand() * 1.1 - 0.25;
      p.puff(
        E.x + Math.sin(ang) * this.R,
        E.y + (this.rand() - 0.3) * this.R,
        E.z + Math.cos(ang) * this.R,
        1,
        {
          speed: (blast ? 30 : 18) + this.rand() * 14,
          life: blast ? 1.6 : 1.2,
          size: [blast ? 1.1 : 0.8, 0.12],
          color: blast
            ? this.rand() < 0.5
              ? WHITE
              : HOT_RGB
            : this.rand() < 0.6
              ? WHITE
              : NOVA_RGB,
          alpha: 1,
          pool: 'glow',
          dir: [Math.sin(ang), up, Math.cos(ang)],
          spread: 0.25,
          drag: 0.9,
          gravity: blast ? 0 : 4,
          floor: -1e6,
        },
      );
    }
    // Granite chunks of the cocoon's stones dropping away (the shatter).
    if (!blast)
      for (let i = 0; i < Math.round(26 * (0.4 + 0.6 * dens)); i++) {
        const ang = this.rand() * Math.PI * 2;
        p.puff(E.x + Math.sin(ang) * this.R * 1.2, E.y, E.z + Math.cos(ang) * this.R * 1.2, 1, {
          speed: 9 + this.rand() * 8,
          life: 2.2,
          size: [0.45, 0.3],
          color: [0.42, 0.42, 0.44],
          alpha: 1,
          dir: [Math.sin(ang), 0.6 + this.rand() * 0.6, Math.cos(ang)],
          spread: 0.3,
          drag: 0.2,
          gravity: 14,
        });
      }
    p.shockRing(E.x, E.z, 0xffffff, blast ? 120 : 34, blast ? 2.2 : 1.1, {
      wake: 0.6,
      crest: blast ? 0.05 : 0.12,
      strength: 1.2,
    });
    p.shockRing(E.x, E.z, blast ? PC.novaHot : PC.cocoon, blast ? 80 : 22, blast ? 1.6 : 0.8);
    p.shockRing(E.x, E.z, PC.nova, blast ? 50 : 14, blast ? 1.1 : 0.55);
    this.h.shakeNear(E.x, E.z, blast ? 0.95 : 0.6, blast ? 260 : 120);
    this.sealRush[0] = Number.NaN;
    this.sealRush[1] = Number.NaN;
  }

  update(
    g: Entity | undefined,
    up: boolean,
    stilled: number,
    seen: readonly [boolean, boolean],
    dt: number,
  ): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.bolts.begin();
    this.sealBolts.begin();
    const live = !!g && !g.dead && up;
    let sky = 0;
    let flashSky = 0;
    if (live && g) {
      this.R = cocoonRadius(g.scale ?? 1);
      const a = fxAnchor(g);
      this.foot.x = a.x;
      this.foot.y = g.pos.y;
      this.foot.z = a.z;
      const channel = g.castingAbility === ISLE_CASTS.nova;
      this.charge = channel ? novaCharge(g.castRemaining, g.castTotal) : this.charge;
      const look = novaLook(this.charge, t, _look);
      this.paintCocoon(t, look, dt);
      this.paintNova(look, dt);
      this.paintSeals(stilled, seen, t);
      sky = look.sky;
      flashSky = Math.min(1, look.crackle / 24) * (Math.sin(t * 23) > 0.6 ? 1 : 0.2);
      this.hum = look.hum;
      if (look.tremble > 0) this.h.shakeNear(this.foot.x, this.foot.z, look.tremble * dt * 6, 200);
      this.shown = true;
    } else {
      if (this.shown) {
        this.group.visible = false;
        this.nova.visible = false;
        this.halo.visible = false;
        this.shown = false;
      }
      this.hum = 0;
      if (!this.ending) this.charge = 0;
    }
    // The ending.
    if (this.ending) {
      const blast = this.ending === 'blast';
      const age = this.clock - this.endAt;
      const T = blast ? COCOON_ENDS.blast : COCOON_ENDS.shatter;
      if (age > T) {
        this.ending = null;
        this.wave.visible = false;
        this.flare.visible = false;
      } else {
        const L = endLook(age, blast, _end);
        const E = this.endPos;
        this.wave.visible = true;
        this.wave.position.set(E.x, E.y, E.z);
        this.wave.scale.setScalar(this.endR * L.wave);
        const wu = this.waveMat.uniforms;
        wu.uSolid.value = 0.3 * L.waveGlow;
        wu.uFlash.value = L.waveGlow * (blast ? 0.7 : 0.5);
        wu.uCrack.value = blast ? 0.2 : 0.55;
        (wu.uColor.value as THREE.Color).setHex(blast ? PC.novaHot : PC.cocoon);
        this.flare.visible = L.flash > 0.01;
        this.flare.position.set(E.x, E.y, E.z);
        this.flare.scale.setScalar(this.endR * (blast ? 14 : 6) * (0.6 + 0.4 * L.flash));
        this.flareMat.opacity = L.flash;
        sky = Math.max(sky, L.sky);
        flashSky = Math.max(flashSky, L.flash);
        // The nova's sphere going off (the blast) or folding in (the shatter).
        if (L.left > 0) {
          this.nova.visible = true;
          const r = this.endR * novaLook(this.charge, t, _look).radius;
          this.nova.scale.setScalar(r * (blast ? 1 + (1 - L.left) * 1.5 : L.left));
          this.novaMat.uniforms.uFade.value = L.left;
          this.novaMat.uniforms.uGlow.value = 2.6;
          this.coreMat.uniforms.uFade.value = L.left * L.left;
          this.coreMat.uniforms.uCharge.value = 1;
        } else this.nova.visible = false;
        // Bolts thrown from the burst in its first moments.
        const nb = age < 0.6 ? (blast ? 8 : 5) : 0;
        for (let k = 0; k < nb; k++) {
          const ang = phaseHashAngle(k, Math.floor(age * 14));
          const reach = this.endR * (blast ? 9 : 4) * (0.6 + (0.4 * ((k * 37) % 7)) / 7);
          this.bolts.draw(
            Math.floor(age * 14) * 13 + k,
            E.x,
            E.y,
            E.z,
            E.x + Math.sin(ang) * reach,
            E.y + (blast ? -this.endR * 2 : this.endR * 0.5) + ((k % 3) - 1) * this.endR,
            E.z + Math.cos(ang) * reach,
            0.18,
            blast ? 1.4 : 0.9,
            1.4 * (1 - age / 0.6),
          );
        }
      }
    }
    // The sky.
    this.sky += (sky - this.sky) * Math.min(1, dt * (sky > this.sky ? 1.2 : 0.6));
    this.dome.visible = this.sky > 0.01;
    this.domeMat.uniforms.uDark.value = this.sky;
    this.domeMat.uniforms.uFlash.value = flashSky;
    this.bolts.end();
    this.sealBolts.end();
  }

  private paintCocoon(t: number, look: NovaLook, dt: number): void {
    // The cocoon stands whole while the phase is on (its seals carry the
    // stones' count); its glow trembles harder as the nova nears.
    const k = 1;
    const b = bulwarkLook(1, 1, t);
    this.group.visible = true;
    this.group.position.set(this.foot.x, this.foot.y, this.foot.z);
    this.group.scale.setScalar(this.R * b.pulse);
    this.center.value.set(this.foot.x, this.foot.y + this.R * 0.6, this.foot.z);
    this.radius.value = this.R * 1.2;
    const su = this.shellMat.uniforms;
    this.shell.scale.set(1, 1.15, 1);
    su.uSolid.value = (0.1 + 0.08 * look.hot) * (1 + 0.3 * look.throb * look.hot);
    su.uCrack.value = 0.15 + 0.5 * look.hot;
    su.uSpin.value = b.spin;
    su.uFlash.value = this.flash;
    BULWARK_BANDS.forEach((band, i) => {
      const life = bulwarkBandLife(k, band.over);
      const m = this.bands[i];
      m.mesh.visible = life > 0.01;
      m.mat.uniforms.uLive.value = life * COCOON_BAND_LIGHT;
      m.mat.uniforms.uSpin.value = band.spin * (1 + 0.6 * look.hot);
      m.mat.uniforms.uFlash.value = this.flash;
    });
    this.runes.rotation.y = t * 0.9;
    this.runeMat.uniforms.uWake.value = 1 + this.flash;
    const live = bulwarkDebrisCount(k, this.h.density);
    for (let j = 0; j < BULWARK_DEBRIS; j++) {
      if (j >= live) {
        this.stones.setMatrixAt(j, _m.makeScale(0, 0, 0));
        continue;
      }
      const s = bulwarkDebris(j, t, k, _d);
      _e.set(s.spin, s.spin * 0.7, s.spin * 0.4);
      _q.setFromEuler(_e);
      _m.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.size, s.size * 0.8, s.size));
      this.stones.setMatrixAt(j, _m);
    }
    this.stones.instanceMatrix.needsUpdate = true;
    // Grit torn off the vortex, drawn up toward the nova (cosmetic).
    if (this.rand() < dt * 16 * this.h.density) {
      const ang = this.rand() * Math.PI * 2;
      const r = this.R * 1.25;
      this.h.particles.puff(
        this.foot.x + Math.sin(ang) * r,
        this.foot.y + 0.4 + this.rand() * this.R * 1.4,
        this.foot.z + Math.cos(ang) * r,
        1,
        {
          speed: 6,
          up: 3,
          life: 0.9,
          size: [0.5, 0.15],
          color: WHITE,
          alpha: 0.7,
          pool: 'glow',
          dir: [Math.cos(ang), 0.5, -Math.sin(ang)],
          spread: 0.2,
          drag: 1.2,
        },
      );
    }
  }

  private paintNova(look: NovaLook, dt: number): void {
    const r = this.R * look.radius;
    this.novaAt.x = this.foot.x;
    this.novaAt.y = this.foot.y + this.R * look.lift;
    this.novaAt.z = this.foot.z;
    this.nova.visible = true;
    this.nova.position.set(this.novaAt.x, this.novaAt.y, this.novaAt.z);
    this.nova.scale.setScalar(r);
    this.nova.rotation.y += dt * (0.2 + 0.8 * this.charge);
    const u = this.novaMat.uniforms;
    u.uGlow.value = look.glow;
    u.uHotK.value = look.hot;
    u.uThrob.value = look.throb;
    u.uCharge.value = this.charge;
    u.uFade.value = 1;
    const cu = this.coreMat.uniforms;
    cu.uCharge.value = this.charge;
    cu.uHotK.value = look.hot;
    cu.uThrob.value = look.throb;
    cu.uFade.value = 1;
    this.halo.visible = true;
    this.halo.position.copy(this.nova.position);
    this.halo.scale.setScalar(r * (3.2 + 0.8 * look.throb));
    this.haloMat.color.setHex(look.hot > 0.5 ? PC.novaHot : PC.nova);
    this.haloMat.opacity = 0.35 + 0.45 * this.charge + 0.1 * look.throb;
    // The lightning crawling over it (arcs from its surface out and back).
    this.crackle += dt * look.crackle;
    const arcs = Math.min(7, 2 + Math.floor(this.charge * 6));
    const step = Math.floor(this.h.uTime.value * 12);
    for (let k = 0; k < arcs; k++) {
      const a0 = phaseHashAngle(k, step);
      const a1 = a0 + 0.6 + phaseHashAngle(k + 9, step) * 0.25;
      const y0 = Math.sin(phaseHashAngle(k + 3, step)) * 0.7;
      const y1 = Math.sin(phaseHashAngle(k + 5, step)) * 0.7;
      const c0 = Math.sqrt(1 - y0 * y0) * r * 1.02;
      const c1 = Math.sqrt(1 - y1 * y1) * r * 1.02;
      this.bolts.draw(
        step * 7 + k,
        this.novaAt.x + Math.sin(a0) * c0,
        this.novaAt.y + y0 * r,
        this.novaAt.z + Math.cos(a0) * c0,
        this.novaAt.x + Math.sin(a1) * c1,
        this.novaAt.y + y1 * r,
        this.novaAt.z + Math.cos(a1) * c1,
        0.3,
        0.35 + 0.35 * this.charge,
        0.6 + 0.8 * this.charge,
      );
    }
    // A bolt down onto the guardian now and then, more as it grows.
    if (this.rand() < dt * (0.6 + 3 * this.charge)) this.flash = Math.max(this.flash, 0.35);
    if (this.flash > 0.25)
      this.bolts.draw(
        step * 3 + 101,
        this.novaAt.x,
        this.novaAt.y - r * 0.9,
        this.novaAt.z,
        this.foot.x,
        this.foot.y + this.R * 1.2,
        this.foot.z,
        0.14,
        0.7,
        this.flash,
      );
    // Motes drawn up into it from the whole Cornice (cosmetic).
    if (this.rand() < dt * (8 + 26 * this.charge) * this.h.density) {
      const ang = this.rand() * Math.PI * 2;
      const d = r * (2.2 + this.rand() * 2.5);
      const x = this.novaAt.x + Math.sin(ang) * d;
      const y = this.novaAt.y - r + this.rand() * r * 2;
      const z = this.novaAt.z + Math.cos(ang) * d;
      this.h.particles.puff(x, y, z, 1, {
        speed: d * 1.4,
        life: 0.7,
        size: [0.15, 0.6],
        color: look.hot > 0.5 ? HOT_RGB : NOVA_RGB,
        alpha: 0.9,
        pool: 'glow',
        dir: [-Math.sin(ang), 0, -Math.cos(ang)],
        spread: 0.05,
        drag: 0.4,
        floor: -1e6,
      });
    }
  }

  private paintSeals(stilled: number, seen: readonly [boolean, boolean], t: number): void {
    const lives = sealLives(stilled, seen, _lives);
    const o = this.h.local.position;
    const step = Math.floor(t * 10);
    for (const k of [0, 1] as const) {
      // A seal newly broken: its time.
      if (lives[k] === 0 && this.sealLife[k] > 0) this.sealBroke[k] = this.clock;
      if (lives[k] > 0) this.sealBroke[k] = Number.NaN;
      this.sealLife[k] = lives[k];
      const end = sealEnd(k);
      _b.x = o.x + end.x;
      _b.y = o.y + end.y;
      _b.z = o.z + end.z;
      const since = this.clock - this.sealBroke[k];
      const broken = !Number.isNaN(this.sealBroke[k]);
      if (broken && since > SEAL_BREAK && Number.isNaN(this.sealRush[k])) continue;
      const fade = broken ? Math.max(0, 1 - since / SEAL_BREAK) : 1;
      const rush = Number.isNaN(this.sealRush[k]) ? -1 : (this.clock - this.sealRush[k]) / 0.9;
      if (rush > 1.6) this.sealRush[k] = Number.NaN;
      for (let j = 0; j < SEAL_PIECES; j++) {
        const k0 = j / SEAL_PIECES;
        const k1 = (j + 1) / SEAL_PIECES;
        sealArc(this.novaAt, _b, k0, _a);
        sealArc(this.novaAt, _b, k1, _c);
        // Broken, each piece falls apart from its middle: gaps open.
        let light = (0.55 + 0.25 * Math.sin(t * 7 + j * 1.7 + k)) * fade;
        let width = 1.7;
        if (broken) {
          const gap = Math.min(0.45, since * 0.5);
          _n.x = _a.x + (_c.x - _a.x) * (0.5 - gap);
          _n.y = _a.y + (_c.y - _a.y) * (0.5 - gap) - since * since * 4;
          _n.z = _a.z + (_c.z - _a.z) * (0.5 - gap);
          _c.x = _n.x;
          _c.y = _n.y;
          _c.z = _n.z;
        }
        // The stilling's bolt of calm racing home (stone to nova): a bright
        // gold band passing each piece.
        if (rush >= 0) {
          const head = 1 - rush;
          const near = 1 - Math.min(1, Math.abs((k0 + k1) / 2 - head) * 3);
          if (near > 0) {
            light += 2.2 * near;
            width += 1.6 * near;
          }
        }
        // Its crackle, and a wide soft river of light under it (a steady
        // shape: its seed holds, so it never jitters).
        this.sealBolts.draw(
          step * 17 + j * 5 + k * 31,
          _a.x,
          _a.y,
          _a.z,
          _c.x,
          _c.y,
          _c.z,
          0.06,
          width,
          light,
        );
        this.sealBolts.draw(
          j * 5 + k * 31 + 7,
          _a.x,
          _a.y,
          _a.z,
          _c.x,
          _c.y,
          _c.z,
          0.015,
          width * 3.2,
          light * 0.28,
        );
      }
      // Sparks off the rush's head and where the seal meets its stone.
      if (rush >= 0 && rush <= 1) {
        sealArc(this.novaAt, _b, 1 - rush, _a);
        this.h.particles.puff(_a.x, _a.y, _a.z, 3, {
          speed: 6,
          life: 0.5,
          size: [0.9, 0.15],
          color: STILL_RGB,
          alpha: 1,
          pool: 'glow',
          floor: -1e6,
        });
      }
    }
  }

  leave(): void {
    this.group.visible = false;
    this.nova.visible = false;
    this.halo.visible = false;
    this.wave.visible = false;
    this.flare.visible = false;
    this.dome.visible = false;
    this.sealBolts.hide();
    this.sky = 0;
    this.shown = false;
    this.ending = null;
    this.charge = 0;
    this.hum = 0;
    this.bolts.hide();
  }

  dispose(): void {
    this.stones.dispose();
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}

/** A hashed bearing for arc `k` at step `s` (radians). */
function phaseHashAngle(k: number, s: number): number {
  let h = (Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(s + 7, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * Math.PI * 2;
}
