// The Anvil of the World's rite marks on the floor: the four vein grooves
// (heart_vein_groove_core.ts) and the arrival's sockets, the pits the heart
// tore the colossus's rock out of (docs/design/raid/kit/quarter_geom.py
// `SOCKETS`, carved into each quarter's floor piece by quarter_pieces.py).
// Jose's playtest of 2026-11-19: they belong to the boss's entrance, not to
// the fight. The floor draws them only while the arrival (or the death) plays
// (`heartFloorRite`, 1 shown, 0 gone): the grooves' carving fades with it and
// every socket's pit and broken paving rise flush into the sheet, painted as
// the slabs round them (heart_floor_glsl.ts `heartFloorSocketGlsl`, the sheet's
// own broad paint sampled round each socket at build: `sampleHeartFloorSockets`).
// The quarter seams (the ridges) are separate pieces and stay.
//
// Pure and Three-free (RENDER_PURE_CORES); room-local yards (the floor pieces
// stand unturned at the room's centre), bearings clockwise from north.

/** quarter_geom.py SOCKETS: (bearing degrees, radius out, the piece's size). */
export const HEART_FLOOR_SOCKET_SPECS: readonly (readonly [number, number, number])[] = [
  [340.0, 38.5, 8.0],
  [20.0, 43.0, 11.0],
  [112.0, 41.5, 6.8],
  [292.0, 41.5, 6.8],
  [150.0, 33.0, 7.8],
  [325.0, 30.0, 7.8],
  [104.0, 47.0, 7.5],
  [284.0, 47.0, 7.5],
  [162.0, 46.0, 5.8],
  [252.0, 44.0, 5.8],
  [62.0, 46.0, 5.7],
];

/** quarter_geom.py `socket_radius` and `socket_zone`: the pit, and how far its
 *  broken paving reaches (its jagged edge wanders past it, by a quarter at most). */
export function heartSocketZone(size: number): number {
  return 0.85 + size * 0.085 + 1.15;
}

/** How far round its centre a socket is laid flush (yards): past the broken
 *  paving's most jagged reach, so no lip of it is left standing. */
export const HEART_SOCKET_MEND = 1.45;

export interface HeartFloorSocket {
  x: number;
  z: number;
  /** The mend's reach (yards). */
  r: number;
}

/** Every socket in room-local yards. */
export const HEART_FLOOR_SOCKETS: readonly HeartFloorSocket[] = HEART_FLOOR_SOCKET_SPECS.map(
  ([b, r, size]) => ({
    x: r * Math.sin((b * Math.PI) / 180),
    z: r * Math.cos((b * Math.PI) / 180),
    r: heartSocketZone(size) * HEART_SOCKET_MEND,
  }),
);

/** The ring round a socket whose sheet paint stands in for its mend: from
 *  its reach out this far (yards). */
export const HEART_SOCKET_SAMPLE = 2.5;

/** How much of the rite shows `t` seconds into a scene of `end` seconds:
 *  rising over `rise` from its start, held, then fading over its last `fade`
 *  (0 before and after it). */
export function heartFloorRite(t: number, end: number, rise: number, fade: number): number {
  if (!(t >= 0) || t >= end) return 0;
  const up = rise > 0 ? Math.min(1, t / rise) : 1;
  const down = fade > 0 ? Math.min(1, (end - t) / fade) : 1;
  const k = Math.max(0, Math.min(up, down));
  return k * k * (3 - 2 * k);
}

/** The socket `x, z` falls in (its index), else -1. */
export function heartFloorSocketAt(x: number, z: number): number {
  for (let i = 0; i < HEART_FLOOR_SOCKETS.length; i++) {
    const s = HEART_FLOOR_SOCKETS[i];
    if (Math.hypot(x - s.x, z - s.z) < s.r) return i;
  }
  return -1;
}
