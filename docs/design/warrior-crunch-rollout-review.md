# Warrior contact and voice rollout checkpoint

Active work following the approved Red Harvest impact pass. This is a saved
implementation checkpoint, not acceptance of every Warrior ability or a claim
that the whole game gate passes. Other classes are outside this rollout.

## Art direction and implementation

- Battlecraft uses a cool steel catch, an enemy-bound incision, directional
  metal spray and a transparent cutting wake. Brute Swing is a concise chop,
  Redhand a reversal, Maiming Strike a diagonal wound, Early Grave the largest
  execution, and Breachmaker a driven thrust. Reaping Arc retains its broad
  reach and rear gap while the leading edge travels through the sweep.
- `warrior_shear.webp` is an original Blender-rendered sprite. The reproducible
  `bake_warrior_shear.py` and `package_warrior_shear.mjs` author unequal jets,
  tumbling chips and a sharp receiving split. The package checks frame edges,
  transparent endpoints and nonempty interior frames. The old untracked
  `warrior_steel.webp` draft is preserved and is not a dependency of this work.
- `warrior_steel_material.ts` gives the blade path a moving bright edge and
  transparent striations. Physical leading and trailing edges have distinct UV
  coordinates on both faces; the tail no longer receives a second bright bevel.
- Each shout has its own spacing and decay. Thin, broken compression fronts
  travel outward; secondary accents run across propagation rather than curling
  along it. Foot grit stays close to the ground. Real recipient state still owns
  the buff, fear, slow or challenge. The effects invent no damage or recoil.
- Twinstrike and Bloodletting retain their existing hit counts and scale.
  Their narrow wounds follow the original receiving body, even after another
  target reuses a sequencer slot. Restrained directional crunch and slightly
  delayed loose blood separate the bite from extraction. Red Harvest retains
  the strongest finisher response.

## Preparation and timing

`BakedPoolPrewarm` prepares the actual existing sprite buffers through the
preparation scheduler. Texture uploads precede the bounded preparation draws;
the active Warrior kit awaits all slots. Other classes do not gain a Warrior
texture dependency. This closes a known preparation gap; it does not by itself
prove the cause of the previously measured cold-cast frame spikes.

`DeferredContactBursts` deducts delivery overshoot from the remaining particle
life. Its bounded reservations do not retain live sequencer slots. Explicit
effects that no longer fit their contact window are discarded, and clear and
disposal cancel outstanding reservations.

## Evidence and open review

Relevant regression suites are `warrior_steel_contact`, `warrior_steel_material`,
`warrior_blood_contact_follow`, `warrior_shouts`, `baked_pool_prewarm`,
`warrior_baked_prewarm_integration`, `vfx_production_layers`,
`deferred_contact_bursts`, and the existing active-kit, frame-cost and native
choreography tests.

Matching local captures are retained outside the checkout under
`studio-contact-pass/warrior-final-warrior-steel-before-crunch`,
`warrior-final-warrior-steel-after-crunch`, and
`warrior-final-warrior-steel-voice-second`. The first after-pass revealed a solid
metal-panel appearance and prompted the transparent material revision. The
second pass revealed faint voice fronts and residual curling accents, prompting
another voice revision. These records are iteration evidence, not final visual
acceptance. Continue with full Warrior review after the remaining families.

The subsequent `warrior-final-warrior-voices-crunch-final` pass covers every
shout at contact and recovery on Ultra. It has no runtime errors, missing
assets or source drift. The natural `warrior-crunch-prepared` Bloodrush run
completed nineteen legal casts and twenty auto-attacks against five recipients
over thirty simulation seconds. Median frame time was 7ms, the 95th percentile
14ms, and the maximum 62.4ms. The prior multi-second stall was not observed in
this take. This is an environment-specific observation, not a controlled causal
comparison or proof of every cold-start condition. Audio was disabled.

The local preview is `http://localhost:5173/vfx-studio.html`. The published Site
still contains its previous release until a separate publication is verified.
Existing unrelated drafts and tracked work are preserved. The canonical gate's
untracked-media freshness issue remains documented in the Red Harvest review.
