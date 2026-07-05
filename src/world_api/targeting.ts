export interface IWorldTargeting {
  targetEntity(id: number | null): void;
  tabTarget(): void;
  targetNearestFriendly(): void;
  friendlyTabTarget(): void;
}
