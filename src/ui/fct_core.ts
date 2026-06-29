// Pure spawn-descriptor model for floating combat text (FCT) -- the descriptor HALF
// of the FCT per-frame split. Host-agnostic and DETERMINISTIC: describeFct() is
// a pure function (NO Math.random, NO Date.now / performance.now, NO DOM), so the same
// event + the same injected jitter yields the same descriptor byte-for-byte. It is
// registered in UI_PURE_CORES (tests/architecture.test.ts) and the determinism guard
// enforces the no-randomness / no-clock / no-DOM rule.
//
// Jitter is INJECTED (a 0..1 draw the caller supplies) rather than drawn here, exactly
// so the core stays Math.random-free and passes the purity guard. The FCT PAINTER
// is the one allowed to draw the jitter with Math.random and to map the color
// CLASS TOKEN to a CSS class; the core only emits the token discriminator.
//
// The descriptor captures everything the live per-event fct() in hud.ts does -- the
// per-kind color as a CLASS TOKEN (not a hex), the crit flag, the head-offset world
// anchor, the horizontal jitter range, the author-space rise, and the ttl -- so the
// pooled-div painter is a faithful swap, not a behavior change. PROJECTION is the
// painter's job, not the core's: the painter projects anchor via renderer.worldToScreen
// and divides the screen position by getUiScale() into author space (the core stays
// world-space + screen-space-offset only, so it needs neither the renderer nor the DOM).

/**
 * The FCT spawn kinds, one per distinct live spawn site (the hud.ts SimEvent switch
 * plus showSelfNote). damage-done splits into -ability vs -auto because the live color
 * differs by whether an ability fired; miss/dodge share the same color logic but stay
 * distinct kinds because their text differs (and the self-vs-other color split rides
 * the separate isSelf flag, not the kind).
 */
export type FctKind =
  | 'miss'
  | 'dodge'
  | 'resist'
  | 'damage-done-ability'
  | 'damage-done-auto'
  | 'damage-taken'
  | 'heal'
  | 'xp'
  | 'rested-xp'
  | 'self-note';

/**
 * The combat-DAMAGE FCT kinds: the high-volume floaters (one per hit, the AoE / boss
 * burst spam) and the ONLY kinds that can crit. The low-tier drop-non-crit gate
 * applies ONLY to these, so a low-preset player still sees crit hits PLUS every low-volume
 * informational floater (xp, rested-xp, self-note) and avoidance word (miss, dodge); only
 * the non-crit damage-number spam (the actual cost driver) is shed.
 */
export const DAMAGE_FCT_KINDS: ReadonlySet<FctKind> = new Set<FctKind>([
  'damage-done-ability',
  'damage-done-auto',
  'damage-taken',
]);

/** Whether `kind` is a combat-damage floater (the low-tier drop-non-crit target). */
export function isDamageFctKind(kind: FctKind): boolean {
  return DAMAGE_FCT_KINDS.has(kind);
}

/**
 * Color CLASS TOKEN discriminator, keyed by kind (plus the isSelf flag for miss/dodge).
 * The painter owns the token -> CSS color class table (the hex->token migration); the
 * core never emits a hex. Crit does NOT change the token: the live fct() keys color by
 * its call-site argument and expresses crit only through the separate 'crit' class, so a
 * crit and a non-crit of the same kind+isSelf share one color token.
 */
export type FctColorToken =
  | 'miss-self'
  | 'miss-other'
  | 'dodge-self'
  | 'dodge-other'
  | 'damage-done-ability'
  | 'damage-done-auto'
  | 'damage-taken'
  | 'heal'
  | 'xp'
  | 'rested-xp'
  | 'self-note';

/**
 * The minimal entity shape the anchor is read from. Structural on purpose so the core
 * reads identically off an offline Sim entity and an online ClientWorld-mirror entity
 * (parity): both expose pos.{x,y,z} and a numeric scale, and nothing else
 * about the entity matters to the descriptor.
 */
export interface FctAnchorSource {
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: number;
}

/** Input event: a resolved text string, the anchor entity, and the color-shaping flags. */
export interface FctEvent {
  readonly kind: FctKind;
  /**
   * The already-resolved, t()-localized text. The i18n-free core never calls t(); it
   * forwards the caller's string verbatim, mirroring the cast_bar core rule (the spawn
   * sites in hud.ts already t()-resolve before calling fct()).
   */
  readonly text: string;
  /** The entity the text floats over; its pos + scale drive the head-offset anchor. */
  readonly target: FctAnchorSource;
  /** Crit -> the painter adds the 'crit' class (bigger font + the crit rise animation). */
  readonly crit: boolean;
  /**
   * Whether the local player is the FCT target. Only the miss/dodge color depends on it
   * (the live fct() uses #bbb when the player is the target, #fff otherwise); every other
   * kind ignores it.
   */
  readonly isSelf: boolean;
}

/** Output: the resolved, world-space-plus-screen-offset spawn descriptor the painter draws. */
export interface FctDescriptor {
  readonly text: string;
  readonly colorToken: FctColorToken;
  readonly crit: boolean;
  /**
   * The world anchor the painter projects via worldToScreen. y carries the head offset
   * (FCT_ANCHOR_HEAD_OFFSET * scale), matching the live fct() that projects
   * pos.y + 2.2 * scale.
   */
  readonly anchor: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * Horizontal screen-space offset (px) the painter adds to the projected x BEFORE it
   * divides by getUiScale() into author space, exactly as the live fct() adds its jitter
   * before the /z divide. Range: -FCT_JITTER_RANGE / 2 .. +FCT_JITTER_RANGE / 2.
   */
  readonly jitterOffset: number;
  /** Lifetime in ms before the painter evicts the entry (the live setTimeout removal). */
  readonly ttlMs: number;
}

// --- Named constants (no magic values in the descriptor math). Each
// mirrors a live fct() / fct CSS value so the painter reproduces it exactly. ---

/** Total horizontal jitter spread, in screen px. Live fct(): Math.random() * 30 - 15. */
export const FCT_JITTER_RANGE = 30;
/** Entry lifetime in ms. Live fct(): setTimeout(() => el.remove(), 1250). */
export const FCT_TTL_MS = 1250;
/** Head offset above the entity origin, scaled by entity scale. Live fct(): pos.y + 2.2 * scale. */
export const FCT_ANCHOR_HEAD_OFFSET = 2.2;
/**
 * Base author-space rise over the entry's life. No production code reads this (the painter rises
 * off the .fct / .fct.crit CSS class, never a descriptor field, so a crit never under-rises); it
 * is the documentary constant that tests/fct_core.test.ts pins against the live @keyframes fct-rise
 * distance in hud.css (calc(-50% - 76px)), so a CSS rise edit fails the test instead of silently
 * drifting. The rise was moved off the old margin-top onto `translate` so it stays on the
 * compositor; the crit variant rises further (@keyframes fct-crit -> -86px) and that larger rise
 * rides the .fct.crit class.
 */
export const FCT_RISE_PX = 76;

function colorToken(kind: FctKind, isSelf: boolean): FctColorToken {
  switch (kind) {
    case 'miss':
      return isSelf ? 'miss-self' : 'miss-other';
    case 'dodge':
      return isSelf ? 'dodge-self' : 'dodge-other';
    case 'resist':
      // A resisted spell is an avoidance word like a miss; it reuses the miss colour token
      // (self grey / other white) so it needs no new CSS class.
      return isSelf ? 'miss-self' : 'miss-other';
    default:
      // The seven non-avoidance kinds are their own color token 1:1; isSelf never
      // changes their color in the live fct(), so it is ignored here.
      return kind;
  }
}

/**
 * Build the pure FCT spawn descriptor. `jitter01` is the injected horizontal-jitter draw
 * in [0, 1] (the painter passes Math.random()): jitter01 = 0 maps to the minimum
 * offset (-FCT_JITTER_RANGE / 2), 1 to the maximum (+FCT_JITTER_RANGE / 2), and 0.5 to 0.
 * No Math.random / Date.now / performance.now / DOM here, so the same event + the same
 * jitter01 always produce an identical descriptor. The descriptor is clock-free on
 * purpose: time-relative animation and ttl eviction are the driver's per-frame concern
 * (it stamps the spawn clock), which keeps this core deterministic with nothing to inject.
 */
export function describeFct(event: FctEvent, jitter01: number): FctDescriptor {
  const { pos, scale } = event.target;
  return {
    text: event.text,
    colorToken: colorToken(event.kind, event.isSelf),
    crit: event.crit,
    anchor: { x: pos.x, y: pos.y + FCT_ANCHOR_HEAD_OFFSET * scale, z: pos.z },
    jitterOffset: jitter01 * FCT_JITTER_RANGE - FCT_JITTER_RANGE / 2,
    ttlMs: FCT_TTL_MS,
  };
}
