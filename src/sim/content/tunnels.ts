// Hand-authored tunnel/cave volumes carved into the voxel density field
// (see ../voxel.ts). Declarative data, no RNG: a tunnel is a capsule path
// (a polyline of waypoints, each with its own radius) subtracted from the
// solid terrain. Append-only content table, same spirit as content/dungeons.ts.
export interface TunnelWaypoint {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface TunnelVolume {
  id: string;
  waypoints: TunnelWaypoint[];
}

// A short kobold-warren tunnel under the Vale foothills, mouth open to the
// surface near (60, 150) then dipping underground and dead-ending in a small
// chamber. Coordinates sit well clear of zone hubs/camps/roads.
export const TUNNELS: TunnelVolume[] = [
  {
    id: 'vale_kobold_warren',
    waypoints: [
      { x: 60, y: 6, z: 150, radius: 3.2 },
      { x: 66, y: 1, z: 158, radius: 2.8 },
      { x: 74, y: -4, z: 168, radius: 2.6 },
      { x: 84, y: -6, z: 176, radius: 3.6 },
    ],
  },
];
