# Warrior Reaver Strike (heroic_strike), v25 production checkpoint

## Art direction

Reaver Strike is a legal, unspecialized queued next-auto attack. It commits to
contact only when the real auto-swing resolves; the queue itself does not swing
early. Armor, skin and cloth retain their normal body colors. Nothing in the
visual read signals a spec gate or a charged wind-up.

- The blade contact draws a broad, descending steel crest. The roll value
  is -0.95, tipping the arc forward and downward across the recipient's torso.
  No blood palette, no rising fans, no ground-chop dust: the visual belongs
  to the plain Warrior steel family (0xf1f6ff lead strand, 0xbc8666 secondary,
  steel_cut crest type).
- The recipient side receives the standard sparks burst and metal-splinter
  fragments at the hit point. Tier-0 contact plays the full composition; tier-1
  sheds secondary strands as normal for the contact family.
- The offhand is held in its native guard throughout. The load, cut, and follow
  poses all apply the guard pose to the left arm and hand bones before the
  mainhand diagonal is resolved, so the silhouette stays controlled.
- No secondary damage, no aura, no proc indicator is authored here. Sudden Death
  and similar proc glints live on the readiness layer and are not part of this
  contact pass.

## Construction

One native animation clip, `Warrior_Reaver_Strike`, is authored over a .62-second
timeline: idle at 0, load at 0.07, cut at 0.15, contact hold at 0.185, follow at
0.32, return to idle at 0.62. The cut pose samples the diagonal donor at its .39
extension with zero lean; the offhand guard is applied to the left arm bones before
the mainhand pose is merged. All 32 previous animation clips are preserved
track-for-track.

The contact hold runs from .15 to .185. Actual gameplay contact owns both the
animation and the audio cue: the release sound (`melee_warrior_reaver_release`)
fires when the real queued swing resolves, and the impact (`impact_warrior_reaver`)
follows at the authored .15-second contact pose. Two
recorded release takes and two recorded impact takes were authored; the runtime
selects among them.

Positive blade and shield contacts claim the renderer generic contact path only
if sequence admission succeeds. Local critical feedback (target hold, flash and shake) is
deferred to the admitted physical contact, and cleared on cancel, reuse, or
explicit clear. If admission fails, immediate fallback applies so the outcome is
never silently dropped. Floating combat text remains on the real damage event.

The blade VFX style for `heroic_strike` is `{ span: 4.2, height: 0.95, roll: -0.95 }`.
No heavy, blood, groundChop, or rising flags are set. The physical contact force
call passes the base profile force without a heavy multiplier. Three ribbon strands
run at tier 0; one strand at tier 1.

## Evidence and remaining review

The before-1 capture covers one cast and ten stills at the pre-pass baseline.
The final after-3 capture covers one cast and ten stills with the contact pass
and critical-feedback routing applied; its source is frozen and both error logs
are empty. After-2 remains the earlier noncritical contact checkpoint.

The delayed-queue capture first starts a real ordinary swing and queues Reaver
during its natural recovery. Reaver waits 1.20 seconds, retains its queue in six
pre-hit frames, then deals its real damage and consumes the queue. The take uses
the normal worn_sword and eastbrook_buckler loadout, with no mid-take reset.

All three complete reports and their 30 stills are in
`docs/screenshots/warrior-reaver-v25`. The evidence manifest hashes every image.
Native preservation checks retain all 32 previous clips. The focused integrated
checks pass 281 tests across nine suites; the expanded contact ownership suite
passes 15 tests, including critical timing and cancelled-beat cleanup (overlap).
Canonical TypeScript and the production bundle also pass.

Sound listening acceptance has not been completed. All-quality verification, varied
world backgrounds, spam-cast behavior, and both full integrated Warrior visual
review cycles remain open. This is a production checkpoint, not full-kit acceptance.
