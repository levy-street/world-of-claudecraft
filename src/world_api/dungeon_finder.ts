// IWorldDungeonFinder: the Dungeon Finder facet (docs/prd/dungeon-finder.md).
// Snapshot reads, queue/listing commands and open running expeditions:
// expedition travel rejoins an existing claim without resetting its progress.
// Layer-agnostic: type-only sim imports, no t(), no DOM (guarded by
// tests/architecture.test.ts).
import type { FinderListingTag } from '../sim/content/dungeon_finder';
import type { QueueRewardId } from '../sim/content/queue_rewards';
import type { Role } from '../sim/content/talents';
import type {
  ExpeditionAvailability,
  ExpeditionDetails,
  ExpeditionFeedback,
} from '../sim/social/expedition_social';
import type { FinderAdvertCooldownView, FinderAdvertTarget } from '../sim/social/finder_advert';
import type { FinderPartyRole } from '../sim/social/finder_listing_edit';
import type { EquipSlot, PlayerClass } from '../sim/types';

export type ExpeditionSettings =
  | { kind: 'recruit'; activityId: string; role: Role; details: ExpeditionDetails }
  | { kind: 'details'; details: ExpeditionDetails }
  | { kind: 'available'; enabled: boolean; roles: Role[] }
  | { kind: 'reward'; id: QueueRewardId | null; buy: boolean }
  | { kind: 'cancel_application'; listingId: number }
  // Post my listing's "LFM" line to General chat or Discord (cooldown-gated).
  | { kind: 'advertise'; target: FinderAdvertTarget }
  // Assign roles to the party members my listing brought along (leader only;
  // the whole list, so a member left out seats by their own selection).
  | { kind: 'party_roles'; roles: FinderPartyRole[] }
  // Move my listing to the same content's other difficulty.
  | { kind: 'difficulty'; activityId: string };

export interface DungeonFinderApplicationView {
  listingId: number;
  remaining?: number;
  leaderName?: string;
  activityId?: string;
}

// My automatic-queue state. `waited` is whole seconds since the original join
// (preserved when a failed proposal returns the unit to the queue).
export interface DungeonFinderQueueView {
  activities: string[]; // selected activity ids, catalogue order
  waited: number;
}

// A live 30-second availability proposal as the local player sees it. Counts
// only, no names: participants stay anonymous until the group forms.
export interface DungeonFinderProposalView {
  id: number;
  activityId: string;
  role: Role; // my assigned role
  size: number; // total participants
  accepted: number; // participants who accepted so far
  // Accepted count per role slot (drives the WoW-style proposal popup meters).
  acceptedByRole: { tank: number; healer: number; dps: number };
  myResponse: 'pending' | 'accepted';
  remaining: number; // whole seconds until the proposal expires
}

// One applicant line on my own listing (leaders see who is asking).
export interface DungeonFinderApplicantView {
  pid: number;
  name: string;
  cls: PlayerClass;
  spec?: string | null; // actual chosen specialization, absent on older snapshots
  level: number;
  roles: Role[]; // the applicant's compatible selected roles
  remaining?: number;
  // Worn item ids by slot, shown to the listing leader only (applying shares
  // them, like the class and spec above), so the leader can inspect the
  // applicant from anywhere on the realm. Absent on older snapshots.
  gear?: Partial<Record<EquipSlot, string>>;
}

// My own published listing (present only for its leader).
export interface DungeonFinderMyListingView {
  id: number;
  activityId: string;
  tags: FinderListingTag[];
  applicants: DungeonFinderApplicantView[];
  details?: ExpeditionDetails;
  // The "LFM - ..." line the advert buttons post (built by the sim).
  advertText?: string;
  // Roles I assigned to the party members this listing brought along (members
  // without an entry seat by their own role selection). Absent on older snapshots.
  partyRoles?: FinderPartyRole[];
}

export interface DungeonFinderExpeditionView {
  exitId: number;
  activityId: string;
  dungeonId: string;
  leaderPid: number;
  isLeader: boolean;
  isInside: boolean;
  canTravel: boolean;
  open: boolean;
  bossesDefeated: number;
  bossesTotal: number;
}

// Per-player finder snapshot (the `df` self field online).
export interface DungeonFinderInfo {
  roles: Role[]; // my sticky role selection
  eligibleRoles: Role[]; // roles my class/level/spec may select right now
  queue: DungeonFinderQueueView | null;
  cooldown: number; // whole seconds until I may queue again (0 = clear)
  proposal: DungeonFinderProposalView | null;
  myListing: DungeonFinderMyListingView | null;
  myApplication: DungeonFinderApplicationView | null;
  myApplications?: DungeonFinderApplicationView[];
  expedition?: DungeonFinderExpeditionView | null;
  availability?: ExpeditionAvailability;
  applicationFeedback?: ExpeditionFeedback | null;
  // Advert cooldowns for my listing's post buttons (server-owned online).
  advert?: FinderAdvertCooldownView;
  queueRewards?: {
    balance: number;
    earnedToday: number;
    dailyCap: number;
    unlocked: QueueRewardId[];
    equipped: QueueRewardId | null;
  };
}

// One row of the public premade board. Viewer-independent (the board is shared
// realm state; "did I apply" is derived client-side from myApplications).
export interface DungeonFinderListingView {
  id: number;
  activityId: string;
  leaderName: string;
  expedition?: { bossesDefeated: number; bossesTotal: number };
  details?: ExpeditionDetails;
  tags: FinderListingTag[];
  // The leader's guild, present only on a Guild Party (the guild_only tag).
  guild?: string;
  size: number; // current member count
  capacity: number; // activity size
  // Open role slots under the activity's composition; null when the activity
  // does not enforce roles (the solo crypt's social listings).
  needed: { tank: number; healer: number; dps: number } | null;
  members: { cls: PlayerClass; level: number; role: Role | null }[];
}

// The open premade board (the `dfb` self field online; bounded server-side).
export type DungeonFinderBoard = DungeonFinderListingView[];

export interface IWorldDungeonFinder {
  // null = online mirror not yet synced
  dungeonFinderInfo: DungeonFinderInfo | null;
  dungeonFinderBoard: DungeonFinderBoard | null;
  // Sticky role selection, validated server-side against class/level/spec.
  dungeonFinderSetRoles(roles: Role[]): void;
  // Join the automatic queue for one or more eligible activities (party leaders
  // enqueue their whole party as one indivisible unit).
  dungeonFinderQueueJoin(activityIds: string[]): void;
  dungeonFinderQueueLeave(): void;
  // Answer the live availability proposal.
  dungeonFinderRespond(accept: boolean): void;
  // Publish / close my premade listing for one activity.
  dungeonFinderListingCreate(activityId: string, tags: FinderListingTag[]): void;
  dungeonFinderListingClose(): void;
  dungeonFinderExpeditionOpen(): void;
  dungeonFinderExpeditionTravel(): void;
  dungeonFinderExpeditionApply(listingId: number, role: Role): void;
  dungeonFinderExpeditionConfigure(settings: ExpeditionSettings): void;
  // Apply to a listing / withdraw my pending application.
  dungeonFinderApply(listingId: number): void;
  dungeonFinderApplyCancel(): void;
  // Leader decision on an application (acceptance adds the applicant through
  // the authoritative party machine after revalidation).
  dungeonFinderApplicationRespond(applicantPid: number, accept: boolean): void;
}
