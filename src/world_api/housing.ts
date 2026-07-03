// ---------------------------------------------------------------------------
// Player housing (the Homestead Glens). The deed is bought once from the Land
// Steward; travel is teleport-only (Steward out, plot gate back). Ownership is
// the one mirrored read; occupancy and the plot itself are world-side.
// ---------------------------------------------------------------------------

export interface IWorldHousing {
  // The viewer holds the homestead deed (rides the self snapshot).
  homesteadOwned: boolean;
  /** Buy the deed from the Land Steward (100 gold, once). */
  homesteadBuy(): void;
  /** Teleport from the Land Steward to your plot in the Homestead Glens. */
  homesteadTravel(): void;
  /** Teleport from the plot gate back to Eastbrook. */
  homesteadLeave(): void;
}
