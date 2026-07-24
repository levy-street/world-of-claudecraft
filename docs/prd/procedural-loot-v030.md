# PRD: Procedural Equipment Loot for v0.30

## Status

Implementation target: `release/v0.30.0`

Feature branch: `feature/procedural-loot`

This document records the repository-specific decisions for the attached
procedural loot specification. The attachment remains the product brief. This
document is the implementation and release contract where the brief meets the
v0.30 architecture.

## Product outcome

Enemies can drop recognizable equipment bases whose significant copies are
unique, deterministic item instances. Each instance can carry its own item
level, rarity, affixes, final numerical rolls, generated name, and one
legendary power.

The feature is complete only when an exact instance survives:

```text
generation
-> corpse or personal loot
-> party loot assignment
-> inventory
-> tooltip and comparison
-> exact-instance equip
-> central stat resolution
-> save and reconnect
```

Handcrafted dungeon and raid items remain valid progression choices.

## Locked architecture decisions

### Storage

`ItemInstancePayload.procedural` is the one persisted representation. The
generator never adds one dynamic `ItemDef` per rolled item.

Definitions describe what may exist. Instances describe what did exist.
`resolvedItemStats` combines the base definition, legacy rolled stats, enchants,
and procedural rolls for every gameplay and presentation consumer.

### Identity

Every procedural copy has a deterministic UID. Commands which can affect a
unique item use the UID or an authoritative inventory index, never only the
base item ID.

Loot transport carries the authoritative instance. Need/Greed, Master Loot,
round robin, personal loot, bag-full returns, and reconnect never regenerate an
item for the recipient.

### Determinism

An item seed is derived from:

- world seed
- source entity ID
- source spawn sequence
- loot slot index
- recipient ID for personal loot

Generation uses a child `Rng` with a fixed draw order:

1. rarity
2. base
3. item-level variance
4. affix count
5. affix selection
6. affix tiers
7. numerical rolls
8. legendary power
9. legendary rolls
10. name fragments

The child stream does not alter the shared combat RNG. Generator changes
therefore cannot rewrite unrelated combat or world outcomes.

### Rarity language

The existing v0.30 visual taxonomy remains canonical:

| Procedural rarity | v0.30 quality | Color |
| --- | --- | --- |
| Common | Common | White |
| Magic | Uncommon | Green |
| Rare | Rare | Blue |
| Epic | Epic | Purple |
| Legendary | Legendary | Orange |

Mythic is reserved for a later acquisition and visual contract. Procedural
rarity remains distinct in the instance model, while broad v0.30 consumers use
the mapped quality.

### Art

One raster or weapon render belongs to a stable base visual, never to an item
UID, generated name, seed, or affix set. The first six bases deliberately reuse
matching project art through stable visual keys.

Legendary power state uses a small project-owned code-native rune. Rarity
frames remain CSS. No third-party game icon, frame, beam, or audio is copied.

### Ground presentation

v0.30 stores item loot on corpses rather than as ground item entities. The
initial presentation is one corpse marker derived from the highest visible
unlooted procedural rarity. It shows a beam, ring, and label. Low graphics
retains the same discoverability. Reduced motion freezes presentation and
removes particles.

### Networking privacy

Self inventory and authoritative server state retain the full payload. Public
corpse and inspect projections omit the generation seed and drop context.
Public views carry only the fields needed to identify and explain the item.

### Economy

Vendor, destruction, direct trade, mail, and bank operations must preserve the
exact instance in this release. Procedural vendor values use the persisted
`baseValue * itemLevelFactor * rarityFactor * affixCountFactor` formula; sell,
buyback, tooltip, and vendor UI share one pure resolver, while static and legacy
instances retain their authored price. The existing World Market block on
instanced items remains. Market escrow, search, and filters are a separately
gated follow-up and do not block this release.

### Legendary safety

At most one legendary power is active for a character. Equipment effects use a
finite data vocabulary, simulation time for internal cooldowns, and a maximum
proc depth of four. Proc-created damage does not recursively trigger equipment
effects unless a power explicitly opts in.

## Delivery slices

### Slice 1: schema and deterministic generator

- Versioned procedural payload and deep clone support
- Stable bases, tags, affix and rarity definitions
- Seed and UID derivation
- Content validator
- Common, Magic, and Rare rolling
- Generated names
- Large deterministic and property test matrix

Exit: same seed yields byte-identical JSON and generated content satisfies all
eligibility, family, count, range, budget, and uniqueness invariants.

### Slice 2: exact instance and resolved stats

- `resolvedItemStats` as the central stat and weapon resolver
- UID-aware inventory actions and equip
- Clone, bank, trade, mail, vendor, destruction, and save validation
- Duplicate UID rejection or deterministic repair at load
- Legacy saves remain valid

Exit: two same-base copies equip the selected instance and produce their exact
different stats before and after save/reload.

### Slice 3: authoritative loot transport

- Procedural equipment drop entries
- World, rare, dungeon, and delve sources
- Spawn sequence and child seed context
- Smart-loot bias
- Corpse, personal, round-robin, Need/Greed, and Master Loot transport
- Bag-full and all-pass return paths

Exit: every assignment path awards the originally rolled payload and ordinary
combat observes no extra shared RNG draws.

### Slice 4: complete item UX

- Pure procedural name, tooltip, affix, and comparison view models
- Generated name, rarity, item level, base values, stable affix order, and
  advanced roll ranges
- Exact same-base comparison including both ring slots
- Rarity frames and legendary rune
- Structured localized loot events
- Inspect and Armory public projection
- Keyboard, gamepad, touch, forced-colors, low-graphics, and reduced-motion
  behavior

Exit: all consequential item decisions expose the exact copy before action on
mouse, keyboard, touch, and gamepad.

### Slice 5: generic effects and first legendary set

- Generic equipment event dispatcher and cached equipped-power list
- Counters, internal cooldowns, proc-depth guard, and contribution telemetry
- Migration wrapper for existing weapon procs
- One power for each class plus three neutral powers
- Deterministic counter, cooldown, ability mutation, and area-effect coverage

Exit: each power has focused mechanics tests and simulated sustained and burst
contribution within the release ceilings.

### Slice 6: presentation, balance, and release evidence

- Corpse beam, ring, label, declutter, and legendary sound hook
- Originality and asset provenance checks
- Reproducible loot distribution simulator
- Representative level 10, 15, and 20 class builds
- Hundreds of meaningful generated scenarios and direct regression tests
- Desktop, compact, mobile, low, reduced-motion, and forced-colors screenshots
- Full `npm run gate`
- Independent UX and graphics screenshot/input sign-off

Exit: no unresolved release-blocking review finding and the draft PR contains
the commands, reports, screenshots, balance bounds, and rollback notes needed
for maintainer review.

## Release ceilings

- One active legendary power per character
- Sustained single-target legendary contribution: 8 to 15 percent
- Intended burst-window contribution: no more than 25 percent
- No duplicate affix family on an ordinary item
- Three to five ordinary affix lines at the current level scale
- No item generation draw on a non-procedural loot entry
- No steady-state UI rewrite for unchanged item visuals
- No graphics tier changes which loot is discoverable

These are testable gates, not tuning suggestions.

## Required evidence

- Unit tests for every pure resolver and content definition
- At least hundreds of generated invariant cases across seeds, rarities, bases,
  levels, classes, and source types
- Host and replay determinism tests
- Exact-instance integration tests for every loot and inventory transfer
- Save, reconnect, legacy migration, hostile payload, and duplicate UID tests
- Accessibility and input tests for all consequential surfaces
- Reproducible distribution and combat balance reports checked into `docs/balance`
- Required screenshot matrix under `docs/screenshots`
- Targeted suites, build, lint, architecture checks, asset checks, and full gate

## Sign-off

Final approval requires all of the following:

- Primary implementation review
- Independent loot architecture review
- Independent UX review against the running input and screenshot matrix
- Independent graphics review against the running build and asset/performance
  evidence
- Draft PR against `release/v0.30.0`

Discovery reviews do not count as final sign-off.
