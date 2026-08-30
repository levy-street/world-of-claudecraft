// The Proving Shore's render-side guidance coordinator: one per-frame memo
// over the island rail (beacon NPC ids + the golden trail plan + the target
// NPC), the beacon fizz on rail NPCs, and the CoachTrail visual it drives.
// Extracted whole from renderer.ts (the monolith ratchet): the renderer
// keeps two one-line call sites, one in the entity loop's NPC branch and
// one beside the raceLine update.
//
// Off the shore every memo slot goes empty, so the rail's seven questState
// reads (each an options-object plus attunement-copy allocation online)
// never run per frame for mainland players.

import type * as THREE from 'three';
import { isOnProvingShore } from '../sim/content/proving_shore';
import { CRAB_MOB_ID } from '../sim/interactions/crab_summon';
import { isObjectOpenedByViewer } from '../sim/quests/opened_object_view';
import { CoachTrail, type CoachTrailCompileGate } from './coach_trail';
import { type CoachGuideReader, type CoachGuides, coachGuides } from './coach_trail_core';
import { beaconNpcIds } from './quest_beacon_core';

// The off-island beacon answer, shared so the per-frame memo never
// allocates away from the shore.
const EMPTY_BEACON_IDS: ReadonlySet<string> = new Set();

/** The world facets this coordinator reads each frame. */
export interface GuideWorld extends CoachGuideReader {
  player:
    | {
        pos: { x: number; z: number };
        /** Ghost state and the body it walks back to: the death lesson's
         *  route (coach_trail_core corpse-run arm) is read from these. */
        ghost?: boolean;
        corpsePos?: { x: number; z: number } | null;
      }
    | null
    | undefined;
  entities: ReadonlyMap<
    number,
    {
      kind: string;
      /** The mob template, for the pearl detour's corpse beam. */
      templateId?: string;
      objectItemId?: string | null;
      dead?: boolean;
      pos: { x: number; z: number };
    }
  >;
}

/** The crate haul's live ground objects (entity.ts createGroundObject). */
const CRATE_OBJECT_ITEM_ID = 'ps_castaway_crate';

interface SparkleVfx {
  castSparkle(entityId: number, school: string, dt: number, color?: number): void;
}

const GOLD_FIZZ = 0xffd766;

export class IslandGuidance {
  private beaconIds: ReadonlySet<string> = EMPTY_BEACON_IDS;
  private guides: CoachGuides | null = null;
  private timeKey = -1;
  private readonly trail: CoachTrail;

  constructor(
    scene: THREE.Object3D,
    groundAt: (x: number, z: number) => number,
    compileGate?: CoachTrailCompileGate,
  ) {
    this.trail = new CoachTrail(scene, groundAt, compileGate);
  }

  /** The per-frame island memo, resolvable from either call site. */
  private frame(world: GuideWorld, time: number): void {
    if (this.timeKey === time) return;
    this.timeKey = time;
    const p = world.player;
    const ashore = !!p && isOnProvingShore(p.pos.x, p.pos.z);
    this.beaconIds = ashore ? beaconNpcIds(world) : EMPTY_BEACON_IDS;
    // The ghost's own body is part of the read: while dead, the route the
    // island paints is the walk back to it (coach_trail_core corpse-run arm).
    this.guides = ashore
      ? coachGuides({
          questState: (id) => world.questState(id),
          questLog: world.questLog,
          playerPos: p ? { x: p.pos.x, z: p.pos.z } : undefined,
          corpsePos: p?.ghost && p.corpsePos ? { x: p.corpsePos.x, z: p.corpsePos.z } : null,
        })
      : null;
  }

  /** The rail NPCs' go-here-next fizz: gentle holy sparkle over every beacon
   *  NPC, denser and gold over the rail's CURRENT target (coach_trail_core
   *  picks them; the trail rings their feet). Call from the entity loop's
   *  NPC branch. */
  npcFizz(
    world: GuideWorld,
    e: { id: number; templateId: string },
    vfx: SparkleVfx,
    time: number,
    dt: number,
  ): void {
    this.frame(world, time);
    if (!this.beaconIds.has(e.templateId)) return;
    const gold = e.templateId === this.guides?.glowNpcId;
    vfx.castSparkle(e.id, 'holy', dt * (gold ? 3.0 : 2.0), gold ? GOLD_FIZZ : undefined);
  }

  /** Drive the trail ribbon, the target aura/ring, and the objective beam;
   *  call once per render frame (actionable guidance, identical on every
   *  graphics tier). */
  update(world: GuideWorld, time: number, dt: number): void {
    this.frame(world, time);
    const g = this.guides;
    let beamAt = g?.beamAt ?? null;
    if (!beamAt && g?.beamAtNearestCrate) beamAt = nearestLiveCrate(world);
    // The king down but unlooted: the beam leaves the pool and stands on his
    // shell, so the prize is the thing lit up rather than the water he was
    // called out of.
    if (g?.beamAtCrabCorpse) beamAt = nearestCrabCorpse(world) ?? beamAt;
    this.trail.update(
      g?.plan ?? null,
      g?.glowNpcPos ?? null,
      beamAt,
      g?.areaRing ?? null,
      time,
      dt,
    );
  }
}

/** The king's corpse, the pearl detour's beam anchor once he is down. Null
 *  while nothing of his lies on the sand, which puts the beam back on the
 *  tide pool where the summon happens. */
function nearestCrabCorpse(world: GuideWorld): { x: number; z: number } | null {
  const p = world.player;
  if (!p) return null;
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of world.entities.values()) {
    if (e.kind !== 'mob' || e.templateId !== CRAB_MOB_ID || !e.dead) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e.pos;
    }
  }
  return best;
}

/** The nearest live castaway crate the player has NOT already opened, the
 *  crate haul's beam anchor (crates despawn between respawns and a credited
 *  crate is gone for this viewer, so this follows both). */
function nearestLiveCrate(world: GuideWorld): { x: number; z: number } | null {
  const p = world.player;
  if (!p) return null;
  let best: { x: number; z: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const e of world.entities.values()) {
    if (e.kind !== 'object' || e.objectItemId !== CRATE_OBJECT_ITEM_ID || e.dead) continue;
    if (isObjectOpenedByViewer(e, world.questLog)) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e.pos;
    }
  }
  return best;
}
