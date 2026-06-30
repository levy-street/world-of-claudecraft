# ARPG spell and 3D-combat mechanics

Direction note. We want combat to feel less like a tab-target hotkey MMO and more
like an action ARPG (Path of Exile 2, Diablo): spells you aim into the world,
ground you set on fire, bolts that chain and fork, blinks to where the cursor
points, telegraphed hits you side-step. We keep the nine existing classes and
their kits; this is about adding new ability VERBS, not new classes. Moving the
combat feel away from a 1:1 WoW clone is also the cheapest, least-disruptive part
of the broader "less recognizably WoW" goal (renaming a handful of verbatim
ability names is a separate, smaller pass; see the end).

This doc is a menu of concrete mechanics, each mapped to the exact engine seam it
plugs into, with an effort tag and an example. It assumes the deterministic-core
rules in `CLAUDE.md` (fixed 20 Hz tick, all randomness through `Rng`, server is
authoritative, `IWorld` is the only render/ui seam).

## What the engine already gives us (the head start)

Most ARPG spell visuals and several mechanics are already wired; we are extending,
not building from scratch.

- Effect model: `AbilityEffect` is a discriminated union in `src/sim/types.ts`
  (~982-1039). Adding a behavior is usually "new variant + one `case` in
  `runEffects`" (`src/sim/combat/effect_dispatch.ts:40`).
- Persistent ground zones ALREADY EXIST: the `groundAoE` effect creates a
  `GroundAoE` (`src/sim/entity_roster.ts:37`) that lives in `ctx.groundAoEs`,
  ticks via `tickGroundAoEs`, and pulses damage/auras via `pulseGroundAoE`.
  Consecration uses it. A fire patch / caustic ground is the same pipeline with
  different numbers and an ailment on pulse.
- Projectiles (merged #990): `scheduleProjectile` / `advancePendingProjectiles`
  (`src/sim/projectile_travel.ts`) home on the live target and resolve damage on
  impact. Pierce/chain/fork is "carry a little more state on the projectile and
  re-target at impact."
- Forced movement: warrior `charge` relocates an entity along a pathfound route
  and OWNS locomotion for its duration (`src/sim/sim.ts:~2565`,
  `effect_dispatch.ts` `case 'charge'`). Dash/blink is the same pattern aimed at a
  point instead of an entity.
- Renderer is ready for world-space spell art:
  - Terrain-draped rings: `src/render/selection_ring.ts` (the gold target ring)
    is a copy-paste template for a ground-target reticle and a zone outline.
  - Shader ground decals: `src/render/impact_site.ts` (meteor scorch) is the
    template for a persistent burning/caustic patch on the terrain.
  - Raycast-to-ground: `renderer.groundPoint(clientX, clientY, planeY)`
    (`src/render/renderer.ts:~4694`) already turns a mouse position into a world
    `{x, z}`. `groundHeight(x, z, seed)` (`src/sim/world.ts:121`) gives the
    surface height for both sim and render.
  - Transient VFX + event channel: `src/render/vfx.ts` has `projectile`, `beam`,
    `burst`, `nova`, `healGlow`, `buffSwirl`; the sim drives them through
    `SimEvent` `spellfx` (`{fx:'projectile'|'beam'|'tick'|'nova'}`) handled at
    `renderer.ts:~2677`.

The single missing primitive that unlocks the most ARPG feel:

- Ground-targeted casting. The cast command today carries only an ability id and
  resolves against `p.targetId` (tab target). There is no way to say "cast HERE
  at world (x, z)." Adding that one channel (a `targetMode: 'position'` plus an
  aimed `{x, z}` on the cast command) is what turns "AoE centered on me" into
  "meteor where I clicked," "firewall along that line," "blink to the cursor."
  Everything ground-aimed depends on it, so it is Phase 1.

## The enabler: ground-targeted casting (Phase 1)

Goal: a cast can carry an aimed world position, threaded net -> sim -> effect.

Touch points (vertical slice):
- `AbilityDef`: add `targetMode: 'entity' | 'position' | 'self'` (default
  `'entity'`, so every existing ability is unchanged).
- Wire/command: extend the cast command (`server/game.ts` cast handler + the
  `IWorld` combat seam `castAbility`) to optionally carry `aimX, aimZ`. The 20 Hz
  command stream already sends discrete commands; this is one more optional pair
  of floats, server-clamped to a sane range from the caster.
- `casting_lifecycle.ts`: when `targetMode === 'position'`, store the (clamped,
  LoS/leash-checked) aim point on the in-progress cast instead of requiring
  `p.targetId`.
- `effect_dispatch.ts`: effects that read a center (`groundAoE`, a new
  `groundZone`, `dash`) use the cast's aim point instead of `p.pos`.
- Client: on pressing a `position` ability, enter "aim mode" - per-frame
  `renderer.groundPoint(...)` draws a draped reticle (clone `selection_ring`);
  click/confirm sends `castAbility(id, {x, z})`; Esc/right-click cancels. Reuse
  the existing `pointer_pick` gesture plumbing.

Determinism: the aim point is server-authoritative input (like movement intent),
so it is part of the command, not an rng draw. No draw-order change.

Server-authority guardrails: clamp aim distance to the ability's range, run the
existing line-of-sight check from caster to aim point, and re-validate at cast
COMPLETE (not just cast start) so a moved/blocked caster cannot drop a zone
through a wall. The client never decides the outcome; it only proposes the point.

## Mechanic catalog

Effort tags: LOW (data + one effect case), MED (new sim state or projectile/
movement logic), HIGH (needs the Phase 1 cast channel or new protocol).
Each mechanic notes the seam and an example spell.

### A. Ground-targeted blast and lingering zones (flagship feel)

- Ground-target AoE: aim a circle, blast it once. HIGH only because of Phase 1;
  the resolution is the existing radius query (`ctx.hostilesInRadius`) centered on
  the aim point. Example: "Cinder Burst" (mage), "Sanctified Ground" (paladin
  heal-zone, friendly variant).
- Persistent damaging ground (burning ground, caustic cloud, blizzard,
  consecration): the `groundAoE` pipeline ALREADY DOES THIS - aim it (Phase 1) and
  tune duration/interval, add an ailment on pulse (see D). Effort LOW once Phase 1
  lands. Examples: "Firewall" (a short LINE of small zones), "Caustic Mire"
  (ground that also poisons), "Frost Field" (chills).
- Render: `impact_site` scorch decal for the patch + `vfx.burst`/`nova` on spawn;
  `selection_ring` draping for the live outline. Surface active zones on `IWorld`
  as a small `groundZones` list so the renderer can draw them every frame.

### B. Projectile behaviors (no Phase 1 needed)

The projectile is currently 1 bolt -> 1 target. Carry a little state and re-target
at impact:
- Pierce: keep flying through the first target, hit the next along the line.
- Chain: on hit, jump to the nearest not-yet-hit hostile within a search radius
  (reuse `hostilesInRadius`), up to N bounces. Classic "chain lightning."
- Fork / multishot: at launch, spawn K projectiles fanned across an arc.
- Effort MED, all in `projectile_travel.ts` (extend `PendingProjectile` with
  `pierce`, `chainRemaining`, `chainRadius`, `hitIds`); damage rolls stay at impact
  so rng draw-order is per-hit and deterministic. Render: emit a `spellfx`
  projectile per hop; the beam VFX already exists for the lightning look.
- Examples: "Arc Lash" (chain), "Splinter Bolt" (fork 3), "Lance" (pierce).

### C. Movement skills (dash / blink / leap)

- Dash/blink to a ground point: clone the `charge` ownership pattern
  (`updateChargeMovement` returns true to suppress normal locomotion) but aim at a
  Phase 1 point instead of an entity; straight lerp with the existing water/cliff
  terrain safety checks; optional brief i-frames or an AoE on arrival.
- Effort MED (LOW-MED for the movement itself; HIGH-tail is the Phase 1 aim).
  Leap-slam = dash + a `groundAoE` on landing, which composes two things we
  already have.
- Examples: "Shadowstep" (rogue blink-to-cursor), "Earthshatter Leap" (warrior
  leap + slam zone), "Phase Dash" (mage short blink with i-frames).

### D. Elemental ailments (de-WoWs combat, makes schools matter)

Replace ad-hoc WoW debuffs with a small, composable ailment set on top of the
existing `Aura`/`AuraKind` system (`types.ts:134`, auras already tick):
- Ignite (burning): a fire DoT that strong fire hits can refresh/stack.
- Chill -> Freeze: chill is a slow; enough chill stacks (or a big cold hit)
  briefly freezes (reuse `root`/`stun`).
- Shock: target takes increased damage for a few seconds (a vulnerability aura;
  `spellvuln`/`vulnerability` kinds already exist).
- Bleed / Poison: physical/nature DoTs that stack.
- Effort MED. Mostly new `AuraKind`s + application rules at damage time; the
  ticking machinery exists. Risk: this touches combat numbers, so gate it behind
  tests and keep base hit/armor/crit formulas (the "classic formulas" invariant)
  intact - ailments are an additive layer, not a rewrite.
- Payoff: lets "fire build vs frost build" actually feel different and gives
  spells secondary identities without new buttons. Strongly ARPG.

### E. Telegraphs and dodgeable enemy attacks (action feel, both ways)

- Enemy ground telegraph: a `telegraph` SimEvent + an `IWorld` telegraph list; the
  renderer draws a pulsing ground decal (clone `click_marker`/`selection_ring`)
  for "AoE landing here in N ms," then the existing `groundAoE`/`nova` resolves.
  Mobs already have an `aoePulse` affix - give it a wind-up + decal so players can
  step out.
- Effort LOW-MED (render + a wind-up timer on the existing pulse). This is the
  cheapest single change that makes fights feel action-y rather than stand-still.

### F. Displacement (knockback / pull / vacuum)

- Shove a target along a direction (knockback) or toward a point (pull/vacuum),
  reusing charge's terrain-safety clamps (no shoving into a cliff/water).
- Effort MED, a new effect kind in `effect_dispatch.ts`. Pairs with ground zones
  ("pull them into the caustic patch") for very ARPG combos.

### G. Totems / turrets / traps / minions (stretch)

- Drop a stationary or temporary entity that casts on its own (PoE totems/traps,
  Diablo sentry/hydra). This is the biggest item: it needs a spawned sim entity
  with its own simple AI and lifetime, plus interest-scoped sync. Defer until the
  cheaper wins land; the warlock pet (`pet_ai.ts`) and `summonPet` effect are the
  closest existing reference to copy.

## Recommended sequence (each a shippable PR)

1. Phase 1 - ground-targeted casting primitive + a reticle, with ONE example
   ground-target spell (e.g. mage "Cinder Burst" using the existing radius query).
   Unlocks the whole A/C family. Biggest single unlock.
2. Persistent aimed zones: convert/author `groundAoE` spells aimed via Phase 1
   (Firewall, Caustic Mire, Frost Field). Mostly data once Phase 1 lands.
3. Projectile behaviors (B): chain/fork/pierce. Independent of Phase 1, can run in
   parallel; immediate "build variety" payoff.
4. Ailments (D): ignite / chill->freeze / shock / bleed / poison as an additive
   layer; gives schools identity and de-WoWs the debuff list.
5. Telegraphs (E): wind-up + ground decal on enemy AoE; cheap, big feel upgrade.
6. Movement skills (C) and displacement (F): blink/leap/knockback.
7. Stretch: totems/traps (G).

A good first vertical slice is #1 (it is the enabler and demonstrates the whole
direction in the 3D world) or #3 if we want a no-protocol-change quick win first.

## Thematic ground-targeted spell roadmap (per class)

The ground-target primitive (Phase 1) shipped in `feature/ground-targeted-spells`
together with one ground-aimed spell for each caster/ranged class. Each is a
declarative record in `src/sim/content/classes.ts` with `targetMode: 'position'`,
plus its all-locale translations. Two shapes use the primitive: an INSTANT lingering
zone (a `groundAoE` effect dropped at the aim) and a CHANNELED area AoE (a `channel`
spell whose `aoeDamage` effect pulses at the aim each channel tick).

Caster/ranged classes take ground-targeted area spells; melee classes are better
served by the movement skills (dash/leap, section C) than by a ground AoE.

| Class | Spell | School | Effect | Status |
|---|---|---|---|---|
| Mage | Flamestrike | fire | instant lingering fire zone (groundAoE) | shipped |
| Warlock | Rain of Fire | fire | channeled fire AoE on the area | shipped |
| Hunter | Volley | physical (ranged) | channeled arrow AoE on the area | shipped |
| Druid | Hurricane | nature | channeled nature AoE on the area | shipped |
| Shaman | Earthquake | nature | instant lingering nature zone (groundAoE) | shipped |
| Mage | Blizzard | frost | lingering frost zone (groundAoE), chills | planned (pairs with the chill ailment, section D) |

The gating cost is NOT the mechanic, it is i18n: a brand-new spell needs its name
AND description translated in every supported locale (the English source in
`classAbilityNamesEn` plus the ~17 `src/ui/i18n.locales/<lang>.ts` overlays), or
`tests/localization_coverage.test.ts` fails the PR-tier CI gate. So each spell above
is best landed as its own small PR that pairs the one-line content record with its
all-locale translations, rather than batch-adding many records English-only (which
reddens CI). Sourcing quality translations, not writing the sim code, is the work.

## Guardrails (do not regress the invariants)

- Determinism: every new roll goes through `ctx.rng`; do not reorder existing
  draws. Projectile/zone damage rolls stay at impact/pulse time (already the
  pattern). Add a `tests/parity` golden for any new effect.
- Server authority: aim points and movement are proposed by the client and
  resolved/clamped server-side (range, LoS, terrain). The client stays a renderer.
- `IWorld` seam: new render needs (ground zones, telegraphs, aim reticle, dash
  state) are surfaced as fields/lists on `IWorld` and implemented in BOTH `Sim`
  and `ClientWorld`; `src/render` and `src/ui` read only `IWorld`.
- Content as data: new spells are records under `src/sim/content/`; player-facing
  names/text are English-only `t()` keys, and run `npm run wiki:content`.
- Balance: keep the base hit/crit/armor/rage formulas; ailments and new effects
  are additive layers tuned with tests, not formula rewrites.

## Naming / IP note (secondary, separate pass)

The combat-feel pivot above is mostly additive and does not require renames. When
we do the "less recognizably WoW" pass, the cheapest high-value edits are the few
verbatim ability display names (e.g. Frostbolt, Fireball, Heroic Strike, Mortal
Strike, Shadow Bolt) - display strings only, behind `t()`, no mechanics change.
Resource/term reskins (rage, threat, spec) and the project/realm brand are larger,
separate decisions and are out of scope for this combat-mechanics doc.
