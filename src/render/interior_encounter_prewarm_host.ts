import type * as THREE from 'three';
import type { Entity } from '../sim/types';
import type { CharacterVisual } from './characters';
import type { LiveSoulRendLook } from './interior_encounter_prewarm';

export interface InteriorEncounterPrewarmHost {
  shutdownStarted: boolean;
  views: Map<number, LiveSoulRendLook & { visual: CharacterVisual | null }>;
  sim: {
    entities: { get(id: number): { kind?: string } | undefined };
    // Read to PLACE the hidden groups where the camera is: a bounded prewarm
    // render only draws what the frustum contains.
    player: { pos: { x: number; y: number; z: number } };
  };
  scene: THREE.Scene;
  asyncCompileSupported: boolean;
  backgroundGpuWork: {
    run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
  };
  webgl: { initTexture(texture: THREE.Texture): void };
  prewarmEntity(
    kind: 'player' | 'mob' | 'npc',
    templateId: string,
    color: number,
    scale: number,
    skin?: number,
    id?: number,
  ): Entity;
  compilePrewarmColorPrograms(root: THREE.Object3D, includeOffscreen: boolean): Promise<void>;
  compileShadowPrograms(root: THREE.Object3D): Promise<void>;
  renderBoundedPrewarmRoot(group: THREE.Group, child: THREE.Object3D): void;
  collectObjectTextures(root: THREE.Object3D, visibleOnly: boolean): Set<THREE.Texture>;
}
