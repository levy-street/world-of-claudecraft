# Delayed Red Harvest and Warrior movement review

19 September 2026. Art review checkpoint on `wip/vfx-studio-v25`.

## Red Harvest

The existing opening and Fury character animation are preserved. The three original weapon strikes resolve together 0.50 seconds after activation. Damage, refunds and Enrage follow that delivery; cost and cooldown still start on activation. The impact is driven by the actual damage event, so a miss produces no blood and a fully absorbed hit produces a shield response.

The receiving effect combines a brief hot wound flash, a large detailed Blender spray directed through the target, finer crossing spray, ballistic droplets and body-following wound marks. The full-quality primary spray uses a 14.5 authored size. A hidden nine-unit rendering clamp previously prevented that scale; only the Warrior impact atlas families now allow up to 18. Secondary recipients keep a smaller receiving composition. The existing bounded GPU pools are unchanged.

Two alternate membrane designs were rejected in actual preview captures because their silhouettes resembled antlers or wings. The final detonation omits that membrane and uses the detailed spray. The opening, timing, collision and dissipation remain distinct phases. The impact recording plays with the receiving blast; its coordinates survive a disappearing target view.

A paid delayed swing checks that the original source and target still exist, are alive and hostile, remain within the allowed melee delivery reach, and have line of sight. Invalid delivery cancels without damage, refund or random-number draws. Selecting another target does not redirect the committed swing.

## Continuing Warrior movement work

Stormbolt uses an upright loaded throw with a raised throwing hand, a spirit hammer held at that hand before flight, and the offhand weapon retained. Its projectile continues homing when a recipient retreats instead of forcing an early arrival. Its native recovery lasts 0.82 seconds. Point-blank throws retain a shorter visual hand hold to fit existing projectile travel; full native release is at 0.14 seconds. Stormbolt simulation travel was not changed.

Offline joint overlap introduces body-led loading, later hand acceleration and unequal recovery. Mounted weapon clearance is checked against real equipment geometry, with corrections baked into native clips. Runtime inverse kinematics and pool expansion are unnecessary. 38 nonspin clips change; the two spin clips and original Fury animation asset are preserved.

## Evidence and limits

- Deterministic delayed-damage tests cover the deadline, refunds, Enrage, lethal first hits, mixed outcomes, identity replacement, cancellation and repeatability.
- Native asset proof samples all 40 clips every 2 milliseconds with production equipment mounts; foot, endpoint, equipment clearance and Stormbolt throw checks pass.
- Focused simulation, rendering, architecture and asset tests pass. TypeScript passes.
- Matching captures and repeat-cast reports are retained in the external studio-contact-pass evidence directory, including rejected prototypes. Final publication records bind captures and native asset hashes to the committed source.
- The broader game contribution gate remains a separate release requirement. This is an invitation to review the art, not a claim of final AAA approval or whole-game release readiness.
