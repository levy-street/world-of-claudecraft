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

import type { GatheringProfessionId } from '../sim/content/professions';
import { GATHER_NODES, isDelvePos, isYumiMazePos, QUESTS, zoneAt } from '../sim/data';
import { NODE_HARVEST_TABLE } from '../sim/professions/gathering';
import { canGatherTier } from '../sim/professions/tools';
import {
  npcQuestMarkerKind,
  type QuestMarkerKind,
  strongerQuestMarker,
} from '../sim/quests/quest_marker_kind';
import type { IWorld } from '../world_api';
import { viewerUsableToolTier } from './gathering_view';

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

/** The '!' glyph's kinds, in glyph terms: gold first-offer, blue repeat, or
 *  the dimmed cooldown (a work order inside its cadence window). 'none' is
 *  the neutral dot; 'ready' is the gold '?'. The gray in-progress state is
 *  nameplate-only, so the minimap folds it to the neutral dot. */
export type NpcMarkerVariant = Exclude<QuestMarkerKind, 'active'>;

/** One overworld minimap marker, in canvas-pixel space. A DISCRIMINATED union (not a
 *  flat struct): each variant carries exactly the fields its draw branch needs. */
export type MinimapMarker =
  // An online friend/guild ally who is NOT in the party (party members are the
  // party-disc/arrow variants). Strangers get no marker.
  | { kind: 'ally'; mx: number; my: number; ally: 'friend' | 'guild' }
  // A quest-giver NPC glyph. `marker` is the folded quest-marker state behind
  // the glyph: the painter resolves gold for 'ready'/'available' (and the
  // neutral 'none' dot), the repeat token for 'repeat', and the repeat token
  // dimmed for 'cooldown'. Actionable info on every graphics tier (fairness
  // invariant: never preset-gated), like every other marker here.
  | { kind: 'npc'; mx: number; my: number; glyph: NpcGlyph; marker: NpcMarkerVariant }
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
  // states for the same node id). `locked` is the SEPARATE tool-tier access
  // dimension (Professions 2.0, the per-viewer WIELD-FILTERED usable-tool
  // scan, viewerUsableToolTier):
  // the painter composes both, keeping the ready/cooldown silhouette while a
  // locked tint replaces the state color. Actionable info on every graphics
  // tier (fairness invariant: never preset-gated).
  | { kind: 'gather-node'; mx: number; my: number; ready: boolean; locked: boolean }
  // A crafting station (Professions 2.0): STATIC content positions (never
  // entities, no per-viewer state), so both IWorld hosts produce the same
  // marker. Tier-identical by the fairness invariant: never preset-gated.
  | { kind: 'station'; mx: number; my: number };

/** Everything the painter draws for one overworld minimap frame: the marker list (in
 *  draw order) plus the committed zone id (the painter localizes the #zone-label). */
export interface MinimapModel {
  markers: MinimapMarker[];
  zoneId: string;
  /** When the player is inside a rift, its floor name + C/B/A/S rank (rank null for
   *  dev-portal runs). The painter shows this instead of the overworld zone name. */
  rift: { name: string; rank: string | null } | null;
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
 * members (player / entities / partyInfo / socialInfo / questState / questsDone /
 * craftingIdentity), so the offline Sim
 * and the online ClientWorld mirror produce identical output. Every
 * position is projected to canvas pixels here; the painter only resolves colors +
 * strokes.
 */
export function createMinimapMarkers(): MinimapMarkers {
  const markers: MinimapMarker[] = [];
  const model: MinimapModel = { markers, zoneId: '', rift: null };

  return {
    build(world: IWorld, S: number, pxPerYard: number): MinimapModel {
      const p = world.player;
      const half = S / 2;
      const rim = half - RIM_INSET;
      const rim2 = rim * rim;
      markers.length = 0;
      model.zoneId = zoneAt(p.pos.x, p.pos.z).id;
      // Inside a rift the overworld zone (zoneAt reads x/z; rifts displace on x well
      // past any land) is the wrong label; surface the generated rift floor name + rank.
      const rf = world.riftFloor;
      model.rift = rf ? { name: rf.name, rank: rf.tier } : null;

      // friend/guild lookup for colouring nearby allies; party members are drawn by the
      // party loop below, so the entity loop skips them (avoiding double dots). Built
      // ONCE per call (as the inline site did), NOT off the hot path.
      const social = world.socialInfo;
      const friendNames = social
        ? new Set(social.friends.filter((f) => f.online).map((f) => f.name))
        : null;
      const guildNames = social?.guild ? new Set(social.guild.members.map((m) => m.name)) : null;
      const partyPids = world.partyInfo ? new Set(world.partyInfo.members.map((m) => m.pid)) : null;

      // Quest-marker inputs (the shared quest_marker_kind rule), resolved
      // lazily ONCE per build on the first in-rim NPC: craftingIdentity is a
      // per-access allocation on the offline Sim, so the common no-nearby-NPC
      // frame skips it entirely (the bestToolTiers memo shape below).
      let questMarkerCtx: {
        questsDone: ReadonlySet<string>;
        cadenceBlocked: ReadonlySet<string> | undefined;
      } | null = null;

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
          if (!questMarkerCtx) {
            const blocked = world.craftingIdentity?.cadenceBlockedQuests;
            questMarkerCtx = {
              questsDone: world.questsDone,
              cadenceBlocked: blocked && blocked.length > 0 ? new Set(blocked) : undefined,
            };
          }
          let folded: NpcMarkerVariant = 'none';
          for (const q of e.questIds) {
            const quest = QUESTS[q];
            if (!quest) continue;
            const kind = npcQuestMarkerKind(
              quest,
              e.templateId,
              world.questState(q),
              questMarkerCtx.questsDone,
              questMarkerCtx.cadenceBlocked,
            );
            // The gray in-progress state is nameplate-only. Filtered PER
            // QUEST before the fold (the map's questGiverNpcMarkers does the
            // same), never folded then collapsed: 'active' outranks
            // 'cooldown', so folding it in would swallow a cooldown mark
            // this surface DOES draw whenever the same NPC also holds an
            // in-progress turn-in (all four profession masters do).
            if (kind === 'active') continue;
            // No cast: the generic fold keeps the narrowed union, so removing
            // the guard above is a compile error, not a comment violation.
            folded = strongerQuestMarker<NpcMarkerVariant>(folded, kind);
            if (folded === 'ready') break; // nothing outranks the '?'
          }
          const glyph: NpcGlyph = folded === 'ready' ? '?' : folded === 'none' ? '•' : '!';
          markers.push({ kind: 'npc', mx, my, glyph, marker: folded });
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
      // `locked` memoizes the wield-filtered usable-tool scan per profession,
      // lazily on the first in-rim node: the common no-nearby-node frame
      // skips the scan entirely at the minimap's 10Hz cadence. The memo is a
      // per-build temporary (like the membership Sets above), so a tool
      // picked up between frames re-resolves next build.
      let bestToolTiers: Map<GatheringProfessionId, number> | null = null;
      // Resolved ONCE beside the memo: the offline gatheringProficiency
      // getter copies the live map per access, so reading it per profession
      // would allocate per build. Same lazy shape as the memo itself.
      let proficiency: Readonly<Record<string, number>> | undefined;
      for (const node of GATHER_NODES) {
        const dx = -(node.pos.x - p.pos.x) * pxPerYard;
        const dz = -(node.pos.z - p.pos.z) * pxPerYard;
        if (dx * dx + dz * dz > rim2) continue;
        bestToolTiers ??= new Map();
        const professionId = NODE_HARVEST_TABLE[node.type].professionId;
        let best = bestToolTiers.get(professionId);
        if (best === undefined) {
          proficiency ??= world.gatheringProficiency;
          best = viewerUsableToolTier(world, professionId, proficiency);
          bestToolTiers.set(professionId, best);
        }
        markers.push({
          kind: 'gather-node',
          mx: half + dx,
          my: half + dz,
          ready: world.nodeHarvestableByMe(node.id),
          locked: !canGatherTier(best, node.tier),
        });
      }

      // Crafting stations (Professions 2.0): positions come through IWorld so
      // custom maps cannot inherit fixed built-in Eastbrook markers.
      for (const station of world.stationPlacements) {
        const dx = -(station.pos.x - p.pos.x) * pxPerYard;
        const dz = -(station.pos.z - p.pos.z) * pxPerYard;
        if (dx * dx + dz * dz > rim2) continue;
        markers.push({ kind: 'station', mx: half + dx, my: half + dz });
      }

      // The local player's facing arrow, drawn last at the centre.
      markers.push({ kind: 'player', mx: half, my: half, angle: -p.facing });
      return model;
    },
  };
}
