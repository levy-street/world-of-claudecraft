// Fishing bobber visual (Professions 2.0): a small procedural float
// on the water ahead of any entity whose castingAbility is the fishing
// sentinel, so bystanders see who is fishing. The renderer composes one
// instance and drives it per frame; the personal fishingBite SimEvent flips
// the owning player's bobber into the bite state. Bite and sink events disturb
// the shared persistent surface, so feedback remains visible without a
// per-angler transparent ring draw. Graphics-preset-identical on purpose: the
// bobber and bite state are player-actionable feedback, so nothing here reads
// GFX tiers or the frame-budget governor.
import * as THREE from 'three';
import { type Entity, FISHING_CAST_ID } from '../sim/types';
import { type BobberAnchor, bobberAnchorInto } from './fishing_bobber_core';
import { surfaceMat } from './gfx';

const IDLE_BOB_AMPLITUDE = 0.05;
const IDLE_BOB_SPEED = 2.2;
const BITE_DUNK_DEPTH = 0.16;
const BITE_JITTER_AMPLITUDE = 0.09;
const BITE_JITTER_SPEED = 14;
const SPLASH_PERIOD = 0.55;
const SINK_DURATION = 0.35;

interface BobberInstance {
  group: THREE.Group;
  phase: number;
  biting: boolean;
  splashT: number;
  /** seconds left of the sink-out despawn; 0 while the cast is live */
  sinkT: number;
}

let sharedBodyGeo: THREE.SphereGeometry | null = null;
let sharedTipGeo: THREE.SphereGeometry | null = null;

function bodyGeometry(): THREE.SphereGeometry {
  if (!sharedBodyGeo) sharedBodyGeo = new THREE.SphereGeometry(0.11, 10, 8);
  return sharedBodyGeo;
}

function tipGeometry(): THREE.SphereGeometry {
  if (!sharedTipGeo) sharedTipGeo = new THREE.SphereGeometry(0.075, 10, 8);
  return sharedTipGeo;
}

const scratchAnchor: BobberAnchor = { x: 0, y: 0, z: 0 };

export class FishingBobberVisual {
  private instances = new Map<number, BobberInstance>();
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private onSplash?: (x: number, z: number, radius: number, strength: number) => void,
  ) {}

  /** Switch an angler's current bobber into the actionable bite state. */
  bite(entityId: number): void {
    const inst = this.instances.get(entityId);
    if (inst && inst.sinkT <= 0) {
      inst.biting = true;
      inst.splashT = 0;
      this.onSplash?.(inst.group.position.x, inst.group.position.z, 0.34, 0.65);
    }
  }

  update(dt: number, entities: ReadonlyMap<number, Entity>, seed: number): void {
    this.time += dt;
    for (const [id, e] of entities) {
      if (e.dead || e.castingAbility !== FISHING_CAST_ID) continue;
      let inst = this.instances.get(id);
      if (!inst) {
        inst = this.spawn(id);
        this.instances.set(id, inst);
      }
      inst.sinkT = 0;
      if (!bobberAnchorInto(scratchAnchor, e.pos.x, e.pos.z, e.facing, seed)) {
        inst.group.visible = false;
        continue;
      }
      inst.group.visible = true;
      inst.group.position.set(scratchAnchor.x, scratchAnchor.y, scratchAnchor.z);
      this.animate(inst, dt);
    }

    for (const [id, inst] of this.instances) {
      const e = entities.get(id);
      const live = e !== undefined && !e.dead && e.castingAbility === FISHING_CAST_ID;
      if (live) continue;
      if (inst.sinkT <= 0) {
        inst.sinkT = SINK_DURATION;
        inst.biting = false;
        this.onSplash?.(inst.group.position.x, inst.group.position.z, 0.3, 0.35);
      }
      inst.sinkT -= dt;
      if (inst.sinkT <= 0 || !inst.group.visible) {
        this.dispose(id, inst);
        continue;
      }
      const k = inst.sinkT / SINK_DURATION;
      inst.group.position.y -= dt * 1.2;
      inst.group.scale.setScalar(Math.max(0.2, k));
    }
  }

  private spawn(id: number): BobberInstance {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry(), surfaceMat({ color: 0xf5f0e6, roughness: 0.5 }));
    const tip = new THREE.Mesh(tipGeometry(), surfaceMat({ color: 0xc93a2e, roughness: 0.5 }));
    tip.position.y = 0.1;
    group.add(body, tip);
    this.scene.add(group);
    return {
      group,
      phase: (id % 17) * 0.37,
      biting: false,
      splashT: 0,
      sinkT: 0,
    };
  }

  private animate(inst: BobberInstance, dt: number): void {
    inst.group.scale.setScalar(1);
    if (inst.biting) {
      inst.group.position.y +=
        -BITE_DUNK_DEPTH +
        Math.sin(this.time * BITE_JITTER_SPEED + inst.phase) * BITE_JITTER_AMPLITUDE;
      inst.splashT += dt;
      if (inst.splashT >= SPLASH_PERIOD) {
        inst.splashT %= SPLASH_PERIOD;
        this.onSplash?.(inst.group.position.x, inst.group.position.z, 0.3, 0.38);
      }
    } else {
      inst.group.position.y +=
        0.02 + Math.sin(this.time * IDLE_BOB_SPEED + inst.phase) * IDLE_BOB_AMPLITUDE;
    }
  }

  private dispose(id: number, inst: BobberInstance): void {
    this.scene.remove(inst.group);
    this.instances.delete(id);
  }
}
