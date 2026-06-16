# Professions

**Status:** 📐 Scoped (1.0 ready to pluck) · **Fork:** Both · **Roadmap phase:** NEXT
(see [roadmap.md](../roadmap.md), item #10)

> The worked example for the [System Designs](./index.md) template. Numbers below are **proposed and tunable** — balancing them to vanilla feel at our 1–20 scale is part of plucking the spec.

## Summary

Classic professions, adapted to our **level 1–20 micro-MMO** (not retail's 1–300 grind). There are **no trainers**: you pick a profession from a **Profession panel**, and its skill rises **automatically through use** — exactly how abilities are already learned by level. Recipes and tiers **unlock at skill thresholds** with no extra step. The whole system is a second progression track that deepens the economy, rewards solo and social play, and gives the Auction House a supply side.

**1.0** ships the professions that need **no new world systems** (they run off existing item flows): **First Aid** and **Enchanting/Disenchanting**. **2.0** adds **gathering** (Mining, Herbalism) once the world-node spawn framework exists.

> **Scoping note (re: your "...then mining"):** Mining's *gathering* (ore veins) needs world spawn nodes, which is a shared framework with [Dynamic World Events](./index.md). To keep 1.0 tight and shippable, **Mining moves to 2.0** with the nodes. 1.0 is the framework + the two node-free professions. If you'd rather bootstrap Mining in 1.0 via ore as a mob drop (no veins), that's a one-line scope change — flagged in Open Questions.

## Design-lens answers

- **Announce:** "Professions are live — enchant your gear, disenchant drops, craft bandages." A genuine content drop with a release note and a clip.
- **Meme:** "disenchanted my BiS by accident"; showing off an enchant glow; the profession panel filling up. Self-inflicted-loss stories travel.
- **Gate:** **retention** first (a daily/solo reason to log in and a crafting loop), **reactivation** second (returners chase enchants). Light on acquisition.
- **Offense or defense:** **offense** — professions are a core vanilla pillar that vibe-MMO competitors lack, and they pair with full equipment slots to close our single biggest "feels missing" area.

## Pillar fit

- **Deterministic:** skill-up rolls and 2.0 node spawns go through `Rng`; same seed ⇒ same skill-ups and node layout. No wall-clock.
- **Sim-side:** all profession state and resolution live in `src/sim/`; runs offline/online/headless identically. (The RL env gains craft/gather actions — see [current-state RL parity](../current-state.md).)
- **Server-authoritative:** the server resolves every craft/gather/disenchant/enchant; the client only requests and renders.
- **Token stays structural:** skill, materials, and recipes are resolved **inside the sim, server-authoritative** — never injected by the entitlement/token layer mid-tick. (Whether $WOC ever sells profession boosts is a Fork A decision; even then it would grant a server-side entitlement the sim never reads directly.)
- **Journey-first:** skill rises *with play*; nothing is skippable or purchasable.

## Scope tiers

### Shared framework (built in 1.0)

- **Profession slots:** *propose* **2 primary + First Aid (secondary, always available)**. Tunable.
- **Profession panel:** a new tab (sibling to Talents/Spellbook in `hud.ts`). Pick a profession from the list; shows current skill, unlocked recipes, and next unlock threshold.
- **Skill range:** *propose* **1–100** (scaled down from classic 1–300 for a 1–20 world).
- **Auto skill-up:** each successful craft/gather has a difficulty-colored chance to raise skill (orange = guaranteed-ish, yellow = likely, green = low, grey = none), rolled via `Rng`. Recipes auto-unlock at thresholds — no trainer, surfaced in the panel.
- **Dropping a profession:** *propose* **parks** the skill (resume later) rather than wiping it — friendlier than classic and consistent with "earned." Tunable (could add a cooldown).

### Professions 1.0 — node-free (the pluckable sprint)

**A. First Aid (secondary)**
- Input: **Cloth**, dropped by humanoid mobs (small content add to humanoid loot tables in `content/`).
- Recipes by skill: Linen Bandage (skill 1) → Heavy Linen (20) → Wool (40) → Heavy Wool (60)… each a stronger heal-over-time.
- Behavior: usable **out of combat only**; applies a **"Recently Bandaged"** debuff that blocks re-bandage for ~60s (classic anti-spam). *Propose* Linen heals ~ a third of a mid-level character's HP over 6s — tune against level-scaled HP.
- Reuses the existing HoT mechanic.

**B. Enchanting + Disenchanting** — a closed, node-free loop
- **Disenchant:** destroy an uncommon/rare weapon or armor → **materials** (dust / lesser-greater essence / shard) scaled by the item's quality and level. Skill-up on disenchant. Quest items and equipped items excluded; confirm prompt to prevent the "deleted my BiS" meme becoming a support ticket.
- **Enchant:** apply a **permanent stat bonus to an equipped slot** (e.g. +STA to chest, +AP to weapon), consuming materials. Tiered by skill.
- **Balance:** enchant magnitudes are **small relative to gear budget** (*propose* +1–3 at our scale) so they enhance, not replace, drops — and never break vanilla math. This is an *earned* gear-power sink: surplus drops → mats → your own gear.
- **Synergy:** benefits from [Full equipment slots](./index.md) but works on the current 4 slots day one.

**Explicitly OUT of 1.0:** world gathering nodes, Mining/Herbalism, crafted gear from raw mats, Alchemy. All need 2.0's node framework.

### Professions 2.0 — gathering + the node framework

- **Mining** (ore veins) and **Herbalism** (herb nodes) as **deterministic world spawn nodes** — reuse the mob-camp spawn infra (`content/zoneN` + the sim spawn loop), interest-scoped like mobs, `Rng`-seeded positions and respawn timers.
- **Smelting** (ore → bars), feeding a future Blacksmithing (3.0).
- **Alchemy** (herbs → potions) — 2.0 or 3.0.
- **Depends on:** the node-spawn framework (shared with [Dynamic World Events](./index.md) — build once, both consume it).

## Open balance questions (fill when plucking)

- Skill cap (1–100?) and the skill-up probability curve per difficulty color.
- Profession slot count (2 primary + First Aid?).
- Cloth drop rate; bandage heal values vs level-scaled HP and combat downtime.
- Enchant magnitudes vs the per-slot gear stat budget (must not exceed a drop tier; must stay non-P2W).
- Disenchant material yield tables by item quality × level.
- 2.0: node density, respawn timers, ore/herb tiers by zone level band.
- **Scope call:** Mining bootstrap in 1.0 via ore-as-mob-drop, or hold all gathering for 2.0? (Recommendation: hold for 2.0.)

## Hook points

- `src/sim/sim.ts` — `CharacterState`: add `professions` (skill per profession). Commands: `craft`, `disenchant`, `enchant`, `bandage`; skill-up via `Rng`.
- `src/sim/content/items.ts` — cloth, bandages, enchant materials, enchant definitions; humanoid loot additions.
- `src/sim/entity.ts` — `recalcPlayerStats`: apply enchant stat bonuses (and any 2.0 enchant slots).
- `server/game.ts` — dispatch the new commands; persist `professions` in the JSONB character state (already JSONB, so additive).
- `src/ui/hud.ts` — Profession panel (new tab); disenchant confirm dialog.
- **2.0:** world node entity type + spawn loop (reuse camp-spawn code in `content/zoneN.ts` + sim), renderer for nodes.
- **i18n:** every new player-visible string is a `t()` key in all 12 locales (profession names, recipe names, panel labels, the "Recently Bandaged" tooltip, confirm dialogs).

## Acceptance criteria & tests

- **Determinism:** same seed + same actions ⇒ identical skill-ups and (2.0) node layout — a `tests/professions.test.ts` assertion.
- **First Aid:** bandage heals the expected HoT, blocked in combat, "Recently Bandaged" prevents stacking.
- **Enchant/Disenchant:** disenchant yields match the table; enchant applies the stat via `recalcPlayerStats`; equipped/quest items can't be disenchanted.
- **Sim-purity invariant:** assert the deterministic sim resolves skill/materials/recipes with **no read of token/entitlement state** — a determinism guard like the localization S3 guard. (Power-vs-cosmetic monetization is a product call; this test only protects the sim core.)
- **Persistence:** professions round-trip through serialize/deserialize and the 30s autosave.

## Dependencies

- **Pairs with:** [Full equipment slots](./index.md) (more enchant targets), [Earned upgrade currencies](./index.md) (sibling gear-power loop).
- **2.0 shares** the world-node spawn framework with [Dynamic World Events](./index.md) — sequence them together.
