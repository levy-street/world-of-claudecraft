export interface BgFlagInputWorld {
  bgInfo: { match: unknown } | null;
  bgFlagAction(): void;
}

/** Build the dedicated battleground flag input without retaining it in main.ts. */
export function createBgFlagKey(world: BgFlagInputWorld): () => void {
  return () => {
    if (world.bgInfo?.match) world.bgFlagAction();
  };
}
