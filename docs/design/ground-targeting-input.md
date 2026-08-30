# Ground targeting across the three input schemes

How a `targetMode: 'position'` ability (Heroic Leap, Meteor, Blizzard, Flamestrike,
Ring of Frost, and the rest) is aimed and committed on mouse and keyboard, on a
controller, and on touch. The FFXIV placement model was the reference for the
controller scheme; the touch scheme composes with the flick radial instead of
competing with it.

## The shared core

One aim seam serves every input: the pure state machine and range clamp in
`src/ui/hud/action_bar/ground_aim.ts`, orchestrated by `GroundAimController`
(`src/ui/hud/action_bar/ground_aim_controller.ts`) behind thin `Hud` delegates.
The rules that hold regardless of device:

- **Smart seed.** Entering aim seeds the reticle at the current target's position
  (only when `isAttackableEntity` accepts it, so duels, arena, and battleground
  enemies count and a selected friendly does not), else at half the ability's
  range straight ahead. Never at the caster's feet, so confirming immediately is
  a usable quick cast on every input.
- **Raw point, live clamp.** The aim state stores the raw desired point; the
  reticle derives its clamped position from the live caster position every frame,
  and the commit clamps the same raw point, so a moving caster never sees a
  reticle that lies about the landing.
- **Entry precheck.** Aim mode refuses to open while dead or on cooldown and
  falls through to the instant-cast path instead, so the sim's own refusal toast
  fires. Resources and the GCD never gate entry; they legitimately change while
  aiming.
- **Lifecycle.** Death, teleport-scale displacement, reconnect, and pad
  disconnect cancel an armed aim. An open HUD window suspends aim input without
  cancelling. A cast rejection at commit closes the aim (the reticle is not
  re-armed).
- **Placement preview.** `IWorld.groundAimPlacementPreview` returns the point the
  cast will truly land at; today only Heroic Leap adjusts (its flight sweep
  diverts at walls, steep rises, and deep water), and the reticle paints that
  projected landing dimmed when it diverges from the aim. The commit always
  submits the clamped aim; the server derives its own landing.
- **Authority.** The client only ever proposes a point. The sim clamps it to max
  range and refuses inside `minRange` (the entity path's rule, now mirrored for
  position casts), and a no-aim cast of a `minRange` ability lands at the minimum
  along facing rather than refusing forever at the feet.

## Mouse and keyboard (unchanged flow, shared upgrades)

Press the slot to arm, the cursor drives the reticle, left click or a same-slot
re-press commits, right click or Escape cancels. The `groundReticle` option still
disables the reticle for instant target-or-feet casting.

## Controller: the placement mode

While an aim is armed and no HUD window owns the pad, `GamepadManager.poll` runs
a placement branch (ahead of the mouse-mode and arrange chords, which cannot fire
mid-aim):

- **Left stick** steers the reticle camera-relative; character movement is frozen
  and autorun stops on entry. **Right stick** keeps normal camera look, so the
  view rotates while placing (the reason the FFXIV-style freeze was chosen).
- **Bare d-pad left/right** snaps the reticle between attackable targets in range
  without changing the selected target. Up/down are inert during aim.
- **Confirm (A)** or a same-cell cross-hotbar re-press commits; **cancel (B)**
  backs out; any other action cancels first, matching the keyboard rule.
  Trigger-held presses stay ordinary cross-hotbar casts throughout.
- Reticle speed scales with ability range times the Controller panel's Reticle
  Speed slider (`gamepadReticleSpeed`).
- An ability arranged only on the cross hotbar aims under an ability-id identity
  (`XHB_ONLY_AIM_SLOT`), so re-press commit works without a keyboard bar slot.

The reticle point source arbitrates by last active input (`input_hint_mode`): pad
stick steering owns the point until a real mouse move takes it back.

## Touch: radial-select, then aim on the world

The flick radial keeps sole ownership of on-button gestures. Selecting a position
ability (centre tap or petal flick, drag or tap-menu mode alike) arms the aim
instead of casting; dragging on the world steers under the `groundAim` pointer
owner; releasing the drag or tapping the world commits.

- **Re-pressing the owning physical ring button cancels** (any direction the
  press would resolve to). This is the dedicated touch cancel, and it exists
  because a petal-armed aim's re-press resolves the centre slot, which must never
  fire a different spell over an armed aim. A page flip cancels for the same
  slot-identity reason.
- **Precise vs Quick.** The `touchPreciseGroundAim` toggle (default on) governs
  all position abilities; Quick instant-casts at the smart seed. The old
  meteor-only special case is gone (the seed keeps a quick Meteor off the
  caster's feet).
- Movement stays live during touch aim (the joystick is a separate surface); the
  camera cannot swipe while aiming because the canvas belongs to the aim, but
  pinch zoom still works and deliberately never commits.
- The owning slot shows an `aiming` accent on both the desktop bar and the ring,
  and carries `aria-pressed` only while armed (the Attack toggle is the only
  slot that always carries it).

## Known limits, on purpose

- No line-of-sight preview; the Heroic Leap projection is the only
  terrain-truth adjustment, scoped to seed-derived arms (delve modules and rift
  walls are live per-Sim state the preview cannot see; the authoritative sweep
  remains the arbiter).
- Hold-through steering on touch (keep the selecting finger down and steer
  directly) was considered and deferred; the two-step flow composes with the
  radial without new gesture risk.
- The pad snap order sorts by angle around the caster and wraps at the angular
  seam; per press, not per frame.
