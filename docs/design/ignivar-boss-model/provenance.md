# Ignivar boss model provenance

## Reference

- File: `docs/design/ignivar-boss-model/reference-turnaround.png`
- SHA-256: `cb370c4dc1b08276cbce9cd5fe2601f1de0162cc7311e54f9c11c0ed21f180c7`
- Generator: OpenAI built-in image generation through Codex
- Input images: none
- Generated: 2026-08-08
- Approval: the user explicitly approved the generated turnaround in the task conversation
- Rights: original project concept generated for World of ClaudeCraft

## Prompt

```text
Use case: stylized-concept
Asset type: production-ready 3D game boss character turnaround / model sheet
Primary request: Design Ignivar, Herald of the Last Flame, an original colossal raid boss who looks like an ancient forge sovereign transformed into a living furnace. Create one clean landscape character design sheet showing the exact same character in four consistent full-body views: front orthographic, left side orthographic, back orthographic, and a large three-quarter hero view. Add one smaller inset showing the final enraged phase, preserving the same anatomy and armor.
Subject: A massive regal humanoid titan, approximately four player-characters tall, with a broad top-heavy silhouette, powerful arms, heavy grounded legs, and unmistakable front/back readability. His body is black volcanic stone fused with scorched forged metal. The chest armor opens around a bright white-hot furnace core, shaped like a deep crucible rather than a simple glowing circle. A crown of exactly three large forged-metal prongs grows from the head, visually echoing the boss's three-way fire attack. One arm is an enormous asymmetric armored forging arm used for the tank frontal; the other arm is partially elemental with visible contained fire beneath broken metal plating. Twin chimney-like shoulder structures vent controlled flame and embers upward. The face is stern, ancient and kingly, carved from dark metal and basalt, with a narrow furnace glow behind the eyes; not skeletal and not a generic horned demon. Armor plates are thick, readable, and practical to model, with large simple forms and selective engraved forge runes. Feet are heavy anvil-like armored shapes suited to a slow raid boss.
Final-phase inset: the same armor separates along engineered seams, exposing brighter magma cracks and a more intense furnace core; shoulder vents flare and the three crown prongs glow at their tips, but the silhouette and identity remain unchanged.
Style/medium: polished stylized 3D MMORPG character concept, chunky low-to-medium-poly-friendly forms, hand-painted PBR material look, strong readable silhouette, production model-sheet clarity, premium raid-boss quality, original design.
Composition/framing: 16:9 landscape sheet; all views fully visible from crown to feet, aligned to the same ground line and scale; neutral relaxed A-pose with arms slightly away from the torso in orthographic views; three-quarter view may use a restrained imposing pose. Spacious separation between views. No perspective distortion on orthographic views.
Lighting/mood: neutral studio key and fill light for clear material reading; furnace glow provides restrained warm rim light; dramatic but does not obscure geometry.
Color palette: charcoal black basalt, gunmetal and dark iron, burnt bronze accents, white-hot core, yellow-orange inner fire, restrained crimson magma fissures.
Materials/textures: cracked volcanic rock, hammered black iron, heat-tempered steel edges, burnt bronze royal details, ash deposits, emissive magma only inside cracks and furnace openings.
Constraints: exact same proportions, face, crown, armor layout and asymmetry in every view; exactly three crown prongs; clearly modelable geometry; visible hands and feet; front silhouette must make facing obvious during combat; fire must emerge only from designed vents, cracks and furnace openings; clean neutral dark-gray studio background; no environment, no floor scenery, no other characters, no weapon, no wings, no cape, no floating armor, no excessive spikes, no text, no labels, no logo, no watermark.
Avoid: generic red demon, skeleton face, dragon anatomy, realistic human skin, ornate visual noise, tiny unreadable details, smoke covering the body, flames hiding the silhouette, illustration-only painterly ambiguity, inconsistent turnaround views.
```

## Acceptance rationale

The approved reference has a readable regal silhouette, exactly three crown prongs, two
shoulder chimneys, a crucible chest core, an asymmetric forging gauntlet, a magma arm, and
heavy anvil feet. Those are the identity-critical systems the shipping GLB must preserve.
Small engraved details and free-form fire are simplified when they do not survive gameplay
distance or would inflate the draw and triangle budgets.

## HIFI reconstruction

- Clean reconstruction input: `docs/design/ignivar-boss-model/ignivar-hifi-input-v1.png`
- Input generator: OpenAI built-in image generation through Codex
- Tripo model: HIFI image-to-model with PBR textures and a 30,000-face target
- Tripo generation task: `424f8636-b142-4feb-909c-62cb18aaeb40`
- Rig: Tripo biped `v1.0-20240301`
- Shipping optimization: 1K GPU-compressed KTX2/Basis color, normal, and ORM textures;
  meshopt geometry and animation compression; no geometric simplification
- Animated VFX sockets: chest furnace on `Spine02`, shoulder vents on their matching
  clavicles, preserving the approved bind-pose placement while following every clip
- Approval: the user explicitly approved the real HIFI GLB render before rigging

The exact clean-reference prompt is preserved in the task conversation and the source image
is checked in. This historical HIFI candidate was finalized by the former HIFI finalizer;
its paid pipeline job remains under `tmp/asset_pipeline/ignivar_herald_hifi_v1/` for local
cost auditing.

## KayKit-native replacement

- Approved reconstruction input: `docs/design/ignivar-boss-model/ignivar-kaykit-input-v2.png`
- Input SHA-256: `51a62e5115d6de5db3dbf2f41865d9f7ee04f80d0e7706749af06d09cde36244`
- Input generator: OpenAI built-in image generation through Codex
- Tripo low-poly image-to-model task: `faec579d-0f72-4dbb-a11a-8c7578bb1699`
- Generated geometry: 7,879 triangles, 11,481 vertices, three 2K PBR source maps
- Rig: local zero-cost bind onto the shipped KayKit `Rig_Medium` skeleton using
  `scripts/asset_pipeline/lib/manual_rig.mjs`; no remote generic biped rig
- Animation: native KayKit locomotion/hit/death plus locally-authored `ForgeIdle`,
  `ForgeCast`, and `ForgeSlam`; the cast pins both hands and moves only the chest
- Shipping texture optimization: 1K KTX2/Basis textures
- Approval: the user explicitly approved the generated 3D turntable and requested
  in-game integration with the non-waving cast motion

The earlier HIFI asset above remains part of the design history. The paid generation job
and local manual-rig job remain under `tmp/asset_pipeline/` for cost auditing and clip
review. The KayKit replacement shipped until the contributor handoff below superseded it.

## Contributor Colossus and fire VFX (current)

- Handoff archive: `ignivar_fire_vfx.zip`
- Archive SHA-256: `a942d097629f2c1303ef142808697fc131e383448e173647b5f46e4e5e90195b`
- Source model: `public/models/chars/enemies/ignivar_colossus.glb` in the handoff archive
- Source VFX: `src/render/ignivar_vfx.ts` plus
  `public/textures/vfx/ignivar_flame_6x6.webp` in the handoff archive
- Rig: one 25-joint skin with authored core, vent, eye, and hand sockets
- Animation: 12 authored clips (`Attack`, the `Channel` sequence, `Death`,
  `FistSpin360`, three idles, `JumpAttack`, `Run`, and `Walk`)
- Shipping finalization: meshopt geometry/animation compression followed by KTX2/Basis
  conversion of all four embedded PBR textures
- Runtime integration: vent plumes, smoke ribbons, heat shimmer, emissive pulse,
  channel flame breath, muzzle fire, impact shockwave, and meteor ground-fire circles

The raw handoff model is expected at
`tmp/asset_src/ignivar_herald/ignivar_colossus.glb` when rebuilding through
`scripts/assets/specs/ignivar_herald.json`. The committed shipping GLB is the durable
artifact; the original archive remains contributor-owned project source. The historical
KayKit authoring and fingerprint scripts are retained for provenance and rollback, but no
longer own the shipping model.
