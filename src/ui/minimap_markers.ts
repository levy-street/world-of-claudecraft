// Pure, host-agnostic marker model for the OVERWORLD minimap (the ~10Hz circular
// minimap at #minimap).
//
// The pure-core half of the pure-core + canvas-painter split (reference delve_map.ts /
// map_window_view.ts). It projects IWorld state to a DISCRIMINATED Marker union in
// canvas-pixel space (one variant per draw kind), so the painter only resolves the
// --color-minimap-* tokens + the per-class color and strokes. The IN-DELVE branch of
// the minimap is owned by delve_map.ts + delve_map_painter.ts; this core models
// only the OVERWORLD branch, plus the mode discriminator the painter switches on. The
// delve schematic is the already-extracted sibling discriminated set (SchematicPrimitive
// + SchematicArrow), so re-modeling it here would duplicate it; minimapMode names the
// boundary.
//
// CORRECTION vs the recon (verified against live source): the friend/guild/party
// membership Sets are built ONCE per call here (as the inline site did), NOT "off the
// hot path", and the entity loop (world.entities) and party loop (partyInfo.members)
// iterate DIFFERENT collections, so there is no "double-scan to collapse". Those old
// recon claims are dropped.
//
// ALLOCATION (the reused-reference proxy): build() returns the SAME { markers,
// zoneId } container every call and refills the reused markers array in place, so the
// proxy's floor (container + array reference stability) holds. The per-call marker
// variant objects ARE rebuilt: a true discriminated union (distinct shapes per kind)
// precludes a single fat reused pool slot, and at the minimap's 10Hz cadence that
// churn is negligible (the perf_tour frameP95 + longtasks is the documented backstop).
// The three membership Sets are per-call temporaries (faithful to the inline site).
//
// DOM-free / i18n-free / Three-free / deterministic so tests/minimap_markers.test.ts
// can drive it with both a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
// Markers carry the identity (the party class id) the painter resolves
// to a color, never the resolved color.

import { GATHER_NODES, isDelvePos, isYumiMazePos, QUESTS, zoneAt } from '../sim/data';
import { isQuestTurnInNpc } from '../sim/types';
import type { IWorld } from '../world_api';

// Markers beyond (S/2 - RIM_INSET) from the centre are culled (entities) or pinned to
// that rim as an arrow (party). Byte-faithful to the inline `S/2 - 7`.
const RIM_INSET = 7;
// Proximity scaling for on-map party discs: ~PARTY_DISC_MAX_RADIUS px adjacent to the
// player, shrinking to (MAX - RANGE) px near the rim. Byte-faithful to `6 - (dist/R)*3`.
const PARTY_DISC_MAX_RADIUS = 6;
const PARTY_DISC_RADIUS_RANGE = 3;

/** Which minimap surface a world renders: the delve schematic (owned by
 *  delve_map_painter), the Protect Yumi maze (the overworld marker set over a
 *  cached maze-wall background, minimap_painter.paintYumiMaze), or the
 *  overworld minimap (this core). */
export type MinimapMode = 'delve' | 'yumiMaze' | 'overworld';

/** The NPC quest glyph: turn-in ready ('?') wins over available ('!'), else neutral. */
export type NpcGlyph = '?' | '!' | '•';

/** One overworld minimap marker, in canvas-pixel space. A DISCRIMINATED union (not a
 *  flat struct): each variant carries exactly the fields its draw branch needs. */
export type MinimapMarker =
  // An online friend/guild ally who is NOT in the party (party members are the
  // party-disc/arrow variants). Strangers get no marker.
  | { kind: 'ally'; mx: number; my: number; ally: 'friend' | 'guild' }
  // A quest-giver NPC glyph.
  | { kind: 'npc'; mx: number; my: number; glyph: NpcGlyph }
  // A dungeon entrance/exit portal.
  | { kind: 'portal'; mx: number; my: number }
  // A lootable world object.
  | { kind: 'object-loot'; mx: number; my: number }
  // A live hostile mob (aggro = it is targeting the player).
  | { kind: 'mob'; mx: number; my: number; aggro: boolean }
  // A lootable corpse (mob).
  | { kind: 'mob-loot'; mx: number; my: number }
  // The local player's own body while a ghost (the corpse run target), a skull marker.
  | { kind: 'corpse'; mx: number; my: number }
  // An on-map party member: a proximity-scaled disc, class-colored, with an inner pip
  // when alive.
  | {
      kind: 'party-disc';
      mx: number;
      my: number;
      radius: number;
      cls: string;
      dead: boolean;
      pip: boolean;
    }
  // An off-map party member: an edge-pinned arrow pointing toward them.
  | { kind: 'party-arrow'; mx: number; my: number; angle: number; cls: string; dead: boolean }
  // The local player: a facing arrow at the centre.
  | { kind: 'player'; mx: number; my: number; angle: number }
  // A gatherable world node (ore/wood/herb, #1121): `ready` distinguishes
  // harvestable-for-THIS-viewer from on-cooldown-for-this-viewer (per-player,
  // see IWorldProfessions#nodeHarvestableByMe; two viewers can see opposite
  // states for the same node id).
  | { kind: 'gather-node'; mx: number; my: number; ready: boolean };

/** Everything the painter draws for one overworld minimap frame: the marker list (in
 *  draw order) plus the committed zone id (the painter localizes the #zone-label). */
export interface MinimapModel {
  markers: MinimapMarker[];
  zoneId: string;
}

export interface MinimapMarkers {
  /** Derive this frame's markers, refilling the reused container in place.
   *  `pxPerYard` is the minimap world scale (base scale * zoom); `S` is the canvas
   *  side in px. */
  build(world: IWorld, S: number, pxPerYard: number): MinimapModel;
}

/** Which minimap surface this world renders. Delve when the player stands in a delve
 *  band and a run is active (matches the inline guard); overworld otherwise. The delve
 *  branch is delve_map_painter's; the overworld branch is this core's. */
export function minimapMode(world: IWorld): MinimapMode {
  if (isYumiMazePos(world.player.pos.x)) return 'yumiMaze';
  return isDelvePos(world.player.pos.x) && world.delveRun ? 'delve' : 'overworld';
}

/**
 * Build an overworld minimap marker model with a reused container. Reads only IWorld
 * members (player / entities / partyInfo / socialInfo / questState), so the offline Sim
 * and the online ClientWorld mirror produce identical output. Every
 * position is projected to canvas pixels here; the painter only resolves colors +
 * strokes.
 */
export function createMinimapMarkers(): MinimapMarkers {
  const markers: MinimapMarker[] = [];
  const model: MinimapModel = { markers, zoneId: '' };

  return {
    build(world: IWorld, S: number, pxPerYard: number): MinimapModel {
      const p = world.player;
      const half = S / 2;
      const rim = half - RIM_INSET;
      const rim2 = rim * rim;
      markers.length = 0;
      model.zoneId = zoneAt(p.pos.z).id;

      // friend/guild lookup for colouring nearby allies; party members are drawn by the
      // party loop below, so the entity loop skips them (avoiding double dots). Built
      // ONCE per call (as the inline site did), NOT off the hot path.
      const social = world.socialInfo;
      const friendNames = social
        ? new Set(social.friends.filter((f) => f.online).map((f) => f.name))
        : null;
      const guildNames = social?.guild ? new Set(social.guild.members.map((m) => m.name)) : null;
      const partyPids = world.partyInfo ? new Set(world.partyInfo.members.map((m) => m.pid)) : null;

      for (const e of world.entities.values()) {
        if (e.id === p.id) continue;
        const dx = -(e.pos.x - p.pos.x) * pxPerYard; // +X is map-left
        const dz = -(e.pos.z - p.pos.z) * pxPerYard;
        if (dx * dx + dz * dz > rim2) continue; // cull markers outside the rim
        const mx = half + dx;
        const my = half + dz;
        if (e.kind === 'player' && !partyPids?.has(e.id)) {
          const isFriend = friendNames?.has(e.name) ?? false;
          const isGuild = !isFriend && (guildNames?.has(e.name) ?? false);
          if (isFriend || isGuild) {
            markers.push({ kind: 'ally', mx, my, ally: isFriend ? 'friend' : 'guild' });
          }
        } else if (e.kind === 'npc') {
          const hasAvail = e.questIds.some(
            (q) => QUESTS[q].giverNpcId === e.templateId && world.questState(q) === 'available',
          );
          const hasReady = e.questIds.some(
            (q) => isQuestTurnInNpc(QUESTS[q], e.templateId) && world.questState(q) === 'ready',
          );
          markers.push({ kind: 'npc', mx, my, glyph: hasReady ? '?' : hasAvail ? '!' : '•' });
        } else if (
          e.kind === 'object' &&
          (e.templateId === 'dungeon_door' || e.templateId === 'dungeon_exit')
        ) {
          markers.push({ kind: 'portal', mx, my });
        } else if (e.kind === 'object' && e.lootable) {
          markers.push({ kind: 'object-loot', mx, my });
        } else if (e.kind === 'mob' && !e.dead) {
          markers.push({ kind: 'mob', mx, my, aggro: e.aggroTargetId === p.id });
        } else if (e.kind === 'mob' && e.lootable) {
          markers.push({ kind: 'mob-loot', mx, my });
        }
      }

      // The local player's own corpse while a ghost: a skull marker so the corpse run
      // is navigable. Clamped to the rim when the body is off the minimap, so it always
      // points the way back (like a party-arrow).
      if (p.ghost && p.corpsePos) {
        const dx = -(p.corpsePos.x - p.pos.x) * pxPerYard;
        const dz = -(p.corpsePos.z - p.pos.z) * pxPerYard;
        const dist = Math.hypot(dx, dz);
        if (dist > rim) {
          const ang = Math.atan2(dz, dx);
          markers.push({
            kind: 'corpse',
            mx: half + Math.cos(ang) * rim,
            my: half + Math.sin(ang) * rim,
          });
        } else {
          markers.push({ kind: 'corpse', mx: half + dx, my: half + dz });
        }
      }

      // Party members: class-colored. On-map allies are proximity-scaled discs; allies
      // past the rim pin to the edge as arrows pointing the way to regroup. Iterates
      // partyInfo.members (a DIFFERENT collection from world.entities above).
      const party = world.partyInfo;
      if (party) {
        for (const m of party.members) {
          if (m.pid === p.id) continue;
          const dx = -(m.x - p.pos.x) * pxPerYard;
          const dz = -(m.z - p.pos.z) * pxPerYard;
          const dist = Math.hypot(dx, dz);
          const ang = Math.atan2(dz, dx);
          const dead = m.dead !== 0;
          if (dist > rim) {
            markers.push({
              kind: 'party-arrow',
              mx: half + Math.cos(ang) * rim,
              my: half + Math.sin(ang) * rim,
              angle: ang,
              cls: m.cls,
              dead,
            });
          } else {
            markers.push({
              kind: 'party-disc',
              mx: half + dx,
              my: half + dz,
              radius: PARTY_DISC_MAX_RADIUS - (dist / rim) * PARTY_DISC_RADIUS_RANGE,
              cls: m.cls,
              dead,
              pip: !dead,
            });
          }
        }
      }

      // Gatherable world nodes (issue 1124): static content positions (never entities), each
      // classified ready/cooldown for THIS viewer only via nodeHarvestableByMe.
      for (const node of GATHER_NODES) {
        const dx = -(node.pos.x - p.pos.x) * pxPerYard;
        const dz = -(node.pos.z - p.pos.z) * pxPerYard;
        if (dx * dx + dz * dz > rim2) continue;
        markers.push({
          kind: 'gather-node',
          mx: half + dx,
          my: half + dz,
          ready: world.nodeHarvestableByMe(node.id),
        });
      }

      // The local player's facing arrow, drawn last at the centre.
      markers.push({ kind: 'player', mx: half, my: half, angle: -p.facing });
      return model;
    },
  };
}
