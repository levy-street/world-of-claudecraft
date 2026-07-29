// How much taller a player body renders than a stock humanoid NPC.
//
// Its own module because two independent places must agree on it and neither can
// import the other's dependencies: manifest.ts derives the player VisualDef
// heights from it, and preview_framing.ts scales the framed-preview cameras by it
// (it is deliberately three-free and import-light so a Node test can pin the exact
// framings, so it cannot pull in manifest.ts and the whole content graph).
//
// The two are load-bearing TOGETHER: the preview cameras are absolute world-unit
// positions composed around a body of a known height, so growing the body without
// pulling the camera back crops the head and feet out of the character screen.
// Anything else composed against an absolute body height belongs here too.

/** Player bodies render 20% taller than a stock humanoid NPC (mobs and townsfolk
 *  stay at the stock height; see HUMANOID_H in manifest.ts). */
export const PLAYER_HEIGHT_SCALE = 1.2;
