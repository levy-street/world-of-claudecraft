// Type surface for family_guard.mjs (the bestiary FAMILY_ORDER guard), so the vitest
// suite imports it under strict TS like the other declared scripts modules.
export declare function assertFamiliesKnown(
  famMap: Record<string, unknown>,
  familyOrder: readonly string[],
): void;
