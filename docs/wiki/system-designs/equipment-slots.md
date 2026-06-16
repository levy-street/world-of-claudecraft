# Equipment Slots

**Status:** 📐 Scoped (2.0 ready to pluck) · **Fork:** Both · **Roadmap phase:** epic — see [tier map](#tier--phase-map)
(roadmap: [NOW #1](../roadmap.md#now--depth-at-current-scale-target-v08))

> The full character sheet, shipped as a **complexity-ordered ladder** — not one big bang. Each tier adds ~4 slots and is its own pluckable sprint. Numbers are **proposed and tunable**.

## Summary

Today we expose **4 of vanilla's ~16 equipment slots** (`mainhand`, `chest`, `legs`, `feet`). Gear is half the game; showing a quarter of the paperdoll is our single most-felt itemization gap. This epic fills the rest **in tiers ordered by implementation complexity**, so each step ships cleanly and every "the paperdoll filled up more" moment is its own beat. Unblocks set bonuses, trinkets, enchant targets, and the earned-upgrade loop.

## Design-lens answers

- **Announce:** "Helms, gloves, belts — and later rings and trinkets." A visible character-sheet-grows beat per tier.
- **Meme:** finally-have-a-helmet screenshots; showing off a full matched set; the paperdoll filling in.
- **Gate:** **retention / depth** — deepens the gear chase and unblocks several other systems. Not an acquisition play.
- **Offense or defense:** **defense** — table-stakes itemization that closes our biggest vanilla gap. (The *offense* comes from what it unblocks: sets, trinkets, enchanting.)

## Pillar fit

- **Deterministic / sim-side:** slots are pure stat aggregation in `src/sim/`; no new RNG except trinket procs (4.0), which go through `Rng`.
- **Server-authoritative:** the server validates equip (class/slot/level rules) and recomputes stats; the client only requests.
- **Token stays structural:** equip resolves server-side in the sim; the entitlement/token layer never reaches into a tick. (Whether gear power is ever token-linked is a Fork A call, bounded by the two guardrails — not a no-power rule.)
- **Journey-first:** more slots to fill as you level; the chase grows with the player.

## Tier → phase map

| Tier | Slots | Total | New this tier | Roadmap phase | Complexity |
|---|---|---|---|---|---|
| **1.0** | mainhand, chest, legs, feet | **4** | *(baseline — already shipped)* | 🏁 Shipped | — |
| **2.0** | + head, shoulder, hands, waist | **8** | 4 standard armor slots | **NOW (v0.8)** | Low |
| **3.0** | + wrist, back, neck, offhand | **12** | armor + first stat-only (neck) + offhand rules | **NEXT (v0.9)** | Medium |
| **4.0** | + ring ×2, trinket ×2, ranged/relic | **~17** | duplicate slots, on-use/proc trinkets, class-specific ranged | **LATER** (with [set bonuses #19](../roadmap.md#later--the-identity-expansion-the-60-era)) | High |

## Scope tiers

### Equipment Slots 2.0 — the armor core (→ 8) · **pluck this first**
- Add **head, shoulder, hands, waist** — all standard armor slots that reuse the existing armor/stat path.
- Work: extend the `EquipSlot` union + the slot list in `recalcPlayerStats`; author items for the new slots across the existing quality tiers; paperdoll UI gains 4 frames; render visible armor is **optional/stretch** (stats first).
- Lowest complexity, biggest "feels complete" jump (doubles the visible character sheet).
- **OUT:** jewelry, offhand, trinkets — different rules, later tiers.

### Equipment Slots 3.0 — defensive + offhand (→ 12)
- Add **wrist, back** (armor), **neck** (first **stat-only** slot — no armor value), and **offhand**.
- **Offhand introduces real rules:** shields (armor + block) vs held/caster off-hands, which classes may use what, and **two-handed weapons that occupy mainhand and disable offhand** (a new `twoHand` item flag).
- **OUT:** rings/trinkets/ranged.

### Equipment Slots 4.0 — jewelry, procs, ranged (→ ~17)
- Add **ring ×2, trinket ×2, ranged/relic**.
- **Duplicate slots:** the equipment map needs distinct keys (`ring1`/`ring2`, `trinket1`/`trinket2`) and the paperdoll must target a specific index.
- **Trinkets introduce equip effects:** on-use actives and passive procs (via `Rng`) — the most complex piece; lands with [set bonuses & itemization depth](../roadmap.md#later--the-identity-expansion-the-60-era).
- **Ranged/relic** is class-specific (hunter ranged vs caster wand vs paladin/shaman relic).

## Open balance questions (fill when plucking)

- **Stat-budget rescale (critical):** adding slots must **not** simply multiply equipped power. Re-tune per-slot stat budgets so *total* equipped stats track the intended 1–20 power curve — going 4→8 slots roughly doubles gear power if budgets are unchanged. This is the main balance work of every tier.
- Which armor slots carry how much of the budget (head/chest heavy, wrist/waist light, per vanilla feel).
- Class/slot eligibility rules (cloth/leather/mail/plate by class; who can use shields/two-handers).
- Neck/ring stat-only budgets; trinket proc rates and magnitudes (4.0) — must stay non-P2W and within a drop tier.

## Hook points

- `src/sim/types.ts` — extend the `EquipSlot` union (currently `'mainhand' | 'chest' | 'legs' | 'feet'`); add `twoHand` item flag (3.0).
- `src/sim/entity.ts` — `recalcPlayerStats` iterates a hard-coded slot list (`['mainhand','chest','legs','feet']`); extend it. `PlayerEquipment` is `Partial<Record<EquipSlot,string>>`, so additive — except 4.0's duplicate slots need explicit `ring1/ring2/trinket1/trinket2` keys.
- `src/sim/content/items.ts` — author items per new slot; `slot` field already exists.
- `src/sim/sim.ts` / `server/game.ts` — equip validation (class/slot/level, two-hand/offhand rules); equipment persists in JSONB state (additive).
- `src/ui/hud.ts` — paperdoll frames per slot; index-aware targeting for rings/trinkets.
- `src/render/` — *optional* visible armor models per slot (stretch; stats work without it).
- **i18n:** slot names and any new tooltips as `t()` keys in all 12 locales.

## Acceptance criteria & tests

- **Stat aggregation:** equipping each new slot adds its stats via `recalcPlayerStats`; unequipping reverts — deterministic, in `tests/`.
- **Rules:** class/slot eligibility enforced server-side; two-hander clears/locks offhand (3.0); ring/trinket indices independent (4.0).
- **Balance guard:** a test asserting total equipped stat budget at a given level stays within the intended band (catches the "doubled power" regression).
- **Persistence:** expanded equipment round-trips through serialize/deserialize + autosave.

## Dependencies

- **Unblocks:** [Professions](./professions.md) enchanting (more enchant targets), set bonuses & [itemization depth](../roadmap.md#later--the-identity-expansion-the-60-era), the [earned upgrade loop](./index.md).
- **4.0 lands with** the LATER "set bonuses, trinkets & itemization depth" roadmap item — they're the same itemization push.
