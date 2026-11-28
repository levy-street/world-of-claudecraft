// The party pings in the world, the pure half (the Three half is
// party_pings.ts): the ping palette, the pooled slots the live pings fold
// into, where each icon stands (over its unit, or over its ground point),
// how big it draws so it reads at any distance, and the appear, ripple and
// fade curves. Three/DOM/i18n-free and deterministic: the clock is the
// renderer's, passed in.
//
// The pings themselves come from IWorld.partyPings (the sim owns them:
// src/sim/social/party_pings.ts). A slot remembers when THIS client first saw
// its ping, so the appear animation and the fade are local; the server drops
// the ping at its lifetime and the slot goes with it.

import {
  PARTY_PING_GROUP_MAX,
  PARTY_PING_LIFETIME_S,
  PING_ASSIST,
  PING_ATTACK,
  PING_KIND_COUNT,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../sim/social/party_pings';

/** One colour per ping kind (0xRRGGBB), by wire index: Look Here yellow,
 *  Attack red, Warning orange, On My Way blue, Assist green, saturated and
 *  slightly neon, sampled from the painted icons (public/ui/pings/). Every ping
 *  surface (the world icon's glow, its ring, the wheel and the chat callout)
 *  reads these. */
export const PARTY_PING_COLORS: readonly number[] = (() => {
  const c: number[] = [];
  c[PING_LOOK] = 0xffe81a;
  c[PING_ATTACK] = 0xff2d1e;
  c[PING_WARNING] = 0xff8c00;
  c[PING_ON_MY_WAY] = 0x1a8cff;
  c[PING_ASSIST] = 0x1ff53c;
  return Object.freeze(c);
})();

/** A ping kind's colour as a CSS hex string (canvas art). */
export function partyPingColorCss(kind: number): string {
  const c = PARTY_PING_COLORS[kind] ?? PARTY_PING_COLORS[PING_LOOK];
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** The pooled slots: a group shows at most this many pings at once. */
export const PARTY_PING_SLOTS = PARTY_PING_GROUP_MAX;
/** The icon's pop in (seconds) and its fade out at the end of its life. */
export const PARTY_PING_POP_S = 0.34;
export const PARTY_PING_FADE_S = 0.5;
/** The ground ring: ONE short ripple (seconds) that fades out, and its radius
 *  (yards). Only a ground ping draws it; a unit ping is its icon alone. */
export const PARTY_PING_RING_S = 1;
export const PARTY_PING_RING_RADIUS = 1.1;
/** How high a ground ping's icon floats over its point, and how far over a
 *  unit's head a unit ping's icon floats (yards). */
export const PARTY_PING_GROUND_LIFT = 2.4;
export const PARTY_PING_HEAD_LIFT = 0.7;
/** A unit ping's icon also rises by this share of its own drawn size, so its
 *  lower edge clears the unit's nameplate at any distance (the plate is a fixed
 *  screen height, and the icon holds a fixed screen share). */
export const PARTY_PING_PLATE_CLEAR = 1.05;
/** The icon's screen share (of the view height) and its world-size clamp. */
export const PARTY_PING_SCREEN_SHARE = 0.05;
export const PARTY_PING_MIN_SIZE = 0.9;
export const PARTY_PING_MAX_SIZE = 14;
/** The fallback field of view (degrees) for a non-perspective camera. */
export const PARTY_PING_CAMERA_FOV = 60;

/** One pooled slot: the ping it shows (id 0 = free) and when it appeared. */
export interface PartyPingSlot {
  id: number;
  kind: number;
  target: number | null;
  x: number;
  y: number;
  z: number;
  /** The renderer time this client first drew it. */
  born: number;
  /** The slot changed this sync (a new ping, or freed): its look is rewritten. */
  dirty: boolean;
}

/** The slice of a ping the world draws (IWorld.partyPings rows). */
export interface PartyPingMark {
  id: number;
  kind: number;
  target: number | null;
  x: number;
  y: number;
  z: number;
}

export function createPartyPingSlots(): PartyPingSlot[] {
  return Array.from({ length: PARTY_PING_SLOTS }, () => ({
    id: 0,
    kind: PING_LOOK,
    target: null,
    x: 0,
    y: 0,
    z: 0,
    born: 0,
    dirty: false,
  }));
}

/**
 * Fold the live pings into the slots: a slot whose ping is gone frees, a new
 * ping takes a free slot (born now), a kept one is left alone. Allocation
 * free; a frame with no pings and no slots in use returns after one pass.
 * Returns whether any slot changed.
 */
export function syncPartyPingSlots(
  slots: PartyPingSlot[],
  pings: readonly PartyPingMark[],
  now: number,
): boolean {
  let changed = false;
  for (const slot of slots) {
    slot.dirty = false;
    if (slot.id === 0) continue;
    let live = false;
    for (const p of pings) {
      if (p.id === slot.id) {
        live = true;
        break;
      }
    }
    if (!live) {
      slot.id = 0;
      slot.dirty = true;
      changed = true;
    }
  }
  for (const p of pings) {
    if (!(p.kind >= 0 && p.kind < PING_KIND_COUNT)) continue;
    let held = false;
    for (const slot of slots) {
      if (slot.id === p.id) {
        held = true;
        break;
      }
    }
    if (held) continue;
    const free = slots.find((s) => s.id === 0);
    if (!free) break;
    free.id = p.id;
    free.kind = p.kind;
    free.target = p.target;
    free.x = p.x;
    free.y = p.y;
    free.z = p.z;
    free.born = now;
    free.dirty = true;
    changed = true;
  }
  return changed;
}

/** The appear curve over a ping's first PARTY_PING_POP_S: 0 to an overshoot
 *  and back to 1 (an ease-out-back), then 1. Reduced motion skips it. */
export function partyPingPop(age: number, reducedMotion: boolean): number {
  if (reducedMotion || age >= PARTY_PING_POP_S) return 1;
  if (age <= 0) return 0;
  const t = age / PARTY_PING_POP_S - 1;
  const s = 2.2;
  return 1 + (s + 1) * t * t * t + s * t * t;
}

/** The fade: full until the last PARTY_PING_FADE_S of the ping's life, then
 *  down to 0; a fast fade in over the first tenth of a second. */
export function partyPingAlpha(age: number): number {
  if (age < 0) return 0;
  const fadeIn = Math.min(1, age / 0.1);
  const left = PARTY_PING_LIFETIME_S - age;
  const fadeOut = Math.max(0, Math.min(1, left / PARTY_PING_FADE_S));
  return fadeIn * fadeOut;
}

/** Whether a slot draws the ground ring: a ground ping does, a unit ping
 *  (whose icon follows the unit) never does. */
export function partyPingShowsRing(slot: Pick<PartyPingSlot, 'target'>): boolean {
  return slot.target === null;
}

/** The ground ring's ripple phase over its one ripple: 0 (a fresh ripple at
 *  the centre) to 1 at PARTY_PING_RING_S, held there after. Reduced motion
 *  holds it still. */
export function partyPingRipple(age: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.55;
  return Math.min(1, Math.max(0, age) / PARTY_PING_RING_S);
}

/** The ground ring's opacity: a fast fade in, then down to 0 at
 *  PARTY_PING_RING_S (0 from then on: the ring is gone, the icon stays). */
export function partyPingRingAlpha(age: number): number {
  if (age < 0 || age >= PARTY_PING_RING_S) return 0;
  const fadeIn = Math.min(1, age / 0.08);
  const left = 1 - age / PARTY_PING_RING_S;
  return fadeIn * left * (2 - left);
}

/** The icon's world size so it holds PARTY_PING_SCREEN_SHARE of the view at
 *  `dist` yards, clamped so it neither vanishes far off nor balloons up close. */
export function partyPingIconSize(dist: number, fovDeg: number): number {
  const fov =
    (Number.isFinite(fovDeg) && fovDeg > 1 ? fovDeg : PARTY_PING_CAMERA_FOV) * (Math.PI / 180);
  const view = 2 * Math.max(0, dist) * Math.tan(fov / 2);
  const size = view * PARTY_PING_SCREEN_SHARE;
  return Math.min(PARTY_PING_MAX_SIZE, Math.max(PARTY_PING_MIN_SIZE, size));
}

/** Where a slot stands this frame: its foot point (the ring) and its icon's
 *  height. A unit ping follows its unit (`unit` its live feet and head
 *  height, when this client draws it); otherwise the pinged point. */
export interface PartyPingAnchor {
  x: number;
  y: number;
  z: number;
  iconY: number;
}

export function createPartyPingAnchor(): PartyPingAnchor {
  return { x: 0, y: 0, z: 0, iconY: 0 };
}

export function partyPingAnchorInto(
  out: PartyPingAnchor,
  slot: PartyPingSlot,
  unit: { x: number; y: number; z: number; top: number } | null,
  bob: number,
): PartyPingAnchor {
  if (slot.target !== null && unit) {
    out.x = unit.x;
    out.y = unit.y;
    out.z = unit.z;
    out.iconY = unit.top + PARTY_PING_HEAD_LIFT + bob;
  } else {
    out.x = slot.x;
    out.y = slot.y;
    out.z = slot.z;
    out.iconY = slot.y + PARTY_PING_GROUND_LIFT + bob;
  }
  return out;
}

/** The icon's height this frame: the anchor's, plus (for a unit ping, whose
 *  unit wears a nameplate) a lift by its drawn `size` that clears the plate. */
export function partyPingIconY(anchor: PartyPingAnchor, slot: PartyPingSlot, size: number): number {
  return slot.target === null ? anchor.iconY : anchor.iconY + size * PARTY_PING_PLATE_CLEAR;
}

/** The icon's gentle float (yards), off on reduced motion. */
export function partyPingBob(age: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.sin(age * 3.1) * 0.12;
}
