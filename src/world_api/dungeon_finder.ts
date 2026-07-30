// IWorldDungeonFinder: the Dungeon Finder facet (docs/prd/dungeon-finder.md).
// Snapshot reads + queue/listing commands. The finder forms parties/raids only:
// it never teleports, enters an instance, or changes dungeon difficulty.
// Layer-agnostic: type-only sim imports, no t(), no DOM (guarded by
// tests/architecture.test.ts).
import type { FinderListingTag } from '../sim/content/dungeon_finder';
import type { Role } from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';

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
  level: number;
  roles: Role[]; // the applicant's compatible selected roles
}

// My own published listing (present only for its leader).
export interface DungeonFinderMyListingView {
  id: number;
  activityId: string;
  tags: FinderListingTag[];
  applicants: DungeonFinderApplicantView[];
}

// Per-player finder snapshot (the `df` self field online).
export interface DungeonFinderInfo {
  roles: Role[]; // my sticky role selection
  eligibleRoles: Role[]; // roles my class/level/spec may select right now
  queue: DungeonFinderQueueView | null;
  cooldown: number; // whole seconds until I may queue again (0 = clear)
  proposal: DungeonFinderProposalView | null;
  myListing: DungeonFinderMyListingView | null;
  myApplication: { listingId: number } | null;
}

// One row of the public premade board. Viewer-independent (the board is shared
// realm state; "did I apply" is derived client-side from myApplication).
export interface DungeonFinderListingView {
  id: number;
  activityId: string;
  leaderName: string;
  tags: FinderListingTag[];
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
  // Apply to a listing / withdraw my pending application.
  dungeonFinderApply(listingId: number): void;
  dungeonFinderApplyCancel(): void;
  // Leader decision on an application (acceptance adds the applicant through
  // the authoritative party machine after revalidation).
  dungeonFinderApplicationRespond(applicantPid: number, accept: boolean): void;
}
