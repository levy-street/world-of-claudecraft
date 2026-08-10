import * as THREE from 'three';
import type { IWorld } from '../world_api';

const MAX_STAGES = 5;

interface HostView {
  group: THREE.Group;
  height: number;
}

interface PactMarker {
  host: THREE.Group;
  group: THREE.Group;
  shards: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  phase: number;
}

export function burningPactStages(
  entity: Pick<IWorld['player'], 'auras'>,
  ownerId: number,
): number {
  const pact = entity.auras.find(
    (aura) =>
      aura.id === 'immolate' &&
      aura.kind === 'dot' &&
      aura.sourceId === ownerId &&
      aura.remaining > 0,
  );
  if (!pact) return 0;
  const interval = Math.max(0.1, pact.tickInterval ?? 3);
  return Math.max(1, Math.min(MAX_STAGES, Math.ceil(pact.remaining / interval)));
}

/**
 * Five fel-ember knots make Burning Pact's remaining periodic value visible.
 * A natural tick and Conflagrate's advanced tick each extinguish one knot.
 */
export class BurningPactMarkers {
  private readonly markers = new Map<number, PactMarker>();
  private readonly shardGeometry = new THREE.OctahedronGeometry(0.16, 0);
  private readonly haloGeometry = new THREE.TorusGeometry(0.72, 0.025, 6, 48);

  private removeMarker(id: number): void {
    const marker = this.markers.get(id);
    if (!marker) return;
    marker.group.removeFromParent();
    marker.halo.material.dispose();
    for (const shard of marker.shards) shard.material.dispose();
    this.markers.delete(id);
  }

  update(world: IWorld, views: ReadonlyMap<number, HostView>, reducedMotion = false): void {
    for (const [id, marker] of this.markers) {
      const entity = world.entities.get(id);
      const view = views.get(id);
      if (
        !entity ||
        !view ||
        view.group !== marker.host ||
        burningPactStages(entity, world.playerId) === 0
      ) {
        this.removeMarker(id);
      }
    }

    for (const [id, view] of views) {
      const entity = world.entities.get(id);
      if (!entity) continue;
      const stages = burningPactStages(entity, world.playerId);
      if (stages === 0) continue;
      let marker = this.markers.get(id);
      if (!marker) {
        marker = this.createMarker(view.group, id);
        this.markers.set(id, marker);
      }
      const hostScale = Math.max(0.01, entity.scale);
      marker.group.position.y = view.height * 0.48;
      marker.group.scale.setScalar(1 / hostScale);
      marker.shards.forEach((shard, index) => {
        shard.visible = index < stages;
      });
    }

    const time = performance.now() / 1000;
    for (const marker of this.markers.values()) {
      const pulse = reducedMotion ? 1 : 0.9 + Math.sin((time + marker.phase) * 4.2) * 0.1;
      marker.halo.rotation.set(
        reducedMotion ? Math.PI / 2 : Math.PI / 2 + Math.sin(time * 0.8 + marker.phase) * 0.08,
        reducedMotion ? 0 : time * 0.35 + marker.phase,
        0,
      );
      marker.halo.material.opacity = 0.34 * pulse;
      marker.shards.forEach((shard, index) => {
        if (!shard.visible) return;
        const angle =
          (index / MAX_STAGES) * Math.PI * 2 + (reducedMotion ? 0 : time * 0.7 + marker.phase);
        const radius = 0.7 + (index % 2) * 0.08;
        shard.position.set(
          Math.cos(angle) * radius,
          0.08 + Math.sin(angle * 2 + index) * 0.12,
          Math.sin(angle) * radius,
        );
        shard.rotation.set(
          reducedMotion ? 0.5 : time * 1.2 + index,
          reducedMotion ? index : -time * 1.5 + index * 0.8,
          0.35,
        );
        shard.scale.setScalar(pulse);
        shard.material.opacity = (0.62 + index * 0.055) * pulse;
      });
    }
  }

  clear(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
  }

  private createMarker(host: THREE.Group, id: number): PactMarker {
    const group = new THREE.Group();
    group.name = 'burning-pact-stages';
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x59f044,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(this.haloGeometry, haloMaterial);
    halo.name = 'burning-pact-halo';
    halo.renderOrder = 8;
    group.add(halo);

    const shards: PactMarker['shards'] = [];
    for (let index = 0; index < MAX_STAGES; index++) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? 0x7aff42 : 0xffa53a,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const shard = new THREE.Mesh(this.shardGeometry, material);
      shard.name = `burning-pact-stage-${index + 1}`;
      shard.renderOrder = 8;
      shards.push(shard);
      group.add(shard);
    }
    host.add(group);
    return { host, group, shards, halo, phase: (id % 11) * 0.37 };
  }
}
