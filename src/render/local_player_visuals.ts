import type * as THREE from 'three';
import type { IWorld } from '../world_api';
import { AfflictionFamiliar, type AfflictionFamiliarCompileGate } from './affliction_familiar';
import { CourierVisual } from './courier_visual';
import { setRenderCategory } from './renderer_diagnostics';
import { UmbralAnchorMarker } from './umbral_anchor_marker';

/** Owner-only world decorations share the renderer's frame and teardown lifecycle. */
export class LocalPlayerVisuals {
  private readonly anchor: UmbralAnchorMarker;
  private readonly familiar: AfflictionFamiliar;
  private readonly courier: CourierVisual;

  constructor(
    private readonly scene: THREE.Scene,
    groundAt: (x: number, z: number) => number,
    compileGate: AfflictionFamiliarCompileGate,
  ) {
    this.anchor = new UmbralAnchorMarker(groundAt);
    this.familiar = new AfflictionFamiliar(compileGate);
    this.courier = new CourierVisual(
      scene,
      groundAt,
      (target) => compileGate()?.(target) ?? Promise.resolve(),
    );
  }

  attach(): void {
    setRenderCategory(this.anchor.group, 'vfx');
    this.scene.add(this.anchor.group);
  }

  update(
    world: IWorld,
    views: ReadonlyMap<number, { group: THREE.Group }>,
    reducedMotion: boolean,
    time: number,
    dt: number,
    reducedDetail: boolean,
  ): void {
    this.anchor.update(world.entities.get(world.playerId), time, reducedMotion, reducedDetail);
    this.familiar.update(world, views, reducedMotion, time);
    this.courier.update(world.courierInfo, dt, reducedMotion);
  }

  dispose(): void {
    this.familiar.clear();
    this.courier.dispose();
    this.anchor.group.removeFromParent();
  }
}
