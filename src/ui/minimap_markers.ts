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
// The dynamic-entity and NPC staging arrays are allocated once with the core, then
// cleared and drained by indexed loops: category ordering adds no per-build arrays,
// sort callbacks, or iterator objects beyond the established marker records. The
// three membership Sets are per-call temporaries (faithful to the inline site).
//
// DOM-free / i18n-free / Three-free / deterministic so tests/minimap_markers.test.ts
// can drive it with both a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
// Markers carry the identity (the party class id) the painter resolves
// to a color, never the resolved color.

import type { GatheringProfessionId } from '../sim/content/professions';
import { GATHER_NODES, isBgPos, isDelvePos, isYumiMazePos, QUESTS, zoneAt } from '../sim/data';
import { NODE_HARVEST_TABLE } from '../sim/professions/gathering';
import { canGatherTier } from '../sim/professions/tools';
import {
  npcQuestMarkerKind,
  type QuestMarkerKind,
  strongerQuestMarker,
} from '../sim/quests/quest_marker_kind';
import {
  EASTBROOK_NOTICEBOARD_TEMPLATE_ID,
  type GatherNodeType,
  type StationType,
} from '../sim/types';
import type { IWorld } from '../world_api';
import { viewerUsableToolTier } from './gathering_view';
import {
  MAP_MARKER_SIZES,
  mapMarkerSizeForSemantic,
  semanticMapMarkerArt,
} from './map_marker_icon_art';
import type { MapMarkerProfile } from './map_marker_profile_core';
import {
  classifyMapObjectMarker,
  type MapMarkerSemantic,
  mapMarkerSemanticLayer,
} from './map_marker_semantics_core';
import { STABLE_MAP_NAVIGATION_LANDMARKS } from './map_navigation_landmarks_core';

// The painter clips the 162px minimap two pixels inside the canvas. Visibility
// is footprint-aware: a painted square must fit its full half-diagonal inside
// this circle, while procedural discs/arrows use their own conservative extent.
// This prevents large compact quest/resource/navigation art from being admitted
// by centre and then visibly sliced at the rim.
export const MINIMAP_CLIP_INSET = 2;
const SQRT_HALF = Math.SQRT1_2;
const STANDARD_PROFILE = (): MapMarkerProfile => 'standard';

type DynamicClearanceKind =
  | 'ally'
  | 'object-loot'
  | 'mob'
  | 'mob-loot'
  | 'neutral-npc'
  | 'semantic-fallback'
  | 'corpse'
  | 'party-disc'
  | 'party-arrow';

/** A mitered diamond's radial vertex grows by half the stroke divided by
 * sin(45deg). Canvas keeps the default miter join for these tiny silhouettes. */
function diamondMiterClearance(radius: number, outlineWidth: number): number {
  return radius + outlineWidth * SQRT_HALF;
}

/** Radial tip envelope for the four-ray loot sparkle. The cardinal tip's
 * half-angle is defined by its shoulder and the tip-to-shoulder run. */
function lootSparkMiterClearance(radius: number, shoulder: number, outlineWidth: number): number {
  return radius + (outlineWidth * Math.hypot(shoulder, radius - shoulder)) / (shoulder * 2);
}

/** Radial tip envelope for the rotated party triangle. Its tip always points
 * directly away from the minimap center, so this miter is the exact rim apex. */
function partyArrowMiterClearance(
  tipX: number,
  backX: number,
  halfY: number,
  outlineWidth: number,
): number {
  return tipX + (outlineWidth * Math.hypot(tipX - backX, halfY)) / (halfY * 2);
}

/** Maximum radial ink extent, including the painter's outline. Values mirror
 * the frozen standard/compact procedural geometry in minimap_painter.ts. */
const DYNAMIC_CLEARANCE = Object.freeze({
  standard: Object.freeze({
    ally: diamondMiterClearance(3.5, 1.5),
    'object-loot': lootSparkMiterClearance(4, 1, 1.25),
    mob: diamondMiterClearance(3.5, 1.25),
    'mob-loot': Math.SQRT2 * 3.125,
    'neutral-npc': 4.5,
    'semantic-fallback': 5,
    corpse: 6,
    'party-disc': 6.75,
    'party-arrow': partyArrowMiterClearance(6, -4, 4.5, 1.5),
  }),
  compact: Object.freeze({
    ally: diamondMiterClearance(5.25, 2),
    'object-loot': lootSparkMiterClearance(6, 1.5, 1.75),
    mob: diamondMiterClearance(5.25, 1.75),
    'mob-loot': Math.SQRT2 * 4.625,
    'neutral-npc': 6.5,
    'semantic-fallback': 7,
    corpse: 9,
    'party-disc': 9.7,
    'party-arrow': partyArrowMiterClearance(9, -6, 6.75, 2),
  }),
} as const satisfies Readonly<
  Record<MapMarkerProfile, Readonly<Record<DynamicClearanceKind, number>>>
>);

export function minimapPaintedMarkerClearance(size: number): number {
  return Math.max(0, size) * SQRT_HALF;
}

export function minimapSafeCenterRadius(canvasSize: number, clearance: number): number {
  return Math.max(0, canvasSize / 2 - MINIMAP_CLIP_INSET - Math.max(0, clearance));
}

function centerFits(dist2: number, canvasSize: number, clearance: number): boolean {
  const radius = minimapSafeCenterRadius(canvasSize, clearance);
  return dist2 <= radius * radius;
}
// Proximity scaling for on-map party discs: ~PARTY_DISC_MAX_RADIUS px adjacent to the
// player, shrinking to (MAX - RANGE) px near the rim. Byte-faithful to `6 - (dist/R)*3`.
const PARTY_DISC_MAX_RADIUS = 6;
const PARTY_DISC_RADIUS_RANGE = 3;

/** Which minimap surface a world renders: the delve schematic (owned by
 *  delve_map_painter), the Protect Yumi maze (the overworld marker set over a
 *  cached maze-wall background, minimap_painter.paintYumiMaze), the Thornhollow Fields
 *  battleground (the same marker set over a cached wall raster; Hud routes it
 *  through paintOverworld, which branches to paintBattleground), or the
 *  overworld minimap (this core). */
export type MinimapMode = 'rift' | 'delve' | 'yumiMaze' | 'battleground' | 'overworld';

/** The NPC quest glyph: turn-in ready ('?') wins over available ('!'), else neutral. */
export type NpcGlyph = '?' | '!' | '•';

/** The '!' glyph's kinds, in glyph terms: gold first-offer, blue repeat, or
 *  the dimmed cooldown (a work order inside its cadence window). 'none' is
 *  the neutral dot; 'ready' is the gold '?'. The gray in-progress state is
 *  nameplate-only, so the minimap folds it to the neutral dot. */
export type NpcMarkerVariant = Exclude<QuestMarkerKind, 'active'>;
export type MinimapObjectSemantic = Exclude<MapMarkerSemantic, { kind: 'dungeon' }>;

/** One overworld minimap marker, in canvas-pixel space. A DISCRIMINATED union (not a
 *  flat struct): each variant carries exactly the fields its draw branch needs. */
export type MinimapMarker =
  // An online friend/guild ally who is NOT in the party (party members are the
  // party-disc/arrow variants). Strangers get no marker, and neither does a
  // friend/guildmate sitting on the ENEMY roster of a live battleground match.
  | { kind: 'ally'; mx: number; my: number; ally: 'friend' | 'guild' }
  // A quest-giver NPC glyph. `marker` is the folded quest-marker state behind
  // the glyph: the painter resolves gold for 'ready'/'available' (and the
  // neutral 'none' dot), the repeat token for 'repeat', and the repeat token
  // dimmed for 'cooldown'. Actionable info on every graphics tier (fairness
  // invariant: never preset-gated), like every other marker here.
  | { kind: 'npc'; mx: number; my: number; glyph: NpcGlyph; marker: NpcMarkerVariant }
  // The established dungeon entrance/exit contract consumed by the art painter.
  | { kind: 'portal'; mx: number; my: number; portal: 'dungeon-entrance' | 'dungeon-exit' }
  // Authored entity-free routes. These retain a distinct model kind because
  // pretending they are live objects would make their authority and lifecycle
  // ambiguous to future map work.
  | {
      kind: 'stable-navigation';
      mx: number;
      my: number;
      navigation: 'delve-entrance' | 'world-passage';
    }
  // A navigation or reward object whose template-specific semantics were
  // resolved before the generic-loot branch. Painting is intentionally a
  // separate concern: this model cannot mislabel a beacon as loose loot while
  // the generated art is still decoding or unavailable.
  | { kind: 'semantic-object'; mx: number; my: number; semantic: MinimapObjectSemantic }
  // A stable civic service. These are distinct from loose ground loot: both
  // open dedicated interaction surfaces and use authored active-world entities.
  | { kind: 'service'; mx: number; my: number; service: 'mailbox' | 'noticeboard' }
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
  // the painter retains both facts but gives cooldown visual precedence: an
  // exhausted node is smaller and grayscale; a ready locked node carries the
  // independent tool-lock cue. Actionable info on every graphics tier
  // (fairness invariant: never preset-gated).
  | {
      kind: 'gather-node';
      mx: number;
      my: number;
      type: GatherNodeType;
      ready: boolean;
      locked: boolean;
    }
  // A crafting station (Professions 2.0): STATIC content positions (never
  // entities, no per-viewer state), so both IWorld hosts produce the same
  // marker. Tier-identical by the fairness invariant: never preset-gated.
  | { kind: 'station'; mx: number; my: number; stationId: string; type: StationType };

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
  build(world: IWorld, S: number, pxPerYard: number, profile?: MapMarkerProfile): MinimapModel;
}

/** Which minimap surface this world renders. Delve when the player stands in a delve
 *  band and a run is active (matches the inline guard); overworld otherwise. The delve
 *  branch is delve_map_painter's; the overworld branch is this core's. */
export function minimapMode(world: IWorld): MinimapMode {
  if (world.riftFloor) return 'rift';
  if (isYumiMazePos(world.player.pos.x)) return 'yumiMaze';
  if (isBgPos(world.player.pos.x)) return 'battleground';
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
  const dynamicMarkers: Extract<
    MinimapMarker,
    { kind: 'ally' | 'object-loot' | 'mob' | 'mob-loot' }
  >[] = [];
  const mechanicMarkers: Extract<MinimapMarker, { kind: 'semantic-object' }>[] = [];
  const rewardMarkers: Extract<MinimapMarker, { kind: 'semantic-object' }>[] = [];
  const navigationMarkers: Extract<MinimapMarker, { kind: 'semantic-object' }>[] = [];
  const stableNavigationMarkers: Extract<MinimapMarker, { kind: 'stable-navigation' }>[] = [];
  const npcMarkers: Extract<MinimapMarker, { kind: 'npc' }>[] = [];
  const model: MinimapModel = { markers, zoneId: '', rift: null };

  return {
    build(
      world: IWorld,
      S: number,
      pxPerYard: number,
      profile: MapMarkerProfile = STANDARD_PROFILE(),
    ): MinimapModel {
      const p = world.player;
      const half = S / 2;
      const compact = profile === 'compact';
      const clipRadius = half - MINIMAP_CLIP_INSET;
      const clipRadius2 = clipRadius * clipRadius;
      const clearance = DYNAMIC_CLEARANCE[profile];
      markers.length = 0;
      dynamicMarkers.length = 0;
      mechanicMarkers.length = 0;
      rewardMarkers.length = 0;
      navigationMarkers.length = 0;
      stableNavigationMarkers.length = 0;
      npcMarkers.length = 0;
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
      // Thornhollow Fields fairness: inside a live match the friend/guild dot is a
      // through-wall tracker, so a guildmate seated on the ENEMY roster would hand one
      // side a live position feed the other side cannot have. Suppress every marker
      // this core would otherwise emit for an enemy-team pid (the ally dot, and the
      // party disc/arrow for the party path, which a cross-team queue could reach).
      // Matched BY PID (match.players[].pid is the player entity id, the same identity
      // partyPids compares against), never by name, so a rename or an impostor name
      // cannot re-open it. Same-team friends and guildmates keep their dots.
      const bgMatch = world.bgInfo?.match ?? null;
      const bgEnemyPids = bgMatch
        ? new Set(bgMatch.players.filter((bp) => bp.team !== bgMatch.myTeam).map((bp) => bp.pid))
        : null;

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
        const dist2 = dx * dx + dz * dz;
        if (dist2 > clipRadius2) continue;
        const mx = half + dx;
        const my = half + dz;
        if (e.kind === 'player' && !partyPids?.has(e.id) && !bgEnemyPids?.has(e.id)) {
          const isFriend = friendNames?.has(e.name) ?? false;
          const isGuild = !isFriend && (guildNames?.has(e.name) ?? false);
          if ((isFriend || isGuild) && centerFits(dist2, S, clearance.ally)) {
            dynamicMarkers.push({ kind: 'ally', mx, my, ally: isFriend ? 'friend' : 'guild' });
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
          const npcClearance =
            folded === 'none'
              ? clearance['neutral-npc']
              : minimapPaintedMarkerClearance(
                  MAP_MARKER_SIZES[
                    folded === 'cooldown'
                      ? compact
                        ? 'minimapQuestCooldownCompact'
                        : 'minimapQuestCooldown'
                      : compact
                        ? 'minimapQuestCompact'
                        : 'minimapQuest'
                  ],
                );
          if (!centerFits(dist2, S, npcClearance)) continue;
          // Quest punctuation is deferred until after static resources and
          // services. Profession masters stand only a few yards from their
          // stations, so this draw-order contract keeps an actionable !/? on
          // top of the larger painted station marker.
          npcMarkers.push({ kind: 'npc', mx, my, glyph, marker: folded });
        } else if (e.kind === 'object') {
          const semantic = classifyMapObjectMarker(e, { delveRun: world.delveRun });
          if (semantic) {
            if (semantic.kind === 'dungeon') {
              const size = MAP_MARKER_SIZES[compact ? 'minimapDungeonCompact' : 'minimapDungeon'];
              if (!centerFits(dist2, S, minimapPaintedMarkerClearance(size))) continue;
              markers.push({
                kind: 'portal',
                mx,
                my,
                portal: semantic.role === 'exit' ? 'dungeon-exit' : 'dungeon-entrance',
              });
              continue;
            }
            const marker: Extract<MinimapMarker, { kind: 'semantic-object' }> = {
              kind: 'semantic-object',
              mx,
              my,
              semantic,
            };
            const semanticArt = semanticMapMarkerArt(semantic);
            const semanticClearance = semanticArt
              ? minimapPaintedMarkerClearance(
                  MAP_MARKER_SIZES[mapMarkerSizeForSemantic('minimap', compact, semanticArt)],
                )
              : clearance['semantic-fallback'];
            if (!centerFits(dist2, S, semanticClearance)) continue;
            const layer = mapMarkerSemanticLayer(semantic);
            if (layer === 'mechanic') mechanicMarkers.push(marker);
            else if (layer === 'reward') rewardMarkers.push(marker);
            else navigationMarkers.push(marker);
          } else if (
            e.templateId === 'mailbox' ||
            e.templateId === EASTBROOK_NOTICEBOARD_TEMPLATE_ID
          ) {
            const size = MAP_MARKER_SIZES[compact ? 'minimapServiceCompact' : 'minimapService'];
            if (!centerFits(dist2, S, minimapPaintedMarkerClearance(size))) continue;
            markers.push({
              kind: 'service',
              mx,
              my,
              service:
                e.templateId === EASTBROOK_NOTICEBOARD_TEMPLATE_ID ? 'noticeboard' : 'mailbox',
            });
          } else if (e.lootable && centerFits(dist2, S, clearance['object-loot'])) {
            dynamicMarkers.push({ kind: 'object-loot', mx, my });
          }
        } else if (
          e.kind === 'mob' &&
          e.hostile &&
          !e.dead &&
          centerFits(dist2, S, clearance.mob)
        ) {
          dynamicMarkers.push({ kind: 'mob', mx, my, aggro: e.aggroTargetId === p.id });
        } else if (
          e.kind === 'mob' &&
          e.hostile &&
          e.lootable &&
          centerFits(dist2, S, clearance['mob-loot'])
        ) {
          dynamicMarkers.push({ kind: 'mob-loot', mx, my });
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
        const dist2 = dx * dx + dz * dz;
        if (dist2 > clipRadius2) continue;
        bestToolTiers ??= new Map();
        const professionId = NODE_HARVEST_TABLE[node.type].professionId;
        let best = bestToolTiers.get(professionId);
        if (best === undefined) {
          proficiency ??= world.gatheringProficiency;
          best = viewerUsableToolTier(world, professionId, proficiency);
          bestToolTiers.set(professionId, best);
        }
        const ready = world.nodeHarvestableByMe(node.id);
        const locked = !canGatherTier(best, node.tier);
        const gatherSize =
          MAP_MARKER_SIZES[
            ready
              ? locked
                ? compact
                  ? 'minimapGatherReadyLockedCompact'
                  : 'minimapGatherReadyLocked'
                : compact
                  ? 'minimapGatherReadyCompact'
                  : 'minimapGatherReady'
              : locked
                ? compact
                  ? 'minimapGatherCooldownLockedCompact'
                  : 'minimapGatherCooldownLocked'
                : compact
                  ? 'minimapGatherCooldownCompact'
                  : 'minimapGatherCooldown'
          ];
        if (!centerFits(dist2, S, minimapPaintedMarkerClearance(gatherSize))) continue;
        markers.push({
          kind: 'gather-node',
          mx: half + dx,
          my: half + dz,
          type: node.type,
          ready,
          locked,
        });
      }

      // Crafting stations (Professions 2.0): positions come through IWorld so
      // custom maps cannot inherit fixed built-in Eastbrook markers.
      for (const station of world.stationPlacements) {
        const dx = -(station.pos.x - p.pos.x) * pxPerYard;
        const dz = -(station.pos.z - p.pos.z) * pxPerYard;
        const size = MAP_MARKER_SIZES[compact ? 'minimapStationCompact' : 'minimapStation'];
        if (!centerFits(dx * dx + dz * dz, S, minimapPaintedMarkerClearance(size))) continue;
        markers.push({
          kind: 'station',
          mx: half + dx,
          my: half + dz,
          stationId: station.id,
          type: station.type,
        });
      }

      // Entity-free shipped routes use the same radial cull as every nearby
      // world marker. The table and staging array are module/core-owned, so the
      // 10Hz scan creates only the marker records that will actually draw.
      for (const site of STABLE_MAP_NAVIGATION_LANDMARKS) {
        const dx = -(site.x - p.pos.x) * pxPerYard;
        const dz = -(site.z - p.pos.z) * pxPerYard;
        const size = MAP_MARKER_SIZES[compact ? 'minimapNavigationCompact' : 'minimapNavigation'];
        if (!centerFits(dx * dx + dz * dz, S, minimapPaintedMarkerClearance(size))) continue;
        stableNavigationMarkers.push({
          kind: 'stable-navigation',
          mx: half + dx,
          my: half + dz,
          navigation: site.kind,
        });
      }

      // Painted civic/resource/portal art can be wider than the old procedural
      // dots. Emit the live entity layer only after every static painting, so a
      // collocated hostile, ally, loose object, or lootable mob corpse remains
      // visible. The staging array is core-owned and the indexed drain allocates
      // nothing; its order is the stable world.entities iteration order.
      for (let i = 0; i < dynamicMarkers.length; i++) markers.push(dynamicMarkers[i]);

      // Puzzle mechanics sit over ordinary dynamics; rewards remain above
      // mechanics, and navigation above rewards so an open route cannot
      // disappear under a nearby chest. These arrays are core-owned and drained
      // by index: no per-build sorting or category-array allocation is introduced.
      for (let i = 0; i < mechanicMarkers.length; i++) markers.push(mechanicMarkers[i]);
      for (let i = 0; i < rewardMarkers.length; i++) markers.push(rewardMarkers[i]);
      for (let i = 0; i < stableNavigationMarkers.length; i++) {
        markers.push(stableNavigationMarkers[i]);
      }
      for (let i = 0; i < navigationMarkers.length; i++) markers.push(navigationMarkers[i]);

      // Navigation-critical dynamic markers paint over the larger static
      // paintings and the ordinary live-entity layer. Preserve the established
      // top stack: corpse, party, NPC punctuation, then the local player.
      // The local player's own corpse is clamped to the rim when off-map.
      if (p.ghost && p.corpsePos) {
        const dx = -(p.corpsePos.x - p.pos.x) * pxPerYard;
        const dz = -(p.corpsePos.z - p.pos.z) * pxPerYard;
        const dist = Math.hypot(dx, dz);
        const corpseRim = minimapSafeCenterRadius(S, clearance.corpse);
        if (dist > corpseRim) {
          const ang = Math.atan2(dz, dx);
          markers.push({
            kind: 'corpse',
            mx: half + Math.cos(ang) * corpseRim,
            my: half + Math.sin(ang) * corpseRim,
          });
        } else {
          markers.push({ kind: 'corpse', mx: half + dx, my: half + dz });
        }
      }

      // Party members: class-colored. On-map allies are proximity-scaled discs;
      // allies past the rim pin to the edge as arrows pointing the way to regroup.
      // This iterates partyInfo.members, a different collection from entities.
      const party = world.partyInfo;
      if (party) {
        for (const m of party.members) {
          if (m.pid === p.id) continue;
          if (bgEnemyPids?.has(m.pid)) continue; // enemy-team pid: never tracked (see above)
          const dx = -(m.x - p.pos.x) * pxPerYard;
          const dz = -(m.z - p.pos.z) * pxPerYard;
          const dist = Math.hypot(dx, dz);
          const ang = Math.atan2(dz, dx);
          const dead = m.dead !== 0;
          const discRim = minimapSafeCenterRadius(S, clearance['party-disc']);
          const arrowRim = minimapSafeCenterRadius(S, clearance['party-arrow']);
          if (dist > discRim) {
            markers.push({
              kind: 'party-arrow',
              mx: half + Math.cos(ang) * arrowRim,
              my: half + Math.sin(ang) * arrowRim,
              angle: ang,
              cls: m.cls,
              dead,
            });
          } else {
            markers.push({
              kind: 'party-disc',
              mx: half + dx,
              my: half + dz,
              radius: PARTY_DISC_MAX_RADIUS - (dist / discRim) * PARTY_DISC_RADIUS_RANGE,
              cls: m.cls,
              dead,
              pip: !dead,
            });
          }
        }
      }

      for (let i = 0; i < npcMarkers.length; i++) markers.push(npcMarkers[i]);

      // The local player's facing arrow, drawn last at the centre.
      markers.push({ kind: 'player', mx: half, my: half, angle: -p.facing });
      return model;
    },
  };
}
