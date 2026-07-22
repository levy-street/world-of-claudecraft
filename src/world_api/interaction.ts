export type WorldInteractionOutcome = boolean | Promise<boolean>;

export interface IWorldInteraction {
  interact(): void;
  lootCorpse(id: number): WorldInteractionOutcome;
  autoLoot(id: number): void;
  // `components`: the player's per-corpse focus pick (#1142), which tagged
  // component(s) to extract. OMITTED (Phase 12d) resolves server-side to the
  // caller's persistent town focus: the corpse tags holding allocation points
  // (none focused spreads). An EXPLICIT array keeps the #1142 semantics:
  // empty or covering every tagged component spreads across every tag.
  harvestCorpse(id: number, components?: string[]): void;
  pickUpObject(id: number): WorldInteractionOutcome;
  // #1143: the caller's persistent town focus allocation (component type ->
  // points spent). Empty when unset.
  townFocus: Record<string, number>;
  // Sets the persistent town focus allocation. Rejected (out of town,
  // malformed, over the point budget) server-side; the previous allocation is
  // kept and a toast is shown.
  setTownFocus(allocation: Record<string, number>): void;
}
