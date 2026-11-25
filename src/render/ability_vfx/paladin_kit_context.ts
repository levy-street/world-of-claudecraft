import * as THREE from 'three';
import type { VfxAnchorResolver } from '../vfx_anchor';
import type { PaladinLocalProbe } from './paladin_flash';

/** What every Paladin kit effect (paladin_kit.ts) reads from the world. */
export interface PaladinKitContext {
  scene: THREE.Scene;
  anchor: VfxAnchorResolver;
  groundY: (x: number, z: number) => number;
  camera?: THREE.Camera;
  /** A hand's world position (0 main, 1 off); false when the rig has none. */
  hand: (id: number, hand: 0 | 1, out: THREE.Vector3) => boolean;
  /** World facing in radians (0 looks down +z), when known. */
  facing: (id: number) => number | null;
  /** Whether `id` is the local player (big flashes dim for others, paladin_flash.ts). */
  isLocal?: PaladinLocalProbe;
}

export const KIT_GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
export const KIT_IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
export const KIT_AMBER = new THREE.Color(0xffa64a).multiplyScalar(1.2);
export const KIT_WARM = new THREE.Color(0xffd27a).multiplyScalar(1.35);

/** Flare: white core, soft halo and a four-point star (shared GLSL branch). */
export const KIT_FLARE_GLSL = `
  float kitFlare(vec2 p){
    float r=length(p);
    float core=exp(-r*r*18.0);
    float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*2.0)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.2);
    return (core*1.5+exp(-r*r*5.0)*0.35+spokes*0.7)*(1.0-smoothstep(0.7,1.0,r));
  }
  float kitDiamond(vec2 p){
    float d=abs(p.x)+abs(p.y);
    return (1.0-smoothstep(0.8,1.0,d))*0.6+exp(-abs(d-0.9)*16.0)*0.9;
  }
`;
