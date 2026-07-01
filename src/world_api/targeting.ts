export interface IWorldTargeting {
  targetEntity(id: number | null): void;
  // Assist: adopt whatever the current target is targeting (target of target).
  assistTarget(): void;
  tabTarget(): void;
  targetNearestFriendly(): void;
  friendlyTabTarget(): void;
}
