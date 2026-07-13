# Offhand and Dual Wield

Single source of truth for the first real offhand and dual-wield pass. This document exists
because the current repo has only a visual offhand slot and a one-weapon combat model. If the
operator changes an offhand, shield, or dual-wield rule mid-session, update this file in the same
change.

Status legend: LOCKED = operator-approved design intent for implementation. PENDING = not built yet.

## Current state (2026-07-09)
- The character window now shows an `offhand` slot in the paperdoll, but it is visual only.
- The sim still models one equipped weapon for gameplay: `mainhand`.
- The renderer has a rogue-specific visual dual-wield override, but it duplicates the equipped
  mainhand model and is not a real second weapon system.

## Goals
- Add a real `offhand` equipment slot.
- Support shield and held-offhand items without forcing combat changes.
- Support real weapon dual wield for the classes/specs that are meant to use it.
- Keep the first implementation narrow: the offhand weapon affects auto-attacks first, not every
  weapon-based ability.

## Item and slot model (LOCKED)

### Equip slots
- Real equip slots:
  - `mainhand`
  - `offhand`

### Item categories
- `weapon`
- `shield`
- `held_offhand`

### Weapon hand tags
Weapons must stop using a single broad `slot: 'mainhand'` meaning. They need an explicit hand-use
tag:
- `hand: 'mainhand' | 'onehand' | 'twohand'`

Rules:
- `mainhand`: can equip only in `mainhand`
- `onehand`: can equip in `mainhand`, and can equip in `offhand` only when the wearer is allowed
  to dual wield
- `twohand`: equips in `mainhand` and blocks `offhand`

### Offhand legality
- `shield`:
  - equips only in `offhand`
  - never attacks
  - contributes stats
- `held_offhand`:
  - equips only in `offhand`
  - never attacks
  - contributes stats
- `weapon` with `hand: 'onehand'`:
  - can equip in `offhand` only if the wearer has dual-wield permission
  - attacks as a real offhand weapon
- `weapon` with `hand: 'mainhand'`:
  - cannot equip in `offhand`
- `weapon` with `hand: 'twohand'`:
  - cannot equip in `offhand`

### Two-hand behavior
- Equipping a `twohand` weapon clears or blocks `offhand`.
- Equipping an offhand item while a `twohand` weapon is worn is illegal.

## Warrior rules (LOCKED)
- Arms:
  - intended loadout: two-handed weapon
  - no dual wield in the first pass
- Fury:
  - intended loadout: one-handed weapon in `mainhand` plus one-handed weapon in `offhand`
  - dual wield enabled
- Protection:
  - intended loadout: one-handed weapon in `mainhand` plus shield in `offhand`
  - no dual wield in the first pass

These are the intended default spec identities, not a full future-proof rule for every class in the
game.

## Combat rules for offhand weapons (LOCKED)

### First-pass scope
The first implementation must keep the current ability model stable:
- weapon-based abilities continue to use `mainhand`
- offhand weapon gameplay applies to auto-attacks first
- shield and held-offhand items do not add any attack events

### Offhand auto-attacks
If the wearer has:
- a valid `mainhand` weapon, and
- a valid `offhand` weapon,

then the character is considered `dualWielding` and gains a second auto-attack stream.

Rules for that stream:
- the offhand swing uses the offhand weapon's own speed
- the offhand swing uses the normal melee hit pipeline
- the offhand swing deals 50% of its resolved weapon damage

The 50% rule is intentionally Classic-like and is the locked baseline for the first implementation.

### Dual-wield miss penalty
When `dualWielding` is active:
- the dual-wield miss penalty applies to white melee auto-attacks
- the penalty affects both the mainhand and offhand white swings
- the penalty does not change the current behavior of yellow/special weapon abilities in the first
  pass

This mirrors the intended Classic-like model while keeping the current ability system stable.

## Shield and block (LOCKED 2026-07-09)
- A shield in `offhand` enables a real Classic-style block layer now.
- Block is passive, not a meter or spender. There is no visible block resource, HUD bar, or extra
  UI meter.
- Block applies only against frontal physical melee hits.
- A successful block reduces the hit by the shield's `blockValue`.
- The first pass keeps block intentionally narrow:
  - no new visible block event text is required
  - no spell block model
  - no ranged block model
- `shield_slam` does not gain a shield requirement in this change unless the operator asks for it
  explicitly in a later change.

## Implementation order (LOCKED)
Build in this order:
1. type and content model for `offhand`, `shield`, `held_offhand`, and weapon hand tags
2. equip and unequip rules
3. derived stats and entity mirrors (`recalcPlayerStats`, inspect/state mirrors, snapshots)
4. UI and tooltip legality
5. offhand auto-attack stream
6. online mirror and snapshot coverage
7. renderer support for a real offhand item
8. later follow-up: shield requirements or offhand-aware yellow attacks

## File map for implementation (PENDING)
- `src/sim/types.ts`
  - add real `offhand` equip slot
  - add item typing for `shield`, `held_offhand`, and weapon `hand`
- `src/sim/content/items.ts` plus content packs under `src/sim/content/`
  - migrate weapon definitions away from the current broad `slot: 'mainhand'`
  - add real shield and offhand items when content is ready
- `src/sim/equipment_rules.ts`
  - class/spec legality for offhand, shields, and dual wield
- `src/sim/items.ts`
  - equip/unequip behavior for `offhand`
- `src/sim/entity.ts`
  - derive gameplay from `mainhand` plus `offhand`
  - keep renderer/inspect mirrors in sync
- `src/sim/combat/auto_attack.ts`
  - add the offhand swing stream and dual-wield miss logic
- `src/world_api.ts`
  - expose the real offhand state through the IWorld seam as needed
- `src/net/online.ts`
  - mirror offhand equipment and any extra wire fields required
- `src/ui/char_window.ts`, tooltips, compare views
  - stop treating offhand as visual-only once the gameplay data exists
- `src/render/characters/*`
  - replace the rogue visual fake-dual-wield path with real offhand rendering when ready

## Explicit non-goals for the first pass
- No attempt to rework every weapon-based ability to choose hand dynamically.
- No full Classic hit-table rewrite outside the dual-wield white-hit penalty needed here.
- No universal cross-class dual-wield rollout before the operator asks for it.
