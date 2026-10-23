import * as THREE from 'three';
import { GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import type { Entity } from '../sim/types';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import { createGliderApparatusMesh } from './glider_apparatus';
import { gliderCourseVisible } from './glider_course_core';
import { gliderDisplayedMotionPitch } from './glider_flight_pose_core';
import { rewardGliderVisible } from './reward_glider_core';

type RenderedBody = Pick<THREE.Object3D, 'position' | 'rotation' | 'visible'>;
export type GliderRenderedViews = ReadonlyMap<number, { group: RenderedBody }>;

// Standing humanoids are 2.6 yards tall. The course's chest-level apparatus
// origin intersects their head, so seat this wing above the standing pilot.
const REWARD_GLIDER_HEIGHT = 2.8;

/** Shared-material clones of one warmed apparatus, driven by existing entity views. */
export class RewardGliderVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private readonly apparatus = createGliderApparatusMesh();
  private readonly bodies = new Map<number, THREE.Group>();
  private readonly sampled = new Set<number>();
  private ready = false;
  private disposed = false;

  constructor(scene: THREE.Object3D, compileGate?: (target: THREE.Object3D) => Promise<unknown>) {
    this.group.name = 'reward-glider-visual';
    this.group.visible = false;
    this.group.add(this.apparatus.group);
    const attach = () => attachSceneGroupGated(scene, this.group, compileGate, () => this.disposed);
    // Compile the actual loaded mesh, not its empty placeholder. All live clones
    // share these geometry/material objects and therefore the warmed variants.
    this.readyForEntry = (
      this.apparatus.group.children.length > 0
        ? attach()
        : this.apparatus.readyForEntry.then(attach)
    )
      .then(() => {
        this.ready = !this.disposed;
        this.group.visible = false;
      })
      .catch(() => {});
  }

  update(
    world: IWorld,
    renderedSelf?: Pick<THREE.Object3D, 'position' | 'rotation'>,
    views?: GliderRenderedViews,
    dt = 0,
  ): void {
    if (!this.ready || this.disposed) return;
    // Hide retained equipment first; only currently drawn and eligible bodies
    // below may show it. This also covers culling, aura loss, death and landing.
    this.group.visible = false;
    this.apparatus.group.visible = false;
    for (const body of this.bodies.values()) body.visible = false;
    const self = world.player;
    if (
      !gliderCourseVisible(world.worldQuestLog.get(GLIDER_QUEST_ID)) &&
      rewardGliderVisible(self)
    ) {
      this.pose(this.apparatus.group, self, dt, renderedSelf);
    } else this.sampled.delete(self.id);
    // Use renderer views rather than scanning the full world entity roster.
    if (views)
      for (const [id, view] of views) {
        if (id === self.id || !view.group.visible) continue;
        const entity = world.entities.get(id);
        if (!entity || !rewardGliderVisible(entity)) continue;
        let body = this.bodies.get(id);
        if (!body) {
          body = this.apparatus.group.clone(true);
          this.bodies.set(id, body);
          this.group.add(body);
        }
        this.pose(body, entity, dt, view.group);
      }
    for (const [id, body] of this.bodies) {
      if (body.visible) continue;
      body.removeFromParent();
      this.bodies.delete(id);
      this.sampled.delete(id);
    }
  }

  private pose(
    group: THREE.Group,
    entity: Entity,
    dt: number,
    rendered?: Pick<THREE.Object3D, 'position' | 'rotation'>,
  ): void {
    const pos = rendered?.position ?? entity.pos;
    const pitch = this.sampled.has(entity.id)
      ? gliderDisplayedMotionPitch(
          pos.x - group.position.x,
          pos.y + REWARD_GLIDER_HEIGHT - group.position.y,
          pos.z - group.position.z,
          dt,
        )
      : 0;
    this.sampled.add(entity.id);
    group.position.set(pos.x, pos.y + REWARD_GLIDER_HEIGHT, pos.z);
    group.rotation.order = 'YXZ';
    group.rotation.y = rendered?.rotation.y ?? entity.facing;
    group.rotation.x += (pitch - group.rotation.x) * 0.2;
    group.visible = true;
    this.group.visible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.removeFromParent();
    this.group.clear();
    this.bodies.clear();
    this.sampled.clear();
    this.apparatus.dispose();
  }
}
