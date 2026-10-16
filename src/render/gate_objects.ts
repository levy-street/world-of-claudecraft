// Object views for gate entities: the Ignivar raid's herald and lift gates
// (ignivar_raid_gate.ts), the in-dungeon gates and seals of an authored
// field (sim/instances/dungeon_gates.ts), and the encounter objects a
// dungeon draws itself (render/sunken_bastion/bastion_boss_fx.ts). One plan,
// one builder, one call site in the renderer's view pipeline.
//
// An in-dungeon gate's STRUCTURE (the portcullis, the bone bridge, the ward)
// is part of the interior and animates there; its entity view is an empty
// anchor that reports the state it mirrors to the gate memory
// (hollow_crypt/crypt_gate_state_core.ts), so every template swap the view
// pipeline rebuilds on becomes a reveal instead of a pop.

import * as THREE from 'three';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../sim/data';
import { TEMPLE_OBJECT_TEMPLATES } from '../sim/encounters/drowned_temple/ids';
import { SANCTUM_OBJECT_TEMPLATES } from '../sim/encounters/gravewyrm_sanctum/ids';
import { CRYPT_OBJECT_TEMPLATES } from '../sim/encounters/hollow_crypt/ids';
import { BASTION_OBJECT_TEMPLATES } from '../sim/encounters/sunken_bastion/ids';
import { dungeonGateAt, dungeonGateStateOf } from '../sim/instances/dungeon_gates';
import { DEATH_BURST_RING } from '../sim/mob/trash_kit/death_burst';
import { sharedUniforms } from './gfx';
import { observeSanctumStoryMarker } from './gravewyrm_sanctum/sanctum_story_core';
import { gateMemoryKey, observeGate } from './hollow_crypt/crypt_gate_state_core';
import { isStableIgnivarWaterConduitTransition } from './ignivar_conduit';
import {
  buildIgnivarRaidGate,
  type IgnivarRaidGatePlan,
  ignivarRaidGatePlan,
} from './ignivar_raid_gate';
import { isTrashEngineObject } from './trash_engine_fx/trash_engine_fx_core';

export interface DungeonGateAnchorPlan {
  dungeonGate: true;
  key: string;
  templateId: string;
  height: number;
}

/** An encounter object the dungeon's own visuals draw from the world (the
 *  Sunken Bastion's buttresses, mooring posts, beacon lamp and wakes): its
 *  view is an empty anchor, so no default object mesh stands in for it. */
export interface EncounterAnchorPlan {
  encounterAnchor: true;
  height: number;
}

export type GateObjectPlan = IgnivarRaidGatePlan | DungeonGateAnchorPlan | EncounterAnchorPlan;

interface GateEntityLike {
  templateId: string;
  dungeonId: string | null;
  pos: { x: number; z: number };
}

/** The gate view plan for an object entity, or null when it is no gate. */
export function gateObjectPlan(e: GateEntityLike): GateObjectPlan | null {
  const raid = ignivarRaidGatePlan(e.templateId, e.dungeonId);
  if (raid) return raid;
  if (BASTION_OBJECT_TEMPLATES.has(e.templateId)) return { encounterAnchor: true, height: 4 };
  if (TEMPLE_OBJECT_TEMPLATES.has(e.templateId)) return { encounterAnchor: true, height: 2 };
  if (CRYPT_OBJECT_TEMPLATES.has(e.templateId)) return { encounterAnchor: true, height: 2 };
  // A trash-kit death burst's ring: drawn from the world (death_burst_fx.ts).
  if (e.templateId === DEATH_BURST_RING) return { encounterAnchor: true, height: 2 };
  // The trash engine's objects (hazard pools, combat walls, walker orbs): drawn
  // from the world by ./trash_engine_fx, which builds the wall to its collider.
  if (isTrashEngineObject(e.templateId)) return { encounterAnchor: true, height: 2 };
  // The Sanctum's patches, toss rings and story markers (the Calving Face reads
  // the markers' crack step; render/gravewyrm_sanctum).
  if (SANCTUM_OBJECT_TEMPLATES.has(e.templateId)) {
    // A story marker's view reports its crack step to the face's memory (a
    // template swap rebuilds the view, so every rise is seen here).
    observeSanctumStoryMarker(e, sharedUniforms.uTime.value);
    return { encounterAnchor: true, height: 2 };
  }
  if (dungeonGateStateOf(e.templateId) === null || !e.dungeonId) return null;
  const def = DUNGEONS[e.dungeonId];
  if (!def) return null;
  const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
  const gate = dungeonGateAt(e.dungeonId, e.pos.x - o.x, e.pos.z - o.z);
  if (!gate) return null;
  return {
    dungeonGate: true,
    key: gateMemoryKey(o.x, o.z, gate.id),
    templateId: e.templateId,
    height: 8,
  };
}

/** A template swap the object's view survives as it stands (no rebuild): the
 *  Ignivar conduit's own stable pairs (a rebuild would only flash the view's
 *  stand-in plate). A Sanctum story marker's step change DOES rebuild
 *  its empty anchor: the rebuild is what reports the new crack step to the
 *  Calving Face's memory (gravewyrm_sanctum/sanctum_story_core.ts). */
export function isStableObjectTransition(from: string, to: string): boolean {
  return isStableIgnivarWaterConduitTransition(from, to);
}

/** Build the view body for a gate plan. */
export function buildGateObject(plan: GateObjectPlan): THREE.Group {
  if ('encounterAnchor' in plan) {
    const anchor = new THREE.Group();
    anchor.name = 'encounterObjectAnchor';
    return anchor;
  }
  if ('dungeonGate' in plan) {
    observeGate(plan.key, plan.templateId, sharedUniforms.uTime.value);
    const anchor = new THREE.Group();
    anchor.name = 'dungeonGateAnchor';
    return anchor;
  }
  return buildIgnivarRaidGate(plan);
}
