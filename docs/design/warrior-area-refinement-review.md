# Warrior receiving-impact refinement

The full-kit studio review exposed three concrete readability problems:
Breachmaker's retained mark looked like added glowing armor, Reaping Arc's
outer outline competed with the enemy contact, and Faultline's inner plates
covered the attacking character. This checkpoint addresses those findings.

- Breachmaker now leaves an open diagonal steel fracture at the actual torso
  height. Its existing atlas cell gains physical coverage and depth sorting;
  the original armor shows through around the seam. Aura ownership and expiry
  remain unchanged.
- Reaping Arc retains its complete authored footprint, with a stronger forward
  cutting face and quieter rear trace. Its rear opening remains behind the
  player; no gameplay cone or damage radius changed.
- Reaping Arc, Bladed Gyre, Bladestorm and Revenge gain a brief receiving flash
  and the existing authored steel-shear sprite. One retained highlight follows
  each struck enemy's position and rotation. The ribbon is additive; dark
  coverage comes from the steel sprite, not from that ribbon.
- Faultline retains all original geometry, height and reach. Inner plates have
  more transparency so the full outer eruption frames a visible attacker.

The new receiving path reuses the existing prepared pools. It cannot evict
primary weapon trails; its sprite can decline when the prepared pool is full.
Misses and full absorbs retain their separate behavior. No sim, damage,
duration, audio, camera or Red Harvest changes are included.

Matched studio evidence, normal gameplay camera and Ultra setting:

| Ability | Before | After |
| --- | --- | --- |
| Breachmaker, retained mark | [Before](../screenshots/warrior-area-refinement/before-arms-breachmaker-t1.50.png) | [After](../screenshots/warrior-area-refinement/after-arms-breachmaker-t1.50.png) |
| Reaping Arc, contact | [Before](../screenshots/warrior-area-refinement/before-arms-cleave-t0.15.png) | [After](../screenshots/warrior-area-refinement/after-arms-cleave-t0.15.png) |
| Faultline, eruption | [Before](../screenshots/warrior-area-refinement/before-prot-faultline-t0.30.png) | [After](../screenshots/warrior-area-refinement/after-prot-faultline-t0.30.png) |

Before: external `warrior-final-warrior-complete-cycle-one-sept18`.
After: `warrior-final-warrior-area-ground-final`, all six selected abilities
completed without runtime errors, missing assets or source drift. Intermediate
`warrior-final-warrior-area-seams-polished` predates the torso-height and
Faultline transparency refinement. The bottom controls obscure the nearest
ground in these matched frames; an unobscured outdoor review is separate.

Validation: six focused suites passed 84 tests, including the area-routing,
steel geometry, contact and real-engine frame-cost checks. Four additional
suites passed 21 tests, including receiving marks following translation and
rotation, disappearing on target removal, mixed overlay sorting, unchanged
ground dimensions and hammer atlas contracts. The four moving-target cases
failed on the old implementation before the fix. Production bundle passed.

Read-only render review found no blocking preparation, pool, ownership or
allocation issue. It correctly identified the additive highlight limitation
documented above. GPU timing is not inferred from these checks.

This is a refinement checkpoint, not final full-kit acceptance. The outdoor
second cycle, final reduced-motion checks, sustained rotation review and
canonical contribution gate still need completion. A first outdoor attempt
was invalidated by a build-triggered preview reload and is not acceptance
evidence. Public Site publication has not occurred.

## Outdoor follow-up

`warrior-final-warrior-complete-cycle-two-frozen` completed every active Warrior
fixture without errors, missing assets or source drift. Controls were hidden
through capture-only CSS; camera, gameplay and effects remained ordinary Studio
settings. Review confirmed the improved Faultline silhouette and Breachmaker
mark. Outdoor lighting varies between runs, so these are context checks rather
than a controlled material comparison.

The follow-up `warrior-final-warrior-leap-storm-final` keeps Leap's full geometry,
radius, dust and landing force but uses earthier mineral colors and finer edge
highlights. Four Leap suites passed 15 tests. The outdoor frame is retained
[here](../screenshots/warrior-area-refinement/leap-outdoor-final.png).

Bladestorm's former first post-hit sample was too late to judge its peak: the
1.15-second frame is 200ms into an impact whose flash lasts 65ms. The capture
harness now includes the actual pulse and early aftermath. The
[1.00-second frame](../screenshots/warrior-area-refinement/bladestorm-receiving-peak.png)
shows the receiving catch. No contact-timing code was changed for this finding.
Both follow-up fixtures completed cleanly. Sustained combat, reduced motion and
the canonical gate remain separate checks.

`warrior-natural-timing-warrior-final-sept18` subsequently completed three
30-second live-clock rotations against five training dummies: Battlecraft,
Bloodrush and Iron Guard. No resource, cooldown or aura resets occurred during
the takes. All completed without runtime errors or source drift. Measured frame
times were 7ms median and 14ms p95 for each; maxima were 62.5ms, 21ms and 21.1ms
respectively. These are measurements on this laptop, with audio off, not isolated
GPU benchmarks or raid acceptance. Battlecraft registered two real recipients;
the other rotations registered five. The fixture supplies no hostile attacker,
so it does not establish incoming-damage or Revenge Free coverage.
