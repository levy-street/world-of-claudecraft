// The storm of the Guardian of the Breath's entrance (plan:
// breath_entrance_core.ts), a part of breath_entrance_fx.ts: the eye of
// storm cloud turning high over the Cornice (two layers turning against each
// other), the tornado coming down out of it (a heavy shell of dark storm
// cloud wound with racing spiral bands and lit from within, writing depth so
// nothing behind shows through; a ragged outer layer of its torn masses; its
// glowing heart; a churning wall of dust round its foot), and
// the ring of gust its burst sends across the Cornice (a wall of wind and
// dust). Built once in the host's constructor under its stage; no light, no
// per-frame allocation.

import * as THREE from 'three';
import { BREATH_STORM_SHAPE as S } from './breath_entrance_core';
import {
  EYE_FRAG,
  EYE_VERT,
  FUNNEL_CORE_FRAG,
  FUNNEL_SHELL_FRAG,
  FUNNEL_VERT,
  GUST_WALL_FRAG,
  WALL_VERT,
} from './breath_entrance_glsl';

/** What the part reads off its host. */
export interface BreathEntranceStormHost {
  readonly uTime: { value: number };
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  /** The tier draws the cosmetic doubles (the upper cloud disc, the funnel's
   *  ragged outer layer): entrance_budget_core.ts. */
  readonly secondary: boolean;
}

/** One frame of the storm (the host's look, already under the viewer's
 *  light cap). */
export interface BreathStormFrame {
  eye: number;
  eyeR: number;
  eyeTurn: number;
  reach: number;
  funnel: number;
  burst: number;
  flash: number;
  /** Where up the funnel the light is (0 the foot, 1 the eye). */
  flashY: number;
  /** The dust skirt round the foot (0..1) and its turn (radians). */
  skirt: number;
  spin: number;
  ringR: number;
  ring: number;
}

export class BreathEntranceStorm {
  private readonly eyeLow: THREE.Mesh;
  private readonly eyeHigh: THREE.Mesh;
  private readonly eyeLowMat: THREE.ShaderMaterial;
  private readonly eyeHighMat: THREE.ShaderMaterial;
  readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;
  /** The shell's ragged outer layer (its torn masses only, turning slower). */
  readonly outer: THREE.Mesh;
  private readonly outerMat: THREE.ShaderMaterial;
  /** The churning wall of dust and debris round the funnel's foot. */
  readonly skirt: THREE.Mesh;
  private readonly skirtMat: THREE.ShaderMaterial;
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.ShaderMaterial;
  readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.ShaderMaterial;

  private readonly secondary: boolean;

  constructor(stage: THREE.Group, host: BreathEntranceStormHost) {
    this.secondary = host.secondary;
    // ---- the eye: two discs of cloud, the upper wider and turning slower ----
    const disc = new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2);
    host.geometries.push(disc);
    const eyeMat = (name: string, twist: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTurn: { value: 0 },
          uTime: host.uTime,
          uFlash: { value: 0 },
          uTwist: { value: twist },
        },
        vertexShader: EYE_VERT,
        fragmentShader: EYE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      host.materials.push(m);
      return m;
    };
    this.eyeLowMat = eyeMat('smithHeartBreathEntranceEye', 4.2);
    this.eyeHighMat = eyeMat('smithHeartBreathEntranceEyeHigh', 2.6);
    this.eyeLow = new THREE.Mesh(disc, this.eyeLowMat);
    this.eyeLow.name = 'smithHeartBreathEntranceEye';
    this.eyeHigh = new THREE.Mesh(disc, this.eyeHighMat);
    this.eyeHigh.name = 'smithHeartBreathEntranceEyeHigh';
    for (const m of [this.eyeLow, this.eyeHigh]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 1;
      stage.add(m);
    }
    this.eyeHigh.renderOrder = 0;

    // ---- the funnel: a shell of cloud and its glowing heart ----
    const tube = new THREE.CylinderGeometry(1, 1, 1, 56, 30, true).translate(0, 0.5, 0);
    host.geometries.push(tube);
    const funnelUniforms = (scale: number, layer = 0) => ({
      uLayer: { value: layer },
      uReach: { value: 0 },
      uBurst: { value: 0 },
      uTime: host.uTime,
      uScale: { value: scale },
      uAlpha: { value: 0 },
      uFlash: { value: 0 },
      uFlashY: { value: 0.5 },
      uFlicker: { value: 0 },
    });
    this.shellMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceFunnel',
      uniforms: funnelUniforms(1),
      vertexShader: FUNNEL_VERT,
      fragmentShader: FUNNEL_SHELL_FRAG,
      transparent: true,
      // All but opaque: it writes depth, so the Cornice's own later
      // transparent dressing never paints through the storm.
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    host.materials.push(this.shellMat);
    this.shell = new THREE.Mesh(tube, this.shellMat);
    this.shell.name = 'smithHeartBreathEntranceFunnel';
    this.shell.frustumCulled = false;
    this.shell.visible = false;
    this.shell.renderOrder = 3;
    stage.add(this.shell);
    this.outerMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceFunnelOuter',
      uniforms: funnelUniforms(1.16, 1),
      vertexShader: FUNNEL_VERT,
      fragmentShader: FUNNEL_SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    host.materials.push(this.outerMat);
    this.outer = new THREE.Mesh(tube, this.outerMat);
    this.outer.name = 'smithHeartBreathEntranceFunnelOuter';
    this.outer.frustumCulled = false;
    this.outer.visible = false;
    this.outer.renderOrder = 2;
    stage.add(this.outer);
    this.coreMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceFunnelHeart',
      uniforms: funnelUniforms(0.58),
      vertexShader: FUNNEL_VERT,
      fragmentShader: FUNNEL_CORE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    host.materials.push(this.coreMat);
    this.core = new THREE.Mesh(tube, this.coreMat);
    this.core.name = 'smithHeartBreathEntranceFunnelHeart';
    this.core.frustumCulled = false;
    this.core.visible = false;
    this.core.renderOrder = 4;
    stage.add(this.core);

    // ---- the ring of gust: a wall of wind ----
    const band = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true).translate(0, 0.5, 0);
    host.geometries.push(band);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceGust',
      uniforms: { uAlpha: { value: 0 }, uTime: host.uTime, uWrap: { value: 40 } },
      vertexShader: WALL_VERT,
      fragmentShader: GUST_WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    host.materials.push(this.wallMat);
    this.wall = new THREE.Mesh(band, this.wallMat);
    this.wall.name = 'smithHeartBreathEntranceGust';
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.wall.renderOrder = 7;
    stage.add(this.wall);
    // The skirt: the same churning dust, a band hugging the funnel's foot.
    this.skirtMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceSkirt',
      uniforms: { uAlpha: { value: 0 }, uTime: host.uTime, uWrap: { value: 14 } },
      vertexShader: WALL_VERT,
      fragmentShader: GUST_WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    host.materials.push(this.skirtMat);
    this.skirt = new THREE.Mesh(band, this.skirtMat);
    this.skirt.name = 'smithHeartBreathEntranceSkirt';
    this.skirt.frustumCulled = false;
    this.skirt.visible = false;
    this.skirt.renderOrder = 5;
    stage.add(this.skirt);
  }

  paint(f: BreathStormFrame): void {
    // The eye.
    const eyeOn = f.eye > 0.005;
    this.eyeLow.visible = eyeOn;
    this.eyeHigh.visible = eyeOn && this.secondary;
    if (eyeOn) {
      this.eyeLow.position.set(0, S.eyeH, 0);
      this.eyeLow.scale.setScalar(f.eyeR);
      this.eyeHigh.position.set(0, S.eyeH + 3.5, 0);
      this.eyeHigh.scale.setScalar(f.eyeR * 1.45);
      const lo = this.eyeLowMat.uniforms;
      lo.uAlpha.value = f.eye;
      lo.uTurn.value = f.eyeTurn;
      lo.uFlash.value = f.flash;
      const hi = this.eyeHighMat.uniforms;
      hi.uAlpha.value = f.eye * 0.75;
      hi.uTurn.value = -f.eyeTurn * 0.45;
      hi.uFlash.value = f.flash * 0.7;
    }
    // The funnel.
    const funnelOn = f.funnel > 0.005 && f.reach > 0.001;
    this.shell.visible = funnelOn;
    this.outer.visible = funnelOn && this.secondary;
    this.core.visible = funnelOn;
    if (funnelOn) {
      for (const m of [this.shellMat, this.outerMat]) {
        const su = m.uniforms;
        su.uReach.value = f.reach;
        su.uBurst.value = f.burst;
        su.uAlpha.value = f.funnel;
        su.uFlash.value = f.flash;
        su.uFlashY.value = f.flashY;
      }
      const cu = this.coreMat.uniforms;
      cu.uReach.value = f.reach;
      cu.uBurst.value = f.burst;
      cu.uAlpha.value = f.funnel * (1 - f.burst);
      cu.uFlicker.value = f.flash;
      cu.uFlashY.value = f.flashY;
    }
    // The skirt round its foot, once it has touched down.
    const skirtOn = f.skirt > 0.01;
    this.skirt.visible = skirtOn;
    if (skirtOn) {
      const r = S.rBot * 2.1 * (1 + 1.6 * f.burst);
      this.skirt.scale.set(r, 9 * (1 - 0.5 * f.burst), r);
      this.skirt.rotation.y = -f.spin;
      this.skirtMat.uniforms.uAlpha.value = f.skirt;
    }
    // The ring of gust.
    const ringOn = f.ring > 0.01 && f.ringR > 0.5;
    this.wall.visible = ringOn;
    if (ringOn) {
      const h = 3 + 6 * f.ring;
      this.wall.scale.set(f.ringR, h, f.ringR);
      this.wall.position.set(0, 0.05, 0);
      this.wallMat.uniforms.uAlpha.value = f.ring * 0.75;
      this.wallMat.uniforms.uWrap.value = Math.max(8, Math.round(f.ringR * 0.9));
    }
  }

  hide(): void {
    this.eyeLow.visible = false;
    this.eyeHigh.visible = false;
    this.shell.visible = false;
    this.outer.visible = false;
    this.core.visible = false;
    this.skirt.visible = false;
    this.wall.visible = false;
  }
}
