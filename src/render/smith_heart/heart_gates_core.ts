// Pure plan for the Smith's Heart's gate looks (heart_gates.ts), on the
// shared gate memory (../hollow_crypt/crypt_gate_state_core.ts, fed by the
// mirrored gate entities through ../gate_objects.ts):
//   - 'stone_slab': a slab of living stone across the passage. Opening, it
//     splits down the middle, the halves part and sink into the floor;
//   - 'forge_seal': a LOW barrier, never a wall, and nothing metal (the raid
//     is primal and divine): the Smith's carved threshold of granite across
//     the passage, a channel down its top with crystal growing in it, a few
//     small clusters standing proud of it (never in the middle: the line a
//     raid looks along), a rough-hewn standing stone at each end with a
//     crystal crown, and a curtain of crystal light rising out of the
//     channel, tinted by the gate's vein (`heartGateTint`; the Heart
//     Bridge's braids all four). HEART_SEAL_BARRIER caps the whole at about
//     three yards, so the causeway gates never hide the seal from the Ring.
//     Shut, the curtain burns; sealed behind the raid, it flares and beats.
//     Opening, the curtain drains down into its channel, then the threshold
//     sinks away; the standing stones stay.
// Every part is a box in the gate's frame (x across the passage, y up from
// its floor, z along it): the painter draws them, and the sightline pin
// (heart_sightline_core.ts) traces rays against the solid ones (the curtain
// and the channel's light are light, never solid).
//
// Three-free, DOM-free, deterministic.

import { SMITH_HEART_VEIN_COLORS, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import type { DungeonGateKind } from '../../sim/types';

export type HeartGateRig = 'slab' | 'seal';

/** The rig a Smith's Heart gate kind wears (null for a kind it never uses). */
export function heartGateRig(kind: DungeonGateKind): HeartGateRig | null {
  if (kind === 'stone_slab') return 'slab';
  if (kind === 'forge_seal') return 'seal';
  return null;
}

/** The slab's size (yards): it fills the passage up to this height. */
export const HEART_SLAB = { height: 9, thick: 2.2 } as const;
/** The forge seal's sizes (yards): the threshold's height and depth, the
 *  curtain of light's top above the floor, the standing stones' height (the
 *  tallest part) and footprint, the crystal clusters standing proud of the
 *  channel (their offsets a share of the half width, clear of the middle)
 *  and their top. */
export const HEART_SEAL_BARRIER = {
  sillHeight: 0.6,
  sillDepth: 0.9,
  veilTop: 2.2,
  postHeight: 2.8,
  postWidth: 1.2,
  postDepth: 1.3,
  crystalShares: [0.41, 0.79],
  crystalTop: 1.15,
  crystalWidth: 0.5,
} as const;

/** Whose light a forge seal gate burns with: its vein's, or (the Heart
 *  Bridge) all four braided. */
export type HeartGateVein = SmithHeartVein | 'heart';

const GATE_VEINS: Readonly<Record<string, HeartGateVein>> = {
  cornice_mouth: 'breath',
  lake_mouth: 'quench',
  anvil_mouth: 'heat',
  heart_bridge: 'heart',
};

/** The vein a gate's light is (the Heart's for any other). */
export function heartGateVein(gateId: string): HeartGateVein {
  return GATE_VEINS[gateId] ?? 'heart';
}

/** The Heart's own light: white-gold, the four veins met. */
export const HEART_GATE_HEART_TINT = 0xffe8c4;

/** A gate's tint: its vein's colour, or the Heart's white-gold. */
export function heartGateTint(gateId: string): number {
  const v = heartGateVein(gateId);
  return v === 'heart' ? HEART_GATE_HEART_TINT : SMITH_HEART_VEIN_COLORS[v];
}

export type HeartGatePartRole = 'half' | 'crack' | 'sill' | 'seam' | 'crystal' | 'veil' | 'post';

/** One part, shut, in the gate's frame: a box centred at (x, y, z), w x h x d. */
export interface HeartGatePart {
  role: HeartGatePartRole;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  /** -1 or 1 for a slab half (which way it parts) and a standing stone. */
  side?: number;
  /** Light, not stone: never in a sightline (the curtain, the channel). */
  light?: boolean;
}

/** Every part of a gate rig `width` yards across, shut. */
export function heartGateParts(rig: HeartGateRig, width: number): HeartGatePart[] {
  const half = width / 2;
  if (rig === 'slab') {
    const { height, thick } = HEART_SLAB;
    return [
      { role: 'half', side: -1, x: -half / 2, y: height / 2, z: 0, w: half, h: height, d: thick },
      { role: 'half', side: 1, x: half / 2, y: height / 2, z: 0, w: half, h: height, d: thick },
      { role: 'crack', x: 0, y: height * 0.45, z: 0, w: 0.25, h: height * 0.9, d: thick + 0.1 },
    ];
  }
  const B = HEART_SEAL_BARRIER;
  const parts: HeartGatePart[] = [
    { role: 'sill', x: 0, y: B.sillHeight / 2, z: 0, w: width, h: B.sillHeight, d: B.sillDepth },
    // The light in the channel down the threshold's top.
    {
      role: 'seam',
      x: 0,
      y: B.sillHeight - 0.05,
      z: 0,
      w: width - 0.7,
      h: 0.1,
      d: 0.26,
      light: true,
    },
    // The curtain of light rising out of the channel.
    {
      role: 'veil',
      x: 0,
      y: (B.sillHeight + B.veilTop) / 2,
      z: 0,
      w: width - 0.9,
      h: B.veilTop - B.sillHeight,
      d: 0.04,
      light: true,
    },
  ];
  const foot = B.sillHeight - 0.15;
  for (const share of B.crystalShares) {
    for (const s of [-1, 1]) {
      parts.push({
        role: 'crystal',
        x: s * share * half,
        y: (foot + B.crystalTop) / 2,
        z: 0,
        w: B.crystalWidth,
        h: B.crystalTop - foot,
        d: 0.36,
      });
    }
  }
  for (const s of [-1, 1]) {
    parts.push({
      role: 'post',
      side: s,
      x: s * (half + B.postWidth / 2),
      y: B.postHeight / 2,
      z: 0,
      w: B.postWidth,
      h: B.postHeight,
      d: B.postDepth,
    });
  }
  return parts;
}

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export interface HeartSlabPose {
  /** How far each half has moved out from the middle (yards). */
  part: number;
  /** How far the halves have sunk (yards). */
  sink: number;
  /** Still drawn (false once wholly under the floor). */
  shown: boolean;
}

/** The slab at openness `k` (0 shut, 1 open). */
export function heartSlabPose(k: number): HeartSlabPose {
  const part = smooth01(k / 0.3) * 1.4;
  const sink = smooth01((k - 0.2) / 0.8) * (HEART_SLAB.height + 0.6);
  return { part, sink, shown: k < 0.999 };
}

export interface HeartSealPose {
  /** How far the threshold and its crystal have sunk (yards). */
  sink: number;
  /** The light's strength (0 dark, 1 shut, up to 1.6 flaring while
   *  sealed). */
  film: number;
  /** The curtain's height share (1 standing to its top, 0 drained into its
   *  channel). */
  rise: number;
  shown: boolean;
}

/** The forge seal at openness `k`, sealed or not, at render time `t`. */
export function heartSealGatePose(k: number, sealed: boolean, t: number): HeartSealPose {
  const shut = 1 - smooth01(k / 0.35);
  const beat = sealed ? 1.3 + 0.3 * Math.sin(t * 5) : 1;
  return {
    sink: smooth01((k - 0.25) / 0.75) * (HEART_SEAL_BARRIER.crystalTop + 0.4),
    film: shut * beat,
    rise: 1 - smooth01(k / 0.3),
    shown: k < 0.999,
  };
}

/** A part posed at openness `k`: its centre and whether it draws. Slab
 *  halves part and sink, the crack sinks and closes; the seal's threshold,
 *  its crystal and its light sink (the light dies first), its standing
 *  stones stay. */
export function heartGatePartPose(
  part: HeartGatePart,
  rig: HeartGateRig,
  k: number,
): { x: number; y: number; z: number; shown: boolean } {
  if (rig === 'slab') {
    const pose = heartSlabPose(k);
    if (part.role === 'half') {
      const side = part.side ?? 1;
      return { x: part.x + side * pose.part, y: part.y - pose.sink, z: part.z, shown: pose.shown };
    }
    return { x: part.x, y: part.y - pose.sink, z: part.z, shown: pose.shown && pose.part < 0.6 };
  }
  if (part.role === 'post') return { x: part.x, y: part.y, z: part.z, shown: true };
  const pose = heartSealGatePose(k, false, 0);
  const lit = part.light ? pose.film > 0.01 : true;
  return { x: part.x, y: part.y - pose.sink, z: part.z, shown: pose.shown && lit };
}
