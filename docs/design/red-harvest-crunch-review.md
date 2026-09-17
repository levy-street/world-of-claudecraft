# Red Harvest: contact resistance and release

17 September 2026. This implements the approved impact-feedback revision on top
of the Rivers of Blood-inspired blade membrane. It is an implementation checkpoint,
not a claim of final AAA acceptance or completion of the wider Warrior rollout.

## What changed

- Native blade contacts remain at 0.15, 0.32 and 0.49 seconds. The first two catch
  for 20 milliseconds; the finale catches for 48 milliseconds. Small authored
  hand shudders occupy those windows. The clip still returns to neutral at 0.72
  seconds, with planted feet. No attacker animation clock is slowed at runtime.
- The receiving body compresses immediately, holds briefly and releases into a
  damped recoil. It follows the incoming direction, scales down for large creatures
  and leaves the actual world position unchanged. Death and reduced motion cancel it.
- Only a successful primary final hit requests the new camera profile: one
  directional shove and two diminishing returns, finished within 180 milliseconds.
  Ordinary impacts cannot redirect it. Existing distance and crowd budgets apply.
- The wound bite remains immediate. Sprite and loose blood extraction follow the
  hold. A bounded queue copies contact coordinates instead of retaining a reusable
  sequencer slot. Sprite timing accounts for its update during the spawning frame.
  Both extraction layers finish inside the original contact window.
- Six original ElevenLabs recordings are remixed into a low body layer, a short
  midrange crack and a delayed tear. Each remains one spatial audio voice at its
  original contact cue. Reproducible source masters and the authoring script are
  included; no new paid generation was used. The existing 0.14-second preparation
  ends before the first contact, so there is no global audio ducking.

## Evidence

103 focused tests across 11 files pass, including fixed native contact timing,
30/60/120 Hz extraction ordering, bounded camera overlap, restoration, reduced
motion, victim scaling, actual component outcomes, audio ownership and pooled
renderer lifecycle. Native foot drift is 0.000677 units, below the existing 0.012
limit; neutral recovery and the planted loading depth pass unchanged assertions.
All six rebuilt sounds pass the existing conformance inspection.

Initial Ultra studio review: `warrior-final-rh-crunch-review`, 14 samples, no
runtime or missing-asset errors. After the independent review's timing corrections,
`warrior-final-rh-crunch-final-world` records 14 outdoor Low samples with no errors
and identical source hashes throughout. The reduced-motion companion is
`warrior-final-rh-crunch-final-reduced`. These are real previewer casts, not another
rendering implementation. Previous six-profile blade-material evidence remains
in `red-harvest-blade-blood-review.md`.

The earlier cold-cast delay remains an open performance investigation. These
captures and unit tests do not establish its cause or prove cold-cast acceptance.

## Review and continuing scope

Use `http://localhost:5173/vfx-studio.html`, Warrior, Bloodrush, Red Harvest.
Refresh the page and enable Combat and world audio. Normal playback is the useful
way to judge contact resistance; paused pictures cannot demonstrate its timing.
The public Site has not been updated by this checkpoint.

Tony has now approved applying this process across all 45 Warrior actives and
their relevant states. Distinct purpose, power, frequency and receiving outcome
guide each treatment. The blood material and final-hit intensity are not defaults
for utility, shields, ordinary steel cuts or shouts. Astra owns the remaining work;
Claude helpers were stopped at the user's request.
