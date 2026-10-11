// Every clip name a visual binds an action for: the only place actions get built
// (visual.ts constructor), so a clip missing here never plays.
import type { ClipMap, VisualDef } from './manifest';
import { WOC_AUTO_ATTACK_NAMES } from './woc_autoattack_core';

export function clipNamesOf(def: VisualDef): string[] {
  // A stance's vocabulary (phaseClips) must be bound too, or its clips never
  // get an action and the swap plays nothing.
  const phases = Object.values(def.phaseClips ?? {}).flatMap((p) => [
    ...clipMapNames(p.clips),
    ...(p.enter ? [p.enter] : []),
  ]);
  return [
    ...clipMapNames(def.clips),
    ...phases,
    ...(def.wocCharacter ? WOC_AUTO_ATTACK_NAMES : []),
  ];
}

function clipMapNames(c: ClipMap): string[] {
  return [
    c.idle,
    c.combatIdle,
    c.stunned,
    ...Object.values(c.heldByAura ?? {}),
    c.turn,
    c.entrance,
    c.prowlIdle,
    c.prowlWalk,
    c.walk,
    c.run,
    c.rushArrival,
    c.death,
    ...(c.attack ?? []),
    ...(c.meleeAttack ?? []),
    c.wandAttack,
    ...Object.values(c.attackByAbility ?? {}),
    ...(c.abilityAttack ?? []),
    ...Object.values(c.castByAbility ?? {}),
    ...Object.values(c.attackByHand ?? {}),
    ...(c.dualWieldPair ?? []),
    ...(c.hit ?? []),
    c.cast,
    c.sitDown,
    c.sitIdle,
    c.swim,
    c.swimSurface,
    c.swimIdle,
    c.wade,
    c.jump,
    c.jumpMoving,
    c.fall,
    c.land,
    c.walkBack,
    c.strafeLeft,
    c.strafeRight,
    c.flourish,
    c.stow,
    c.climb,
    // The idle-breakers and the idle beat were MISSING here, which is the only
    // place actions get built (visual.ts constructor). A clip absent from this
    // list loads fine and passes the clipmap gate, that gate checks the GLB,
    // not the action map, but `this.action(name)` returns null forever, so
    // tickIdleVariant/tickIdleBeat bail on every fire and the rig simply never
    // fidgets. Silent: no throw, no warning, just a clip that is never seen.
    ...(c.idleVariants ?? []),
    ...Object.values(c.loadoutSwaps ?? {}).flatMap((m) => Object.values(m ?? {})),
    c.idleBeat?.clip,
    // The night pair (mob/slumber.ts): a slot named here is the ONLY way a clip becomes an
    // action, so a new ClipMap field joins this list or it never plays (pinned per rig by
    // tests/character_clipmaps.test.ts against the gate's own required-clip list).
    c.sleep,
    c.wake,
    // The aura-held idles (Balgath's Blinded loop): same rule, a loop never bound is a
    // pose never seen.
    ...Object.values(c.idleByAura ?? {}),
    ...Object.values(c.emote ?? {}).flatMap((spec) => spec.clips),
  ].filter((n): n is string => !!n);
}
