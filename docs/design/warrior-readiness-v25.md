# Warrior preparation and readiness, v25

## Art direction

Held states communicate preparation through actual equipment. They stay quieter
than Warrior's attacks and finishers while keeping separate silhouettes. Armor,
skin and cloth retain their colors. Default stances appearing on spawn do not
invent a cast ceremony.

- Sanguine Aura gathers fine sprite filaments at the hilt, then leaves a faceted
  blood coating on the real mainhand. Dark crimson material, warm cut edges and
  lighting highlights replace the flat red wash. The actual 20-second party
  aura controls each eligible recipient; this ability does not inflict injury
  or grant lifesteal. Another winning weapon imbue retains its own appearance.
- Widening Arc opens two separated blade edges for its actual 12-second window.
  A short preparation sweep establishes its wider cut. It has no charges; only
  actual secondary damage supplies an extra victim's contact.
- Battle Stance carries one disciplined pale-steel edge. Berserker Stance puts
  restrained scarlet notches on both held weapons. Guarded Stance uses a blue
  angular accent on the real guard or offhand, without inventing a shield.
- Sudden Death adds a crimson execution notch with a hot tip. Battle Trance
  splits a calm amber glint near the hilt. Revenge readiness adds two blue
  counter chevrons. All disappear on actual consumption or expiry.
- Pursuit adds two short ground-following wakes and grit during actual movement.
  Standing still or teleporting produces no dust treadmill. The existing queued
  Reaver Strike glint remains under its original owner.

## Construction

Five native clips use the existing pose donor and offline foot-solving pipeline.
They hold their decisive pose near 0.15 seconds and recover within 0.68 seconds.
All 27 previous clips are preserved at the track-value level.

Readiness combines actual aura flags in a bounded 64-wearer owner and uses the
existing ribbon and overlay buffers after attack geometry. Local readiness gets
first access to the remaining decoration budget. Equipment samplers follow real
movement, reject hidden or detached weapons and retry replacements. No additional
GPU producer is created for these held lines.

Sanguine detail stays with the existing weapon overlay owner. The production RGB
blood texture is projected along the actual geometry; coverage preserves the
weapon through the texture's gaps. A hidden copy prepares the exact material
before mounting it. Preparation requires successful gate work, known-ready face
programs and an uploaded texture in this renderer's context. Unsupported or failed
preparation keeps the existing overlay. Stale completion cannot attach to a
replaced weapon. Shared geometry and textures are never disposed by the upgrade.

## Evidence and remaining review

The matching sandbox captures cover seven legal activation cases: Sanguine Aura
in all three specs, Widening Arc in Battlecraft and each spec's legal default
stance refresh. All 74 frames completed with unchanged source and no recorded
gameplay or console errors. Finite auras are captured through actual expiry.
The visual review changed Sanguine from a pale additive coating to a red material
that responds to light. Matching examples and provenance live in
`docs/screenshots/warrior-readiness-v25`.

Focused verification covers aura identity, overlapping imbues, state merging,
consumption, equipment replacement, admission priority, movement, cleanup, shader
readiness and native clip preservation. This is a production checkpoint, not
full-kit acceptance. Actual proc acquisition, secondary Widening hits, all allied
recipients, alternate stance transitions, all quality settings, world backgrounds,
crowded casting and both full Warrior visual review cycles remain to be completed.
