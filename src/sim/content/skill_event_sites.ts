// Fixed arenas for the hourly skill events (src/sim/pvp/skill_events.ts).
//
// DATA, not logic. Picked by hand from a terrain scan (owner brief, 2026-11-12):
// flat open ground in a monster-free pocket of every overworld zone except the
// Proving Shore, Eastbrook Vale, the Farshore, Mirefen Marsh, Thornpeak
// Heights and the three King of the Hill zones (the Drakelands, the Frostveil
// Reach, the Amberfall), then reviewed site by site by the owner. Every arena
// keeps away from towns, graveyards, NPCs, quest objects and the heart of
// every world quest area. Trees, rocks and water may sit inside an arena. Each
// entry is the centre of a SKILL_EVENT_RADIUS circle; tests/skill_events.test.ts
// pins that every circle stays inside its zone, clear of the world quests, and
// that the King of the Hill spot picker never lands on one.

export interface SkillEventSite {
  /** Stable id: the zone id plus the site's number in that zone. */
  id: string;
  zoneId: string;
  x: number;
  z: number;
}

export const SKILL_EVENT_SITES: readonly SkillEventSite[] = [
  { id: 'veiled_hollow_2', zoneId: 'veiled_hollow', x: -73, z: 1103 },
  { id: 'willowfen_1', zoneId: 'willowfen', x: -361, z: 611 },
  { id: 'willowfen_2', zoneId: 'willowfen', x: -485, z: 379 },
  { id: 'willowfen_3', zoneId: 'willowfen', x: -369, z: 243 },
  { id: 'nightbloom_1', zoneId: 'nightbloom', x: -329, z: 1307 },
  { id: 'nightbloom_2', zoneId: 'nightbloom', x: -337, z: 1739 },
  { id: 'nightbloom_3', zoneId: 'nightbloom', x: -473, z: 1567 },
  { id: 'wraithwood_1', zoneId: 'wraithwood', x: 247, z: 1551 },
  { id: 'wraithwood_2', zoneId: 'wraithwood', x: 315, z: 1699 },
  { id: 'palmreach_1', zoneId: 'palmreach', x: -397, z: 747 },
  { id: 'palmreach_2', zoneId: 'palmreach', x: -241, z: 995 },
  { id: 'palmreach_3', zoneId: 'palmreach', x: -433, z: 1035 },
  { id: 'evergarden_2', zoneId: 'evergarden', x: 239, z: 803 },
  { id: 'galecrest_1', zoneId: 'galecrest', x: 347, z: 359 },
  { id: 'galecrest_2', zoneId: 'galecrest', x: 387, z: 495 },
  { id: 'galecrest_3', zoneId: 'galecrest', x: 223, z: 459 },
];
