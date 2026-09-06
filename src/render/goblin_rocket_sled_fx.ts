// Runtime exhaust rig for the Goblin Rocket Sled. The continuous plume stays
// parented to the authored sockets; detached flame/spark/smoke particles use
// the shared Vfx pool so there is no mount-local particle allocation loop.

import * as THREE from 'three';
import { GFX, gfxTierAtLeast } from './gfx';
import {
  type GoblinRocketSledFxPlan,
  type GoblinRocketSledFxState,
  stepGoblinRocketSledFx,
} from './goblin_rocket_sled_fx_core';
import { rocketSledRiderPivot, stepRocketSledJumpPitch } from './mount_visuals';
import type { Vfx } from './vfx';

const LEFT_SOCKET = 'Socket_Exhaust_L';
const RIGHT_SOCKET = 'Socket_Exhaust_R';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying float vAlong;
  void main() {
    vAlong = uv.y;
    vec3 p = position;
    float envelope = sin(vAlong * 3.14159265);
    p.x += sin(uTime * 21.0 + vAlong * 8.0) * 0.035 * envelope * uIntensity;
    p.z += cos(uTime * 16.0 + vAlong * 11.0) * 0.025 * envelope * uIntensity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uReverseColor;
  uniform float uOpacity;
  uniform float uReverseBlend;
  uniform float uIgnition;
  uniform float uAirborneHeat;
  varying float vAlong;
  void main() {
    float baseFeather = smoothstep(0.0, 0.1, vAlong);
    float tipFeather = 1.0 - smoothstep(0.62, 1.0, vAlong);
    float pulse = 0.86 + 0.14 * sin(vAlong * 19.0);
    float alpha = uOpacity * baseFeather * tipFeather * pulse;
    if (alpha < 0.01) discard;
    vec3 color = mix(uColor, uReverseColor, uReverseBlend);
    color = mix(color, vec3(1.35, 1.28, 1.12), uAirborneHeat);
    color *= 1.0 + uIgnition * 0.45;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function flameMaterial(color: number, reverseColor: number, hdr: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color(color).multiplyScalar(hdr) },
      uReverseColor: { value: new THREE.Color(reverseColor).multiplyScalar(hdr) },
      uOpacity: { value: 0 },
      uReverseBlend: { value: 0 },
      uIgnition: { value: 0 },
      uAirborneHeat: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

interface PlumePair {
  group: THREE.Group;
  outer: THREE.Mesh;
  inner: THREE.Mesh;
  phase: number;
}

export class GoblinRocketSledFx {
  private readonly state: GoblinRocketSledFxState = {
    intensity: 0,
    reverseBlend: 0,
    ignitionAge: -1,
    ignitionCooldown: 0,
    nonForwardTime: 0,
    forwardAge: 0,
    fullBoreLatched: false,
    wasForward: false,
    wasAirborne: false,
    airborneBlend: 0,
    landingAge: -1,
  };
  private readonly plan: GoblinRocketSledFxPlan = {
    visible: false,
    intensity: 0,
    outerLength: 0,
    outerWidth: 0,
    innerLength: 0,
    opacity: 0,
    flutter: 0,
    particleStrength: 0,
    smokeStrength: 0,
    reverseBlend: 0,
    ignition: 0,
    ignitionAge: -1,
    ignitionBurst: false,
    thrustSpool: 0,
    airborneOverburn: 0,
    jetHunt: 0,
    takeoffBurst: false,
    landingBurst: false,
    stationaryPressure: 0,
  };
  // ConeGeometry is centered on its Y axis. Translate its base to Y=0 so the
  // later length scale always grows away from the nozzle instead of opening a
  // gap when the reverse flame contracts.
  private readonly outerGeometry = new THREE.ConeGeometry(0.5, 1, 8, 1, true).translate(0, 0.5, 0);
  private readonly innerGeometry = new THREE.ConeGeometry(0.42, 1, 8, 1, true).translate(0, 0.5, 0);
  private readonly outerMaterial = flameMaterial(0xff5a16, 0x70bfff, GFX.composer ? 2.1 : 1);
  private readonly innerMaterial = flameMaterial(0xffd36a, 0xedfbff, GFX.composer ? 2.6 : 1);
  private readonly plumes: readonly [PlumePair, PlumePair];
  private readonly leftWorld = new THREE.Vector3();
  private readonly rightWorld = new THREE.Vector3();
  private readonly rearWorld = new THREE.Vector3();
  private readonly worldQuaternion = new THREE.Quaternion();
  private disposed = false;

  private constructor(
    private readonly mountRoot: THREE.Object3D,
    leftSocket: THREE.Object3D,
    rightSocket: THREE.Object3D,
  ) {
    this.plumes = [this.attachPlume(leftSocket, 0), this.attachPlume(rightSocket, Math.PI * 0.73)];
  }

  static create(mountRoot: THREE.Object3D): GoblinRocketSledFx | null {
    const left = mountRoot.getObjectByName(LEFT_SOCKET);
    const right = mountRoot.getObjectByName(RIGHT_SOCKET);
    if (!left || !right) return null;
    return new GoblinRocketSledFx(mountRoot, left, right);
  }

  private attachPlume(socket: THREE.Object3D, phase: number): PlumePair {
    const group = new THREE.Group();
    group.name = `GoblinRocketPlume_${phase === 0 ? 'L' : 'R'}`;
    group.rotation.x = -Math.PI / 2;
    group.visible = false;

    const outer = new THREE.Mesh(this.outerGeometry, this.outerMaterial);
    outer.name = `${group.name}_Outer`;
    outer.renderOrder = 4;
    outer.frustumCulled = false;
    group.add(outer);

    const inner = new THREE.Mesh(this.innerGeometry, this.innerMaterial);
    inner.name = `${group.name}_Core`;
    inner.position.y = -0.03;
    inner.renderOrder = 5;
    inner.frustumCulled = false;
    group.add(inner);

    socket.add(group);
    return { group, outer, inner, phase };
  }

  update(
    dt: number,
    time: number,
    moving: boolean,
    backwards: boolean,
    airborne: boolean,
    speed: number,
    reducedMotion: boolean,
    shown: boolean,
    vfx: Vfx | null,
  ): void {
    if (this.disposed) return;
    stepGoblinRocketSledFx(
      this.state,
      { dt, time, mounted: shown, moving, backwards, airborne, speed, reducedMotion },
      this.plan,
    );

    this.outerMaterial.uniforms.uTime.value = time;
    this.outerMaterial.uniforms.uIntensity.value = this.plan.intensity;
    this.outerMaterial.uniforms.uOpacity.value = this.plan.opacity * 0.72;
    this.outerMaterial.uniforms.uReverseBlend.value = this.plan.reverseBlend;
    this.outerMaterial.uniforms.uIgnition.value = this.plan.ignition;
    this.outerMaterial.uniforms.uAirborneHeat.value =
      this.plan.airborneOverburn * 0.18 + this.plan.stationaryPressure * 0.42;
    this.innerMaterial.uniforms.uTime.value = time + 0.37;
    this.innerMaterial.uniforms.uIntensity.value = this.plan.intensity;
    this.innerMaterial.uniforms.uOpacity.value = this.plan.opacity * 0.92;
    this.innerMaterial.uniforms.uReverseBlend.value = this.plan.reverseBlend;
    this.innerMaterial.uniforms.uIgnition.value = this.plan.ignition;
    this.innerMaterial.uniforms.uAirborneHeat.value = Math.min(
      1,
      this.plan.airborneOverburn * 0.72 + this.plan.stationaryPressure,
    );

    for (const [index, plume] of this.plumes.entries()) {
      plume.group.visible = this.plan.visible;
      if (!this.plan.visible) continue;
      const independentFlutter =
        this.plan.flutter * Math.sin(time * 13.3 + plume.phase) * (reducedMotion ? 0.35 : 1);
      const ignitionDelay = plume.phase === 0 ? 0 : 0.025;
      const plumeIgnition =
        this.plan.ignitionAge >= ignitionDelay
          ? Math.exp(-(this.plan.ignitionAge - ignitionDelay) * 7)
          : 0;
      const hunt = this.plan.jetHunt * (index === 0 ? 1 : -1);
      const length =
        this.plan.outerLength *
        (1 + independentFlutter * 0.08 + hunt * 0.055) *
        (1 - plumeIgnition * 0.08);
      const width =
        this.plan.outerWidth * (1 - independentFlutter * 0.04) * (1 + plumeIgnition * 0.12);
      plume.outer.scale.set(width, length, width);
      plume.inner.scale.set(width * 0.62, this.plan.innerLength, width * 0.62);
    }

    if (!vfx || !this.plan.visible) return;
    this.plumes[0].group.parent?.getWorldPosition(this.leftWorld);
    this.plumes[1].group.parent?.getWorldPosition(this.rightWorld);
    this.mountRoot.getWorldQuaternion(this.worldQuaternion);
    this.rearWorld.set(0, 0, -1).applyQuaternion(this.worldQuaternion).normalize();
    const fullDetail = gfxTierAtLeast(GFX.effectsTier, 'medium');
    if (this.plan.ignitionBurst) {
      vfx.mountRocketIgnition(this.leftWorld, this.rightWorld, this.rearWorld, fullDetail);
    }
    if (this.plan.takeoffBurst) {
      vfx.mountRocketAirbornePulse(
        this.leftWorld,
        this.rightWorld,
        this.rearWorld,
        'takeoff',
        fullDetail,
      );
    }
    if (this.plan.landingBurst) {
      vfx.mountRocketAirbornePulse(
        this.leftWorld,
        this.rightWorld,
        this.rearWorld,
        'landing',
        fullDetail,
      );
    }
    if (this.plan.particleStrength > 0) {
      vfx.mountRocketExhaust(
        this.leftWorld,
        this.rightWorld,
        this.rearWorld,
        dt,
        this.plan.particleStrength,
        this.plan.smokeStrength,
        fullDetail,
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const plume of this.plumes) plume.group.removeFromParent();
    this.outerGeometry.dispose();
    this.innerGeometry.dispose();
    this.outerMaterial.dispose();
    this.innerMaterial.dispose();
  }
}

/** The rocket sled's whole per-frame attitude pass: jump pitch, the mount's own
 *  tilt, and the rider seat carried rigidly around the vehicle origin.
 *
 *  Lives here rather than inline in renderer.ts because it is this mount's
 *  behavior, not coordinator work, and renderer.ts is a named monolith under
 *  the line-count ratchet (root CLAUDE.md, Modularity). The caller passes the
 *  two roots and the seat inputs; the pure math stays in mount_visuals.ts.
 *
 *  `sledMounted` false still runs, so a non-sled mount relaxes any residual
 *  pitch to zero through the same damped path instead of snapping. */
export function applyRocketSledAttitude(
  view: { rocketSledJumpPitch: number },
  mountRoot: THREE.Object3D,
  riderRoot: THREE.Object3D,
  sledMounted: boolean,
  airborne: boolean,
  verticalVelocity: number,
  dt: number,
  bob: number,
  seatLift: number,
  seatFwd: number,
): void {
  view.rocketSledJumpPitch = stepRocketSledJumpPitch(
    view.rocketSledJumpPitch,
    sledMounted && airborne,
    verticalVelocity,
    dt,
  );
  const pitch = sledMounted ? view.rocketSledJumpPitch : 0;
  const rotationX = -pitch;
  mountRoot.rotation.x = rotationX;
  mountRoot.position.y = bob;
  // Rigidly carry the separately-owned rider root around the same
  // vehicle-origin pivot, keeping pelvis and cushion locked together.
  const seat = rocketSledRiderPivot(seatLift, seatFwd, pitch);
  riderRoot.rotation.x = rotationX;
  riderRoot.position.y = seat.y;
  riderRoot.position.z = seat.z;
}
