// Dungeon Finder window: the pure view core (docs/prd/dungeon-finder.md).
// Maps IWorld-shaped finder state + painter-local UI state (tab, selection,
// staged form choices) to a render model. DOM-free and i18n-free: it emits raw
// ids, numbers, and flags; the painter localizes names via tEntity /
// itemDisplayName / t(). Registered in UI_PURE_CORES (tests/architecture.test.ts)
// and driven directly by tests/dungeon_finder_view.test.ts with both Sim-shaped
// and ClientWorld-shaped inputs.
//
// Time-driven numbers (queue wait, proposal countdown, cooldown, accepted
// count) live in `clocks`, OUTSIDE the render-skip signature: the painter
// repaints structure only when `sig` changes and refreshes the clock text
// slots in place, so a ticking countdown never rebuilds the window.

import { HEROIC_DUNGEON_TUNING } from '../sim/content/dungeon_difficulty';
import {
  FINDER_ACTIVITIES,
  FINDER_LISTING_TAGS,
  type FinderActivity,
  type FinderActivityKind,
  type FinderListingTag,
  finderActivity,
} from '../sim/content/dungeon_finder';
import { HEROIC_BOSS_LOOT } from '../sim/content/heroic_loot';
import { FIRST_TALENT_LEVEL, type Role } from '../sim/content/talents';
import { DUNGEONS, ITEMS, MOBS, zoneAt } from '../sim/data';
import { compatibleFinderRoles } from '../sim/social/dungeon_finder';
import type { DungeonDifficulty, PlayerClass } from '../sim/types';

// ItemDef.quality is an inline optional union in sim/types.ts; name it here for
// the loot rows (undefined quality renders as 'common').
export type FinderItemQuality = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

import type {
  DungeonFinderBoard,
  DungeonFinderInfo,
  DungeonFinderListingView,
  DungeonFinderMyListingView,
  RaidLockout,
} from '../world_api';

export type FinderTab = 'catalogue' | 'queue' | 'board';

export const FINDER_TABS: readonly FinderTab[] = ['catalogue', 'queue', 'board'];

// Directory of the prerendered boss portrait stills (WebP, fixed 128x128).
export const FINDER_PORTRAIT_DIR = '/ui/dungeons';

export type FinderBlockReason = 'level' | 'spec' | null;

export interface FinderActivityRowView {
  id: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  kind: FinderActivityKind;
  minLevel: number;
  maxLevel: number;
  size: number;
  eligible: boolean;
  blocked: FinderBlockReason;
  // Whole minutes left on MY lockout for this activity (0 = unlocked). Minute
  // granularity keeps the render-skip signature from churning every second.
  lockedMinutes: number;
  selected: boolean;
  // The final boss's prerendered still: the activity's rail/detail icon.
  portraitUrl: string;
}

export interface FinderLootItemView {
  itemId: string;
  chance: number; // 0..1 (within a group: the share of the guaranteed roll)
  quality: FinderItemQuality;
}

export interface FinderLootGroupView {
  // True when the group's chances partition a full draw (sum ~1), so exactly
  // one item always drops; false for authored bonus groups whose chances sum
  // below 1 (at most one item drops).
  guaranteed: boolean;
  items: FinderLootItemView[];
}

export interface FinderEncounterViewModel {
  mobId: string;
  final: boolean;
  summoned: boolean;
  mechanics: string[];
  portraitUrl: string;
  copper: number;
  // Roll groups: exactly one item of each group drops (chances within a group
  // partition one draw). Singles: independent authored chances.
  groups: FinderLootGroupView[];
  singles: FinderLootItemView[];
  // Extra heroic-only groups appended on heroic difficulty (final boss only).
  heroicGroups: FinderLootGroupView[];
}

export interface FinderActivityDetailView {
  id: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  kind: FinderActivityKind;
  minLevel: number;
  maxLevel: number;
  size: number;
  composition: { tank: number; healer: number; dps: number } | null;
  autoQueue: boolean;
  entrance: { x: number; z: number; zoneId: string };
  lockout: 'none' | 'daily';
  lockedMinutes: number;
  attunementQuestId: string | null;
  heroicMarks: number; // marks per participant on the heroic final boss (0 = none)
  eligible: boolean;
  blocked: FinderBlockReason;
  encounters: FinderEncounterViewModel[];
}

export interface FinderRoleOptionView {
  role: Role;
  eligible: boolean;
  selected: boolean;
}

export interface FinderQueueOptionView {
  id: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  kind: FinderActivityKind;
  eligible: boolean;
  blocked: FinderBlockReason;
  checked: boolean; // painter-staged pre-join selection, or live selection while queued
}

export interface FinderProposalPanelView {
  id: number;
  activityId: string;
  dungeonId: string;
  difficulty: DungeonDifficulty;
  role: Role;
  size: number;
  myResponse: 'pending' | 'accepted';
}

export interface FinderQueuePanelView {
  roles: FinderRoleOptionView[];
  needsSpec: boolean; // level 10+ with no active spec: the finder is closed
  inParty: boolean;
  isLeader: boolean; // solo counts as leader of self
  queuedActivities: string[]; // live selection while queued ([] otherwise)
  queued: boolean;
  onCooldown: boolean;
  canQueue: boolean; // roles picked, leader-or-solo, not queued, not on cooldown
  options: FinderQueueOptionView[];
  proposal: FinderProposalPanelView | null;
}

export interface FinderListingRowView extends DungeonFinderListingView {
  dungeonId: string;
  difficulty: DungeonDifficulty;
  kind: FinderActivityKind;
  mine: boolean;
  applied: boolean;
  canApply: boolean;
  blocked: FinderBlockReason;
}

export interface FinderBoardPanelView {
  listings: FinderListingRowView[];
  myListing: DungeonFinderMyListingView | null;
  myApplicationListingId: number | null;
  canCreate: boolean;
  createGate: 'leader' | 'exists' | null;
  // All eligible activities for a new listing (the whole catalogue, filtered
  // to what my current group could lead).
  createOptions: { id: string; dungeonId: string; difficulty: DungeonDifficulty }[];
  tags: readonly FinderListingTag[];
}

// Live text slots the painter refreshes in place (1 Hz max), outside `sig`.
export interface FinderClocksView {
  queueWaited: number | null; // whole seconds in queue
  cooldown: number; // whole seconds left (0 = clear)
  proposalRemaining: number | null; // whole seconds left on the proposal
  proposalAccepted: number | null; // members accepted so far
  proposalSize: number | null;
}

export type DungeonFinderViewModel =
  | { kind: 'loading' }
  | {
      kind: 'live';
      tab: FinderTab;
      rows: FinderActivityRowView[];
      detail: FinderActivityDetailView | null;
      queue: FinderQueuePanelView;
      board: FinderBoardPanelView;
      clocks: FinderClocksView;
      sig: string;
    };

export interface DungeonFinderViewInput {
  info: DungeonFinderInfo | null;
  board: DungeonFinderBoard | null;
  playerLevel: number;
  playerClass: PlayerClass;
  playerId: number;
  specRole: Role | null;
  // Derived from partyInfo by the painter (null = solo).
  party: { leader: number; size: number } | null;
  lockouts: RaidLockout[];
  // Painter-local UI state.
  tab: FinderTab;
  selectedActivityId: string | null;
  stagedActivityIds: readonly string[]; // pre-join checklist while NOT queued
}

function blockReasonFor(
  activity: FinderActivity,
  level: number,
  specRole: Role | null,
): FinderBlockReason {
  if (level < activity.minLevel || level > activity.maxLevel) return 'level';
  if (level >= FIRST_TALENT_LEVEL && specRole === null) return 'spec';
  return null;
}

function lockoutMinutesFor(activity: FinderActivity, lockouts: RaidLockout[]): number {
  const key =
    activity.difficulty === 'heroic' ? `${activity.dungeonId}:heroic` : activity.dungeonId;
  const hit = lockouts.find((l) => l.id === key);
  if (!hit || activity.lockout !== 'daily') return 0;
  return Math.max(1, Math.ceil(hit.msRemaining / 60000));
}

function lootItem(entry: { itemId?: string; chance: number }): FinderLootItemView | null {
  if (!entry.itemId) return null;
  const def = ITEMS[entry.itemId];
  if (!def) return null;
  return { itemId: entry.itemId, chance: entry.chance, quality: def.quality ?? 'common' };
}

function lootGroups(entries: { itemId?: string; chance: number; rollGroup?: string }[]): {
  groups: FinderLootGroupView[];
  singles: FinderLootItemView[];
} {
  const byGroup = new Map<string, FinderLootItemView[]>();
  const singles: FinderLootItemView[] = [];
  for (const entry of entries) {
    const item = lootItem(entry);
    if (!item) continue;
    if (entry.rollGroup) {
      const list = byGroup.get(entry.rollGroup) ?? [];
      list.push(item);
      byGroup.set(entry.rollGroup, list);
    } else {
      singles.push(item);
    }
  }
  return {
    groups: [...byGroup.values()].map((items) => ({
      guaranteed: items.reduce((sum, i) => sum + i.chance, 0) >= 0.999,
      items,
    })),
    singles,
  };
}

function buildEncounters(activity: FinderActivity): FinderEncounterViewModel[] {
  const out: FinderEncounterViewModel[] = [];
  for (const enc of activity.encounters) {
    const mob = MOBS[enc.mobId];
    if (!mob) continue;
    const loot = (mob.loot ?? []).filter((e) => !e.questId);
    const { groups, singles } = lootGroups(loot);
    let copper = 0;
    for (const e of loot) if (e.copper) copper += e.copper;
    const heroicGroups =
      activity.difficulty === 'heroic' && enc.final
        ? lootGroups(HEROIC_BOSS_LOOT[enc.mobId] ?? []).groups
        : [];
    out.push({
      mobId: enc.mobId,
      final: enc.final === true,
      summoned: enc.summoned === true,
      mechanics: [...enc.mechanics],
      portraitUrl: `${FINDER_PORTRAIT_DIR}/${enc.mobId}.webp`,
      copper,
      groups,
      singles,
      heroicGroups,
    });
  }
  return out;
}

function buildDetail(
  activity: FinderActivity,
  level: number,
  specRole: Role | null,
  lockouts: RaidLockout[],
): FinderActivityDetailView {
  const door = DUNGEONS[activity.entranceDungeonId]?.doorPos ?? { x: 0, z: 0 };
  const tuning = HEROIC_DUNGEON_TUNING[activity.dungeonId];
  const blocked = blockReasonFor(activity, level, specRole);
  return {
    id: activity.id,
    dungeonId: activity.dungeonId,
    difficulty: activity.difficulty,
    kind: activity.kind,
    minLevel: activity.minLevel,
    maxLevel: activity.maxLevel,
    size: activity.size,
    composition: activity.composition ? { ...activity.composition } : null,
    autoQueue: activity.autoQueue,
    entrance: { x: door.x, z: door.z, zoneId: zoneAt(door.z).id },
    lockout: activity.lockout,
    lockedMinutes: lockoutMinutesFor(activity, lockouts),
    attunementQuestId: activity.attunementQuestId ?? null,
    heroicMarks: activity.difficulty === 'heroic' && tuning ? tuning.marksPerParticipant : 0,
    eligible: blocked === null,
    blocked,
    encounters: buildEncounters(activity),
  };
}

export function buildDungeonFinderView(input: DungeonFinderViewInput): DungeonFinderViewModel {
  const { info } = input;
  if (!info) return { kind: 'loading' };

  const level = input.playerLevel;
  const specRole = input.specRole;
  const selectedId =
    input.selectedActivityId && finderActivity(input.selectedActivityId)
      ? input.selectedActivityId
      : FINDER_ACTIVITIES[0].id;

  const rows: FinderActivityRowView[] = FINDER_ACTIVITIES.map((a) => {
    const blocked = blockReasonFor(a, level, specRole);
    const finalEnc = a.encounters.find((e) => e.final) ?? a.encounters[a.encounters.length - 1];
    return {
      portraitUrl: `${FINDER_PORTRAIT_DIR}/${finalEnc.mobId}.webp`,
      id: a.id,
      dungeonId: a.dungeonId,
      difficulty: a.difficulty,
      kind: a.kind,
      minLevel: a.minLevel,
      maxLevel: a.maxLevel,
      size: a.size,
      eligible: blocked === null,
      blocked,
      lockedMinutes: lockoutMinutesFor(a, input.lockouts),
      selected: a.id === selectedId,
    };
  });
  const selected = finderActivity(selectedId);
  const detail = selected ? buildDetail(selected, level, specRole, input.lockouts) : null;

  // --- Quick Match panel ---
  const eligibleRoles = compatibleFinderRoles(input.playerClass, level, specRole);
  const roleOptions: FinderRoleOptionView[] = (['tank', 'healer', 'dps'] as const).map((role) => ({
    role,
    eligible: eligibleRoles.includes(role),
    selected: info.roles.includes(role),
  }));
  const queued = info.queue !== null;
  const isLeader = input.party === null || input.party.leader === input.playerId;
  const onCooldown = info.cooldown > 0;
  const options: FinderQueueOptionView[] = FINDER_ACTIVITIES.filter((a) => a.autoQueue).map((a) => {
    const blocked = blockReasonFor(a, level, specRole);
    return {
      id: a.id,
      dungeonId: a.dungeonId,
      difficulty: a.difficulty,
      kind: a.kind,
      eligible: blocked === null,
      blocked,
      checked: queued
        ? (info.queue?.activities.includes(a.id) ?? false)
        : input.stagedActivityIds.includes(a.id),
    };
  });
  const proposalActivity = info.proposal ? finderActivity(info.proposal.activityId) : null;
  const queuePanel: FinderQueuePanelView = {
    roles: roleOptions,
    needsSpec: level >= FIRST_TALENT_LEVEL && specRole === null,
    inParty: input.party !== null,
    isLeader,
    queuedActivities: info.queue ? [...info.queue.activities] : [],
    queued,
    onCooldown,
    canQueue:
      !queued &&
      !onCooldown &&
      isLeader &&
      info.roles.length > 0 &&
      options.some((o) => o.checked && o.eligible),
    options,
    proposal:
      info.proposal && proposalActivity
        ? {
            id: info.proposal.id,
            activityId: info.proposal.activityId,
            dungeonId: proposalActivity.dungeonId,
            difficulty: proposalActivity.difficulty,
            role: info.proposal.role,
            size: info.proposal.size,
            myResponse: info.proposal.myResponse,
          }
        : null,
  };

  // --- Premade board panel ---
  const board = input.board ?? [];
  const listings: FinderListingRowView[] = [];
  for (const listing of board) {
    const activity = finderActivity(listing.activityId);
    if (!activity) continue;
    const blocked = blockReasonFor(activity, level, specRole);
    const mine = info.myListing?.id === listing.id;
    const roleFit =
      activity.composition === null || info.roles.some((r) => (listing.needed?.[r] ?? 0) > 0);
    listings.push({
      ...listing,
      dungeonId: activity.dungeonId,
      difficulty: activity.difficulty,
      kind: activity.kind,
      mine,
      applied: info.myApplication?.listingId === listing.id,
      blocked,
      canApply:
        !mine &&
        blocked === null &&
        input.party === null &&
        info.myApplication === null &&
        listing.size < listing.capacity &&
        roleFit,
    });
  }
  const boardPanel: FinderBoardPanelView = {
    listings,
    myListing: info.myListing,
    myApplicationListingId: info.myApplication?.listingId ?? null,
    canCreate: info.myListing === null && isLeader,
    createGate: info.myListing !== null ? 'exists' : isLeader ? null : 'leader',
    createOptions: FINDER_ACTIVITIES.filter(
      (a) => blockReasonFor(a, level, specRole) === null && (input.party?.size ?? 1) < a.size,
    ).map((a) => ({ id: a.id, dungeonId: a.dungeonId, difficulty: a.difficulty })),
    tags: FINDER_LISTING_TAGS,
  };

  const clocks: FinderClocksView = {
    queueWaited: info.queue?.waited ?? null,
    cooldown: info.cooldown,
    proposalRemaining: info.proposal?.remaining ?? null,
    proposalAccepted: info.proposal?.accepted ?? null,
    proposalSize: info.proposal?.size ?? null,
  };

  // Render-skip signature: every STRUCTURAL input, none of the 1 Hz clock
  // numbers (those repaint through the clock slots). Kept as raw source data,
  // matched verbatim, so the painter rebuilds exactly when a source changes.
  const sig = JSON.stringify([
    input.tab,
    selectedId,
    rows.map((r) => [r.eligible, r.blocked, r.lockedMinutes]),
    info.roles,
    eligibleRoles,
    queuePanel.needsSpec,
    queuePanel.isLeader,
    queuePanel.queued,
    queuePanel.onCooldown,
    queuePanel.canQueue,
    options.map((o) => [o.id, o.eligible, o.checked]),
    info.proposal ? [info.proposal.id, info.proposal.role, info.proposal.myResponse] : null,
    listings.map((l) => [l.id, l.size, l.needed, l.tags, l.members, l.applied, l.canApply, l.mine]),
    info.myListing,
    info.myApplication,
    boardPanel.canCreate,
    input.stagedActivityIds,
  ]);

  return {
    kind: 'live',
    tab: input.tab,
    rows,
    detail,
    queue: queuePanel,
    board: boardPanel,
    clocks,
    sig,
  };
}

// ---------------------------------------------------------------------------
// Proposal popup (the WoW-style "group found" prompt shown OUTSIDE the finder
// window, at the top of the screen). Same pure-core rules as the window view:
// DOM/i18n-free, clock numbers outside the signature.
// ---------------------------------------------------------------------------

export interface FinderProposalPopupSlot {
  role: Role;
  total: number;
  accepted: number;
  mine: boolean; // my assigned role slot (highlighted)
}

export interface FinderProposalPopupView {
  dungeonId: string;
  difficulty: DungeonDifficulty;
  slots: FinderProposalPopupSlot[];
  myResponse: 'pending' | 'accepted';
  remaining: number; // whole seconds (clock slot, OUTSIDE sig)
  sig: string;
}

// null = no live proposal (the popup closes itself).
export function buildFinderProposalPopupView(
  info: DungeonFinderInfo | null,
): FinderProposalPopupView | null {
  const p = info?.proposal;
  if (!p) return null;
  const activity = finderActivity(p.activityId);
  if (!activity || activity.composition === null) return null;
  const comp = activity.composition;
  const slots: FinderProposalPopupSlot[] = (['tank', 'healer', 'dps'] as const).map((role) => ({
    role,
    total: comp[role],
    accepted: Math.min(comp[role], p.acceptedByRole?.[role] ?? 0),
    mine: p.role === role,
  }));
  return {
    dungeonId: activity.dungeonId,
    difficulty: activity.difficulty,
    slots,
    myResponse: p.myResponse,
    remaining: p.remaining,
    sig: JSON.stringify([
      p.id,
      p.myResponse,
      slots.map((s) => [s.role, s.total, s.accepted, s.mine]),
    ]),
  };
}
