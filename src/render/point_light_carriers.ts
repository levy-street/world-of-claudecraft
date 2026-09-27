// The only point lights three gathers in the world scene: a fixed set of
// carriers, packed from the live sources on every render of that scene (the
// ordering contract lives in point_light_carriers_core.ts). Their count is
// the pinned NUM_POINT_LIGHTS of every lit program, so it never moves.
import * as THREE from 'three';
import {
  darkenPointLightCarriers,
  packPointLightSources,
  pointLightCarriesLight,
} from './point_light_carriers_core';

const CARRIER_KEY = 'pointLightCarrier';
const AUDIT_MIN_INTERVAL_MS = 5000;

export type PointLightSourceList = () => readonly THREE.PointLight[];

export const NO_POINT_LIGHTS: readonly THREE.PointLight[] = [];

export function isPointLightCarrier(object: THREE.Object3D): boolean {
  return object.userData[CARRIER_KEY] === true;
}

/** Every point light three would gather from `scene` for `camera` that is not
 *  a carrier. A stray is drawn in its traversal slot, where a dark carrier in
 *  front of it makes the shader break before it. A whole-scene walk: the DEV
 *  audit runs it on a registry change at most every few seconds, never per
 *  frame. A marked light (layer 31) is invisible to it, a marked clone too. */
export function findStrayPointLights(
  scene: THREE.Object3D,
  camera: THREE.Camera,
): THREE.PointLight[] {
  const strays: THREE.PointLight[] = [];
  scene.traverseVisible((object) => {
    const light = object as THREE.PointLight;
    if (light.isPointLight && light.layers.test(camera.layers) && !isPointLightCarrier(light)) {
      strays.push(light);
    }
  });
  return strays;
}

/** For a scene without carriers whose lights never change (a one-shot
 *  snapshot): a black light draws nothing, and hidden it cannot sit in front
 *  of a live one where the shader loop stops. */
export function hideBlackPointLights(root: THREE.Object3D): void {
  root.traverse((object) => {
    const light = object as THREE.PointLight;
    if (light.isPointLight && !pointLightCarriesLight(light.color, light.intensity)) {
      light.visible = false;
    }
  });
}

function lightPath(object: THREE.Object3D): string {
  const parts: string[] = [];
  for (let node: THREE.Object3D | null = object; node && parts.length < 6; node = node.parent) {
    parts.push(node.name || node.type);
  }
  return parts.join(' < ');
}

/** Carriers never cast shadows: a shadow-casting source would draw unshadowed,
 *  and the chunk's shadow arm is never selected in the world scene. */
export class PointLightCarriers {
  readonly lights: readonly THREE.PointLight[];
  private readonly sources: readonly PointLightSourceList[];
  private overflowReported = false;
  private auditedSignature = -1;
  private lastAuditAt = Number.NEGATIVE_INFINITY;
  private readonly reportedStrays = new WeakSet<THREE.Object3D>();
  private readonly reportedTwice = new WeakSet<THREE.Object3D>();
  private readonly reportedShadows = new WeakSet<THREE.Object3D>();

  constructor(scene: THREE.Object3D, count: number, sources: readonly PointLightSourceList[]) {
    const lights: THREE.PointLight[] = [];
    for (let i = 0; i < count; i++) {
      const carrier = new THREE.PointLight(0x000000, 0, 0, 2);
      carrier.name = `point-light-carrier-${i}`;
      carrier.userData[CARRIER_KEY] = true;
      // The pack writes matrixWorld directly after three's own update pass.
      carrier.matrixAutoUpdate = false;
      carrier.matrixWorldAutoUpdate = false;
      scene.add(carrier);
      lights.push(carrier);
    }
    this.lights = lights;
    this.sources = sources;
  }

  /** Packs the live sources into carriers 0..k-1 and darkens the rest. */
  pack(scene: THREE.Object3D, camera: THREE.Camera): number {
    const mask = camera.layers.mask;
    let cursor = 0;
    for (let i = 0; i < this.sources.length; i++) {
      cursor = packPointLightSources(this.sources[i](), this.lights, cursor, scene, mask);
    }
    darkenPointLightCarriers(this.lights, cursor);
    if (import.meta.env.DEV) this.devChecks(scene, camera, cursor);
    return cursor;
  }

  private devChecks(scene: THREE.Object3D, camera: THREE.Camera, live: number): void {
    if (live > this.lights.length && !this.overflowReported) {
      this.overflowReported = true;
      console.error(
        `PointLightCarriers: ${live} live point lights for ${this.lights.length} carriers; the last ones listed are dropped`,
      );
    }
    // A registry change is the rank-rebuild trigger and the moment a new
    // producer shows up; a balanced add and remove is caught by the next one.
    let signature = 0;
    for (let i = 0; i < this.sources.length; i++) signature += this.sources[i]().length;
    if (signature === this.auditedSignature) return;
    const now = performance.now();
    if (now - this.lastAuditAt < AUDIT_MIN_INTERVAL_MS) return;
    this.auditedSignature = signature;
    this.lastAuditAt = now;
    this.audit(scene, camera);
  }

  /** Reports each problem once per light on console.error, and returns the
   *  new reports: a light three gathers beside the carriers, a source listed
   *  twice (packed twice, drawn at double strength), a source casting a
   *  shadow no carrier draws. */
  audit(scene: THREE.Object3D, camera: THREE.Camera): string[] {
    const reports: string[] = [];
    for (const stray of findStrayPointLights(scene, camera)) {
      if (this.reportedStrays.has(stray)) continue;
      this.reportedStrays.add(stray);
      reports.push(
        `three gathers ${lightPath(stray)} beside the carriers; mark it (markPointLightSource) and register it with the budget`,
      );
    }
    const seen = new Set<THREE.PointLight>();
    for (const list of this.sources) {
      for (const light of list()) {
        if (seen.has(light) && !this.reportedTwice.has(light)) {
          this.reportedTwice.add(light);
          reports.push(`${lightPath(light)} is listed twice as a carrier source`);
        }
        seen.add(light);
        if (light.castShadow && !this.reportedShadows.has(light)) {
          this.reportedShadows.add(light);
          reports.push(`${lightPath(light)} casts a shadow, which no carrier draws`);
        }
      }
    }
    for (const report of reports) console.error(`PointLightCarriers: ${report}`);
    return reports;
  }
}

/** Adds `count` carriers to `scene` and packs them on every render of it.
 *  three calls the scene's onBeforeRender after scene.updateMatrixWorld() and
 *  before it gathers lights, so the sources' world matrices are the ones this
 *  very render draws with, and every render path (composer, prewarm, census)
 *  is covered without a call of its own. */
export function attachPointLightCarriers(
  scene: THREE.Scene,
  count: number,
  sources: readonly PointLightSourceList[],
): PointLightCarriers {
  const carriers = new PointLightCarriers(scene, count, sources);
  const previous = scene.onBeforeRender;
  const hook = (
    renderer: THREE.WebGLRenderer,
    rendered: THREE.Scene,
    camera: THREE.Camera,
    target: unknown,
  ) => {
    (previous as (...args: unknown[]) => void).call(scene, renderer, rendered, camera, target);
    carriers.pack(scene, camera);
  };
  scene.onBeforeRender = hook as unknown as THREE.Scene['onBeforeRender'];
  return carriers;
}
