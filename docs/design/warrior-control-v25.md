# Warrior control VFX, v25

## Art direction

These four actions are compact physical tools, with deliberate body mechanics and a visible recipient. Their power sits below Warrior's heavy spenders. Preserve the red cloth, pale armor and equipment colors: material changes belong to short contact accents and local status marks. They must remain satisfying inside the GCD, without copying the finisher's scale or claiming extra damage.

- **Hobbling Cut:** a planted low cut through the opponent's ankle line. The blade ribbon and brief red material exit follow that low plane. A narrow ankle scar follows the actual 15-second slow; it disappears when the aura ends.
- **Jawcrack:** a direct free-hand punch with a fast contact hold and planted feet. Compressed air describes the attempted motion. A confirmed school lockout splits a cold spell filament at the recipient. An unsuccessful attempt does not emit injury, a fake stagger, or a successful-interrupt sound.
- **Armor Shear:** bite the blade into the armor and pry away, with two opposing metal peel fans on confirmed application or refresh. This ability deals no direct damage. One to five accumulating plate cracks describe the real armor reduction, including a Warrior refresh of the shared armor status. The marks last for the actual aura, not a guessed timer.
- **Storm Bolt:** a full steel hammer silhouette, with bevels, brass bands, a wrapped grip and angular thunder engraving. Eight sprite cels supply the tumble. The empty-hand overhead throw recovers across the body. Flight follows the actual 26-yard-per-second speed; only the authoritative damage event supplies the blunt contact, dust, steel chips and hit response. Existing stun presentation follows the real stun duration.

## Construction and timing

Four native animation clips live in the existing Warrior donor GLB. The previous 23 tracks are preserved byte-for-value at the animation level. Native aliases prevent generic clip resampling, and named-action fallbacks remain available when those assets are absent. Offline hand/foot solving uses the existing authoring pipeline.

The three melee clips hold contact around 0.15 seconds and recover within 0.64 seconds. Storm Bolt uses a rapid overhead release consistent with its instant projectile launch. A late success event produces recipient feedback without replaying the caster's action.

The existing overlay atlas grows from 3x3 to 5x5 64-pixel cells. Its old nine cells keep their identities and additive appearance. Hammer cels and receiver marks use solid coverage in the same warmed point cloud. Bounded depth ordering keeps physical sprites in front of the appropriate backdrop while hard-control tells retain explicit priority. Pool capacities remain unchanged; decorative orbit bands can yield to real armor/slow marks. A pool containing only protected statuses can still decline an extra cosmetic imprint, while nameplate status information remains authoritative.

Eight new sound cues have two recorded variants each, conformed to the existing shipping audio standard. Release and successful-contact ownership prevents generic cues from doubling them. Cold recordings retain the existing fallback without scheduling a delayed duplicate hammer sound.

## Verification and remaining review

The control review uses matching gameplay-distance sandbox views in each legal specialization: Hobbling Cut, Jawcrack and Storm Bolt in all three, Armor Shear in Protection. Each complete capture records ten casts and 100 stills through recovery, with actual events, native clip names and source hashes. The final capture completed all frames with frozen source and no gameplay/console errors; its browser shutdown timed out, so its overall harness exit remains 1. That cleanup failure is retained in provenance. A separate real-GPU check verifies both blend equations and ordering through an actual renderer camera cut. The original baseline attempted two additional illegal Armor Shear fixtures; these are explicitly excluded from matching comparisons, not counted as passes.

Behavior is pinned by `tests/warrior_control.test.ts`, `tests/warrior_hammer.test.ts`, `tests/warrior_control_marks.test.ts`, and `tests/warrior_control_performance.test.ts`. `scripts/build_warrior_contact_anims.mjs` owns the native bake and `scripts/sfx/warrior_control_sfx.mjs` owns the new cue definitions.

The comparison images and a compact provenance file are in `docs/screenshots/warrior-control-v25`. Full capture reports remain in the sibling `studio-contact-pass` evidence directory. Intermediate looks are retained there, including the rejected bright additive hammer/armor treatment.

This is a production checkpoint, not whole-Warrior acceptance. Sustained repeated casting, moving opponents, bright and dark world terrain, crowd load, all six quality settings, sound listening, and two complete kit reviews remain part of final Warrior acceptance. Tony will review the finished Warrior in the previewer before approving other-character rollout.
