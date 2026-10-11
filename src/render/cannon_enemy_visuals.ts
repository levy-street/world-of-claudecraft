// Private, gait-only actors. Prepare the bounded pool under the entry cover;
// spawning and retiring enemies never constructs rigs or transfers one-shots.
import * as THREE from 'three';
import { CANNON_ACTIONS, CANNON_ENEMIES } from '../sim/content/cannon_encounter';
import { cannonMarchMultiplier } from '../sim/minigames/cannon_tactics';
import type { CannonEnemyKind, VehicleSession } from '../sim/types';
import { type AnimState, CharacterVisual } from './characters';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

// Conservative simultaneous occupancy at permanent grapeshot slow, pinned
// against the wave schedule. Living actors take priority over cosmetic corpses.
export const CANNON_ENEMY_LOOKS = {
  infantry: { key: 'mob_bandit', capacity: 27, scale: 1 },
  runner: { key: 'mob_bandit', capacity: 9, scale: 0.9 },
  armored: { key: 'player_warrior', capacity: 12, scale: 1.15 },
  commander: { key: 'npc_knight', capacity: 1, scale: 1.5 },
  sapper: { key: 'mob_bruiser', capacity: 2, scale: 0.95 },
} as const;

export class CannonEnemyVisuals {
  readonly root = new THREE.Group();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly ring = new THREE.RingGeometry(0.86, 1, 32);
  private readonly slots: ReturnType<CannonEnemyVisuals['createSlot']>[] = [];
  private readonly pose: AnimState = {
    speed: 0,
    moving: true,
    running: false,
    airborne: false,
    backwards: false,
    dead: false,
    casting: false,
    swimming: false,
    submerged: false,
    swimPitch: 0,
    wading: false,
    sitting: false,
  };

  constructor(private readonly barrelTemplate?: THREE.Object3D) {
    this.root.name = 'cannon-enemies';
    try {
      for (const kind of Object.keys(CANNON_ENEMY_LOOKS) as CannonEnemyKind[]) {
        for (let i = 0; i < CANNON_ENEMY_LOOKS[kind].capacity; i++) {
          this.slots.push(this.createSlot(kind));
        }
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private createSlot(kind: CannonEnemyKind) {
    const look = CANNON_ENEMY_LOOKS[kind];
    const actor = new CharacterVisual(look.key, 0x963c32);
    actor.setShadow(false);
    actor.setProxyShadow(false);
    const root = new THREE.Group();
    root.name = `cannon-${kind}`;
    root.scale.setScalar(look.scale);
    root.add(actor.root);
    const materials = worldQuestTraceMaterials();
    const health = new THREE.Mesh(this.box, materials.green);
    health.position.y = actor.height + 0.3;
    const slow = new THREE.Mesh(this.ring, materials.blue);
    slow.rotation.x = -Math.PI / 2;
    slow.position.y = 0.12;
    root.add(health, slow);
    const badge = new THREE.Mesh(this.box, kind === 'sapper' ? materials.red : materials.gold);
    badge.position.set(0, actor.height + 0.65, 0);
    badge.scale.set(kind === 'sapper' ? 0.18 : 0.7, kind === 'sapper' ? 0.65 : 0.18, 0.15);
    root.add(badge);
    if (kind === 'sapper' && this.barrelTemplate) {
      const pack = this.barrelTemplate.clone(true);
      pack.scale.multiplyScalar(0.45);
      pack.position.set(0, 0.9, -0.45);
      actor.root.add(pack);
    }
    const shields: THREE.Object3D[] = [];
    if (kind === 'armored')
      actor.root.traverse((node) => {
        if (node.name.toLowerCase().includes('shield') && (node as THREE.Mesh).isMesh)
          shields.push(node);
      });
    this.root.add(root);
    return {
      kind,
      id: null as number | null,
      actor,
      root,
      health,
      slow,
      badge,
      shields,
      retiredAt: -1,
    };
  }

  update(
    session: VehicleSession | null | undefined,
    dt: number,
    groundAt: (x: number, z: number) => number,
    reducedMotion = false,
  ): void {
    const state = session?.encounter;
    // Release first, then assign by stable ID, not snapshot array position.
    for (const slot of this.slots) {
      if (!state?.enemies.some((e) => e.id === slot.id && e.kind === slot.kind)) {
        const death = state?.feedback.find((e) => e.kind === 'death' && e.enemyId === slot.id);
        if (state && death && slot.id !== null && !reducedMotion) {
          if (slot.retiredAt < 0) slot.retiredAt = state.tick;
          const age = state.tick - slot.retiredAt;
          if (age < 12) {
            slot.root.rotation.x = (-Math.min(1, age / 5) * Math.PI) / 2;
            slot.health.visible = slot.slow.visible = slot.badge.visible = false;
            continue;
          }
        }
        slot.id = null;
        slot.retiredAt = -1;
        slot.root.visible = false;
      }
    }
    if (!state) return;
    for (const enemy of state.enemies) {
      const slot =
        this.slots.find((s) => s.id === enemy.id && s.kind === enemy.kind) ??
        this.slots.find((s) => s.id === null && s.kind === enemy.kind) ??
        this.slots.find((s) => s.retiredAt >= 0 && s.kind === enemy.kind);
      if (!slot) continue; // Wire and authored occupancy are separately bounded.
      slot.id = enemy.id;
      slot.retiredAt = -1;
      slot.root.rotation.x = 0;
      slot.health.visible = true;
      slot.badge.visible =
        enemy.kind === 'sapper' ||
        enemy.kind === 'armored' ||
        (enemy.kind === 'commander' && state.commanderCharging);
      slot.badge.material = enemy.armorBroken
        ? worldQuestTraceMaterials().red
        : enemy.kind === 'sapper'
          ? worldQuestTraceMaterials().red
          : worldQuestTraceMaterials().gold;
      for (const shield of slot.shields) shield.visible = !enemy.armorBroken;
      slot.root.userData.enemyId = enemy.id;
      slot.root.visible = true;
      slot.root.position.set(enemy.x, groundAt(enemy.x, enemy.z), enemy.z);
      const slowed = enemy.slowUntilTick > state.tick;
      slot.slow.visible = slowed;
      slot.health.scale.set(Math.max(0, enemy.hp / CANNON_ENEMIES[enemy.kind].hp), 0.12, 0.12);
      this.pose.running =
        enemy.kind === 'runner' ||
        enemy.kind === 'sapper' ||
        (state.commanderCharging && !state.commanderKilled);
      this.pose.speed =
        (CANNON_ENEMIES[enemy.kind].speed *
          cannonMarchMultiplier(state, enemy.kind) *
          (slowed ? CANNON_ACTIONS.grapeshot.slowMultiplier : 1)) /
        CANNON_ENEMY_LOOKS[enemy.kind].scale;
      slot.actor.update(Math.max(0, Math.min(dt, 0.1)), this.pose, true, reducedMotion);
    }
  }

  dispose(): void {
    for (const slot of this.slots) slot.actor.dispose();
    this.slots.length = 0;
    this.root.removeFromParent();
    this.box.dispose();
    this.ring.dispose();
  }
}
