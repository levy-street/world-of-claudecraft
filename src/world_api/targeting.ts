export interface IWorldTargeting {
  targetEntity(id: number | null): void;
  tabTarget(): void;
  // The backward half of the Tab cycle (Shift+Tab by default): steps the same
  // ordered enemy list as tabTarget in reverse.
  tabTargetPrev(): void;
  targetNearestFriendly(): void;
  friendlyTabTarget(): void;
  // Mirrors the client's "Stop Auto-Attack on Target Switch" setting (issue
  // #1358) onto the authoritative sim: when enabled, every target-switch
  // selector disengages auto-attack instead of carrying it over to the new
  // target. The sim stays authoritative and language-agnostic, so this is a
  // preference toggle wired like any other player setting, not a client-only
  // decision.
  setStopAutoAttackOnTargetSwitch(enabled: boolean): void;
}
