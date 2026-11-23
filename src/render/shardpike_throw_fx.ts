import * as THREE from 'three';
import { LANCE_THROW_ABILITY, LANCE_THROW_DURATION } from '../sim/lance_throw_timing';
import type { IWorld } from '../world_api';
import type { AbilityVfxFx } from './ability_vfx/fx';
import type { ShardpikeProp } from './characters/shardpike_prop';
import type { CharacterVisual } from './characters/visual';
import {
  advanceShardpikeFlight,
  SHARDPIKE_TRAIL_INTERVAL,
  shardpikeFlightExpired,
  shardpikeTrailDue,
} from './shardpike_throw_core';

const TEAL = 0x65e8d3;
const WHITE = 0xe2fff5;
const MAX_THROWS = 24;
interface Flight {
  sourceId: number;
  targetId: number;
  age: number;
  carry: number;
  at: THREE.Vector3;
  previous: THREE.Vector3;
  prop: ShardpikeProp | null;
}

/** Raid-readable spear silhouette, teal wake and a concentrated shattering contact.
 * All energy layers borrow the existing prewarmed, capped ability pools. The
 * physical spear reuses a visible held mesh's program and never creates a light.
 * Only the server's impact cue plays the collision, including for observers. */
export class ShardpikeThrowFx {
  private readonly flights = new Map<number, Flight>();
  private readonly aim = new THREE.Vector3();
  private readonly windups = new Map<number, { age: number; targetId: number }>();
  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: () => IWorld,
    private readonly visual: (id: number) => CharacterVisual | null,
    private readonly fx: AbilityVfxFx,
    private readonly ready: () => boolean,
    private readonly camera: THREE.Camera,
  ) {}

  handleEvent(event: {
    ability?: string;
    sourceId: number;
    targetId: number;
    fx: string;
  }): boolean {
    if (event.ability !== LANCE_THROW_ABILITY) return false;
    const { sourceId, targetId } = event;
    if (event.fx === 'windup') {
      this.retire(sourceId);
      this.visual(sourceId)?.playAttack(LANCE_THROW_ABILITY);
      if (this.windups.size < MAX_THROWS) this.windups.set(sourceId, { age: 0, targetId });
    } else if (event.fx === 'projectile') {
      this.windups.delete(sourceId);
      this.retire(sourceId);
      if (this.flights.size >= MAX_THROWS) return true;
      const source = this.world().entities.get(sourceId);
      if (!source) return true;
      const prop = this.visual(sourceId)?.releaseShardpikeProp() ?? null;
      const at =
        prop?.sampleTip(new THREE.Vector3()) ??
        new THREE.Vector3(source.pos.x, source.pos.y + 1.3, source.pos.z);
      if (prop) this.scene.add(prop.root);
      this.flights.set(sourceId, {
        sourceId,
        targetId,
        age: 0,
        carry: 0,
        at,
        previous: at.clone(),
        prop,
      });
      if (this.ready()) {
        this.fx.flipbookAt(at.x, at.y, at.z, 0.65, WHITE, 'radiance', 1.8, 0.12);
        this.fx.burstAt(at.x, at.y, at.z, TEAL, 12, 0.65, 'sparks', 0.2);
        this.fx.abilityAudio('release', 'physical', 1.1, at.x, at.y, at.z, {
          abilityId: LANCE_THROW_ABILITY,
          archetype: 'bolt',
        });
      }
    } else if (event.fx === 'ccImpact') {
      this.retire(sourceId);
      if (this.anchor(targetId, this.aim) && this.ready()) this.impact(this.aim);
    }
    return true;
  }

  update(dt: number, reducedMotion: boolean): void {
    for (const [id, windup] of this.windups) {
      windup.age += dt;
      if (windup.age > LANCE_THROW_DURATION || this.world().entities.get(id)?.dead) {
        this.windups.delete(id);
        continue;
      }
      if (this.ready()) this.fx.bodyGlow(id, TEAL, 0.15, false);
    }
    for (const flight of this.flights.values()) {
      flight.age += dt;
      const source = this.world().entities.get(flight.sourceId);
      const target = this.world().entities.get(flight.targetId);
      if (
        shardpikeFlightExpired(flight.age, !!source && !source.dead, !!target && !target.dead) ||
        (flight.prop && !flight.prop.isUsable()) ||
        !this.anchor(flight.targetId, this.aim)
      ) {
        this.retire(flight.sourceId);
        continue;
      }
      advanceShardpikeFlight(flight.at, this.aim, dt);
      if (flight.prop) {
        flight.prop.moveTip(flight.at, this.aim);
      }
      flight.carry += dt;
      if (this.ready() && shardpikeTrailDue(flight.carry)) {
        flight.carry %= SHARDPIKE_TRAIL_INTERVAL;
        const from = flight.previous,
          to = flight.at;
        this.fx.pathRibbon(TEAL, reducedMotion ? 0.035 : 0.12, 0.18, (pts) => {
          pts[0].set(from.x, from.y, from.z);
          pts[1].set(to.x, to.y, to.z);
          return 2;
        });
        if (!reducedMotion) {
          this.fx.burstAt(to.x, to.y, to.z, TEAL, 2, 0.15, 'sparks', 0.18);
          this.fx.flipbookAt(to.x, to.y, to.z, 0.35, WHITE, 'radiance', 1.5, 0.07);
        }
        flight.previous.copy(flight.at);
      }
    }
  }

  private anchor(id: number, out: THREE.Vector3): boolean {
    const visual = this.visual(id);
    if (visual?.sampleEyeAnchor(out)) return true;
    const entity = this.world().entities.get(id);
    if (!entity) return false;
    out.set(
      entity.pos.x,
      entity.pos.y + (visual?.height ?? 2) * (entity.scale ?? 1) * 0.8,
      entity.pos.z,
    );
    return true;
  }
  private impact(at: THREE.Vector3): void {
    // Pull the energy layer just off the stone surface. A camera-facing sheet
    // centered in the socket is otherwise almost entirely buried in the skull.
    // The physical spear still terminates at the exact eye anchor.
    const dx = this.camera.position.x - at.x;
    const dy = this.camera.position.y - at.y;
    const dz = this.camera.position.z - at.z;
    const distance = Math.hypot(dx, dy, dz);
    const lift = distance > 0.001 ? 0.7 / distance : 0;
    const x = at.x + dx * lift,
      y = at.y + dy * lift,
      z = at.z + dz * lift;
    this.fx.flipbookAt(x, y, z, 4.2, WHITE, 'shatter', 3.6, 0.3);
    this.fx.flipbookAt(x, y, z, 1.8, WHITE, 'radiance', 2.6, 0.12);
    this.fx.ringAt(x, y, z, 3.2, 0.32, TEAL, 2, true);
    this.fx.burstAt(x, y, z, TEAL, 32, 2.6, 'sparks', 0.45);
    this.fx.burstAt(x, y, z, 0x8a9a91, 10, 1.8, 'debris', 0.55);
    this.fx.worldLightAt(x, y, z, 'nature', 2.2, 0.16);
    this.fx.shakeAt(x, y, z, 0.13, true);
    this.fx.abilityAudio('impact', 'physical', 1.3, x, y, z, { abilityId: LANCE_THROW_ABILITY });
  }
  private retire(id: number): void {
    this.flights.get(id)?.prop?.dispose();
    this.flights.delete(id);
  }
  dispose(): void {
    for (const id of this.flights.keys()) this.retire(id);
    this.windups.clear();
  }
}
