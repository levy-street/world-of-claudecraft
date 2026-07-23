// Fishing bobber visual (Professions 2.0): a small procedural float
// on the water ahead of any entity whose castingAbility is the fishing
// sentinel, so bystanders see who is fishing. The renderer composes one
// instance and drives it per frame; the personal fishingBite SimEvent flips
// the owning player's bobber into the bite state (frantic dunk + splash
// rings), the visible half of the bite moment (the cue is the audible half;
// never sound-only). Graphics-preset-identical on purpose: the bobber and the
// bite state are player-actionable feedback, so nothing here reads GFX tiers
// or the frame-budget governor.
import * as THREE from 'three';
import { type Entity, FISHING_CAST_ID } from '../sim/types';
import { type BobberAnchor, bobberAnchorInto } from './fishing_bobber_core';
import { surfaceMat } from './gfx';

// Idle bob: a gentle float. Bite: a hard dunk with a fast jitter the player
// can spot from the corner of the eye, plus expanding splash rings.
const IDLE_BOB_AMPLITUDE = 0.05;
const IDLE_BOB_SPEED = 2.2;
const BITE_DUNK_DEPTH = 0.16;
const BITE_JITTER_AMPLITUDE = 0.09;
const BITE_JITTER_SPEED = 14;
const SPLASH_RING_PERIOD = 0.55; // seconds per expanding ring while biting
const SINK_DURATION = 0.35; // cast-end despawn: slip under the surface

interface BobberInstance {
  group: THREE.Group;
  splash: THREE.Mesh;
  splashMat: THREE.MeshBasicMaterial;
  phase: number;
  biting: boolean;
  splashT: number;
  /** seconds left of the sink-out despawn; 0 while the cast is live */
  sinkT: number;
}

let sharedBodyGeo: THREE.SphereGeometry | null = null;
let sharedTipGeo: THREE.SphereGeometry | null = null;
let sharedRingGeo: THREE.RingGeometry | null = null;

function bodyGeometry(): THREE.SphereGeometry {
  if (!sharedBodyGeo) sharedBodyGeo = new THREE.SphereGeometry(0.11, 10, 8);
  return sharedBodyGeo;
}

function tipGeometry(): THREE.SphereGeometry {
  if (!sharedTipGeo) sharedTipGeo = new THREE.SphereGeometry(0.075, 10, 8);
  return sharedTipGeo;
}

function ringGeometry(): THREE.RingGeometry {
  if (!sharedRingGeo) sharedRingGeo = new THREE.RingGeometry(0.16, 0.24, 20);
  return sharedRingGeo;
}

// Scratch anchor the per-frame update resolves into (allocation-free; the
// selection logic itself lives in the pure core, fishing_bobber_core.ts).
const scratchAnchor: BobberAnchor = { x: 0, y: 0, z: 0 };

export class FishingBobberVisual {
  private instances = new Map<number, BobberInstance>();
  private time = 0;

  constructor(private scene: THREE.Scene) {}

  /** The personal fishingBite SimEvent: flip this angler's bobber into the
   *  bite state until the cast ends. Unknown ids are ignored (interest churn). */
  bite(entityId: number): void {
    const inst = this.instances.get(entityId);
    if (inst && inst.sinkT <= 0) {
      inst.biting = true;
      inst.splashT = 0;
    }
  }

  /** Per-frame: spawn a bobber for every visible fishing entity, animate the
   *  float/bite states, and sink-out bobbers whose cast ended. */
  update(dt: number, entities: ReadonlyMap<number, Entity>, seed: number): void {
    this.time += dt;
    for (const [id, e] of entities) {
      if (e.dead || e.castingAbility !== FISHING_CAST_ID) continue;
      let inst = this.instances.get(id);
      if (!inst) {
        inst = this.spawn(id);
        this.instances.set(id, inst);
      }
      // a fresh cast right after a sink-out revives the same instance
      inst.sinkT = 0;
      if (!bobberAnchorInto(scratchAnchor, e.pos.x, e.pos.z, e.facing, seed)) {
        inst.group.visible = false;
        continue;
      }
      inst.group.visible = true;
      inst.group.position.set(scratchAnchor.x, scratchAnchor.y, scratchAnchor.z);
      this.animate(inst, dt);
    }
    // cast over (reel, got away, cancel) or entity left interest: sink out
    for (const [id, inst] of this.instances) {
      const e = entities.get(id);
      const live = e !== undefined && !e.dead && e.castingAbility === FISHING_CAST_ID;
      if (live) continue;
      if (inst.sinkT <= 0) {
        inst.sinkT = SINK_DURATION;
        inst.biting = false;
        inst.splash.visible = false;
      }
      inst.sinkT -= dt;
      if (inst.sinkT <= 0 || !inst.group.visible) {
        this.dispose(id, inst);
        continue;
      }
      const k = inst.sinkT / SINK_DURATION; // 1 -> 0
      inst.group.position.y -= dt * 1.2;
      inst.group.scale.setScalar(Math.max(0.2, k));
    }
  }

  private spawn(id: number): BobberInstance {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry(), surfaceMat({ color: 0xf5f0e6, roughness: 0.5 }));
    const tip = new THREE.Mesh(tipGeometry(), surfaceMat({ color: 0xc93a2e, roughness: 0.5 }));
    tip.position.y = 0.1;
    // the splash ring lies flat on the water; per-instance material because
    // its opacity animates independently per bobber
    const splashMat = new THREE.MeshBasicMaterial({
      color: 0xdff3ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const splash = new THREE.Mesh(ringGeometry(), splashMat);
    splash.rotation.x = -Math.PI / 2;
    splash.position.y = 0.02;
    splash.visible = false;
    group.add(body, tip, splash);
    this.scene.add(group);
    return {
      group,
      splash,
      splashMat,
      // deterministic per-entity phase so side-by-side anglers desync bobs
      phase: (id % 17) * 0.37,
      biting: false,
      splashT: 0,
      sinkT: 0,
    };
  }

  private animate(inst: BobberInstance, dt: number): void {
    inst.group.scale.setScalar(1);
    if (inst.biting) {
      // the bite: dunked under, jittering hard, splash rings pulsing outward
      inst.group.position.y +=
        -BITE_DUNK_DEPTH +
        Math.sin(this.time * BITE_JITTER_SPEED + inst.phase) * BITE_JITTER_AMPLITUDE;
      inst.splashT += dt;
      const t = (inst.splashT % SPLASH_RING_PERIOD) / SPLASH_RING_PERIOD;
      inst.splash.visible = true;
      inst.splash.scale.setScalar(0.4 + t * 2.4);
      inst.splashMat.opacity = 0.65 * (1 - t);
    } else {
      inst.group.position.y +=
        0.02 + Math.sin(this.time * IDLE_BOB_SPEED + inst.phase) * IDLE_BOB_AMPLITUDE;
      inst.splash.visible = false;
    }
  }

  private dispose(id: number, inst: BobberInstance): void {
    this.scene.remove(inst.group);
    inst.splashMat.dispose();
    this.instances.delete(id);
  }
}
