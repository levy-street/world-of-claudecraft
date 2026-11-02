import type { CampDef } from '../types';

// Mob camps the Studio town rework added (the Eastbrook and Mirefen changes
// map, #4593): spawns the map placed away from every shipped camp. Appended
// LAST to CAMPS (data.ts), offStream so they draw from private sub-streams and
// move no shipped camp's shared world-gen draws.
export const STUDIO_REWORK_CAMPS: CampDef[] = [
  { mobId: 'forest_wolf', center: { x: -33.36, z: 52.24 }, radius: 2, count: 1, offStream: true },
  { mobId: 'forest_wolf', center: { x: -27.35, z: 35.44 }, radius: 7.9, count: 2, offStream: true },
  {
    mobId: 'webwood_spider',
    center: { x: -78.14, z: 51.57 },
    radius: 15.8,
    count: 3,
    offStream: true,
  },
  {
    mobId: 'ridge_stalker',
    center: { x: 71.08, z: 580.07 },
    radius: 7.7,
    count: 2,
    offStream: true,
  },
  {
    mobId: 'ridge_stalker',
    center: { x: 41.35, z: 556.23 },
    radius: 5.1,
    count: 2,
    offStream: true,
  },
  {
    mobId: 'thornpeak_ogre',
    center: { x: -123.88, z: 715.5 },
    radius: 7.1,
    count: 2,
    offStream: true,
  },
  {
    mobId: 'thornpeak_ogre',
    center: { x: -132.54, z: 699.94 },
    radius: 2,
    count: 1,
    offStream: true,
  },
  {
    mobId: 'ogre_crusher',
    center: { x: -101.08, z: 744.35 },
    radius: 2,
    count: 1,
    offStream: true,
  },
  { mobId: 'hedge_gnome', center: { x: 459.63, z: 913.29 }, radius: 3, count: 2, offStream: true },
  { mobId: 'hedge_gnome', center: { x: 465.98, z: 927.09 }, radius: 2, count: 1, offStream: true },
];
