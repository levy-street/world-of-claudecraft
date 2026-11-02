import type { CampDef } from '../types';

// Mob camps the Studio town rework added (the Eastbrook and Mirefen changes
// map, #4593): mobs the map placed beyond what the shipped camps near them
// hold. Appended LAST to CAMPS (data.ts), offStream so they draw from private
// sub-streams and move no shipped camp's shared world-gen draws; each mob
// stands on its authored spot.
export const STUDIO_REWORK_CAMPS: CampDef[] = [
  {
    mobId: 'ridge_stalker',
    center: { x: 71.08, z: 580.07 },
    radius: 7.7,
    count: 2,
    spots: [
      { x: 75.41, z: 585.19 },
      { x: 66.74, z: 574.94 },
    ],
    offStream: true,
  },
  {
    mobId: 'ridge_stalker',
    center: { x: 41.35, z: 556.23 },
    radius: 5.1,
    count: 2,
    spots: [
      { x: 44.98, z: 554.23 },
      { x: 37.71, z: 558.22 },
    ],
    offStream: true,
  },
  {
    mobId: 'ridge_stalker',
    center: { x: 45.17, z: 573.11 },
    radius: 2,
    count: 1,
    spots: [{ x: 45.17, z: 573.11 }],
    offStream: true,
  },
  {
    mobId: 'thornpeak_ogre',
    center: { x: -128.99, z: 718.92 },
    radius: 2,
    count: 1,
    spots: [{ x: -128.99, z: 718.92 }],
    offStream: true,
  },
  {
    mobId: 'hedge_gnome',
    center: { x: 459.63, z: 913.29 },
    radius: 3,
    count: 2,
    spots: [
      { x: 458.63, z: 912.29 },
      { x: 460.63, z: 914.29 },
    ],
    offStream: true,
  },
  {
    mobId: 'vale_bandit',
    center: { x: 67.2, z: 40.95 },
    radius: 2,
    count: 1,
    spots: [{ x: 67.2, z: 40.95 }],
    offStream: true,
  },
  {
    mobId: 'restless_bones',
    center: { x: 114.35, z: 72.74 },
    radius: 2,
    count: 1,
    spots: [{ x: 114.35, z: 72.74 }],
    offStream: true,
  },
  {
    mobId: 'gloam_strider',
    center: { x: -413.29, z: 1512.58 },
    radius: 2,
    count: 1,
    spots: [{ x: -413.29, z: 1512.58 }],
    offStream: true,
  },
  {
    mobId: 'void_stalker',
    center: { x: 424.71, z: -39.02 },
    radius: 2,
    count: 1,
    spots: [{ x: 424.71, z: -39.02 }],
    offStream: true,
  },
];
