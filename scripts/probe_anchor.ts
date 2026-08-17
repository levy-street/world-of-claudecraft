// Where a combat probe or a combat fixture stands.
//
// Balance probes place their targets RELATIVE to the player, so the player has to stand
// somewhere with clear sight or the sim's own gates quietly change what is being measured.
// The v0.31 Eastbrook Vale rebuild (4012e813f) dropped civic structures around the spawn:
// from there nothing past about 25 yards has line of sight in any direction, and a target
// 20 yards north lands INSIDE a building footprint. That fails the Packlord pet reach gate
// (`hasLineOfSight(pet, target)`), which deleted every pet ability from the hunter probe and
// read Beast Mastery at 43 DPS against its real 68.
//
// tests/parity/scenarios.ts made the same decoupling for its combat scenarios with a south
// field anchor. This anchor is picked against the wider geometry the probes build (targets at
// offsets -4..+6 over distances 3..35, each with a pet beside it) on two criteria:
//
//  - every one of those 84 sight lines is clear against the v0.31 collider set, and
//  - the ground is FLAT across the whole footprint (0.15 of height variation, against 4.43
//    around the spawn). Ground-targeted area damage is placed on the ground while probe
//    targets are placed on the player's plane, so a slope silently drops targets out of the
//    zone: Vespers landed 12 Dirge of Decay casts here against 4 at the spawn, and its
//    second and third targets took damage instead of zero.
// Re-hunted for the v0.32.1 catch-up: the mounts/realm content wave built over the
// old (40, -18) field (it now fails BOTH criteria: sight lines blocked and 0.15+ of
// slope across the footprint). (50, -90) passes the full-resolution scan (every
// offset -4..+6 x distance 3..35 sight line incl. the pet-beside line clear, ground
// variation under 0.15) against the v0.32.1 collider set. Spares that also pass at
// full resolution: (-60, -10), (-70, -80).
export const PROBE_OPEN_FIELD = { x: 50, z: -90 } as const;

interface AnchorableSim {
  player: {
    pos: { x: number; y: number; z: number };
    prevPos: { x: number; y: number; z: number };
  };
  cfg: { seed: number };
  groundPos(x: number, z: number): { x: number; y: number; z: number };
  rebucket(entity: unknown): void;
}

// Move the player to the open-field anchor and keep the spatial grid consistent, the same
// idiom every scenario fixture uses.
export function anchorProbeInOpenField(sim: AnchorableSim): void {
  sim.player.pos = sim.groundPos(PROBE_OPEN_FIELD.x, PROBE_OPEN_FIELD.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.rebucket(sim.player);
}
