# Fury v25 production checkpoint - 8 September 2026

Status: implementation in progress. This checkpoint is not Warrior completion,
AAA visual acceptance, the full gate, or a published-site update.

## Implemented

- Twinstrike and Red Harvest own component-by-component contacts, including
  interleaved secondary victims. Missed components produce no wounds; absorbed
  components show protective contact. Extra component events cannot wrap the mask.
- The main character uses delivered native-rig animation clips with two different
  blade commitments and a separate rising cross-blade finisher. The exporter is
  scripts/build_fury_anims.mjs; both clips recover within 0.75 seconds.
- A lit torn blood sheet supports the strong blade edge. The generic duplicate
  slash composition is removed from the primary victim. Secondary victims retain
  their own timed wounds, without replaying the source performance or camera shake.
- Sequenced contacts are packed in the contact frame. The main slash has protected
  ribbon admission; projectile heads can displace decoration but not hard-control
  tells. Expired crest slots are reclaimed before a new contact is admitted.
- Crest geometry is compiled invisibly, every output program is settled and touched
  in a separate existing scheduling unit, then its real shared geometry is uploaded
  by the existing bounded draw. Failed preparation never declares the blood sheet
  ready. Cleanup attempts every child release even if another callback throws.
- Primitive preparation is extracted from renderer.ts. Its monolith ceiling is
  reduced, not increased.

## Evidence

Typecheck passed. The focused contract run passes 142 tests across 12 suites:
authored Fury clips, component outcomes, physical choreography, real FX frame
packing, hard-control bands, idle behavior, crest preparation, primitive preparation,
ribbon admission, signature clips, texture preparation and monolith budget.

Matching captures use studio-contact-pass/fury-review.mjs, real duel fixtures,
1400x900 viewport, camera distance 10, yaw 0.7 and 1.9, pitch 0.4. The baseline
is fury-resumed-baseline; the current composition is fury-checkpoint-1. Each set
contains 24 PNG frames and a report for four casts with expected two/three positive
components, no captured page errors, and no context loss. These are headless visual
smoke captures, not hardware performance evidence. The intermediate native-authoring
capture did not yet wire the new animation into the character manifest and must
not be cited as evidence for the delivered animation. native-wired does.

Sonnet supplied additional component test drafts. Parent review corrected the
secondary-victim blood expectations and replaced a non-demonstrating zero-bit
mask test with a seventeenth-hit overflow regression. Parent ran the tests. No
acceptance criteria were relaxed to make the implementation pass.

## Remaining before Fury acceptance

- Finish the art and sound review of both attacks; authored clips and larger shapes
  alone do not establish satisfying motion. Review real weapon contact and victim
  imprint from additional angles, at gameplay distance and repeated cadence.
- Exercise all quality settings, reduced motion, multi-enemy sustained overlap,
  contrasting backgrounds, and forced deferred/constrained preparation.
- Record headed, visible, normal-vsync, real-hardware first-use and repeated-cast
  performance. Normal boot screenshots do not establish shader preparation cost.
- Complete all other Warrior abilities, then Rogue and the remaining kits, followed
  by the two requested full visual review cycles and the unresolved full-gate work.

## Wolf production

The first generated Druid wolf candidate is structurally valid but visually too
slim and has placeholder quadruped walk clips reused for attacks. It is NOT applied.
Tripo job creature_druid_primal_wolf_v25_mts8ho0l consumed 90 credits, US$0.90.
A stronger builtin-imagegen concept was saved in the workspace at
studio-contact-pass/wolf-concepts/druid-primal-wolf-v2.png and supplied to a second
Tripo candidate. Final anatomy, rigging and individually authored animal attacks
still require review. The existing ordinary wolf and Shadewolf assets are preserved.
No private handoff or credentials belong in source control or generated public assets.
