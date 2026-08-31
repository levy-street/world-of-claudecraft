# Crucible of the Last Spring: professions plan

## Status

Living design for the profession arm of the Crucible of the Last Spring tier:
drop-taught recipes, the crafted best-in-slot pieces, and the raid reagent
economy. Companion to the loot plan (docs/prd/ignivar-raid-loot.md), which owns
the itemization framework this doc sizes against. The originating direction
(terrid, adopted by the maintainer) is the classic raid-tier shape: craftable
items whose patterns drop in the raid AND whose crafts consume a rare component
that drops in the raid, so both halves of the profession economy run through
the instance.

Scope decisions fixed by the maintainer:

- Five crafts participate: armorcrafting, leatherworking, tailoring,
  enchanting, and weaponcrafting. Jewelcrafting and inscription are out (no
  shipped recipes to build on), and cooking, alchemy, and engineering are
  deferred from this tier.
- Recipes are taught by scroll items that drop in the raid. Learning is
  per character: until a second scroll drops, one crafter can be the only
  person on the realm who can make the item.
- Learning a recipe requires a minimum skill in its craft: 100 for the epic
  recipes, 125 for the legendary hammer.
- Core reagent costs: 3 per enchant application, 6 per epic gear craft, 15
  for the hammer. The core is never discounted (see The discount exemption).
- Crafted epic gear is item level 37, two above the dropped tier, so the
  crafted piece is a genuine chase upgrade and not a sidegrade: the point of
  the whole arm is to make crafting worth organizing a raid around.
- The hammer is a level 39 two-handed weapon by item-level derivation,
  soulbound, and reached through a quest chain: it must be self-crafted.

## Mechanics

### Recipe scrolls: the drop-taught learn path

The learn machinery largely exists. PlayerMeta.knownRecipes persists per
character, ProfessionRecipeRecord.acquisition gates recipes behind a learn
step (empty or absent means grandfathered, known to everyone), and
acquireRecipe (src/sim/professions/crafting.ts) validates and grants, with a
'drop' source already in its union that has no caller today. This tier is that
caller.

New machinery, in order:

- A teachRecipe ItemUse variant carrying the recipe id, handled in the
  src/sim/items.ts use path: it calls acquireRecipe with the 'drop' source,
  consumes the scroll on success, and denies WITHOUT consuming on every other
  outcome (already known, below the learn floor), so a misclick or an
  unqualified winner never wastes the drop.
- The learn floor reuses the recipe's own skillReq through the same tier rule
  the trainer path already applies (canTrainRecipe in
  src/sim/professions/training.ts: the learner's tier in the craft must reach
  the recipe's tier). The trainer and scroll paths stay consistent by
  construction, and no new content field is needed.
- There is deliberately NO craft-side admission gate. Craft skills are
  additive counters that never decrease, so anyone who knows a recipe met the
  floor when they learned it; resolveCraft's settled no-admission doctrine
  stays untouched.
- The crafting window hides drop-acquired recipes until they are learned
  (trainer recipes keep showing as trainable). Discovery is part of the
  design: the realm learns the recipe exists when its crafter does.

The archetype system carries the commitment story: ceiling rules mean only a
character's archetype majors realistically climb past skill 50, so the skill
100 floor quietly reads as "one of this character's two committed crafts."
That is what turns a scroll drop from a key item into a profession identity.

Scrolls are tradeable. On a small realm a pure-RNG rare drop can strand: the
winner may not be qualified or may stop playing. Tradeable scrolls let the
drop migrate to whoever wants it, and a slow deterministic second source (the
tier quartermaster selling scrolls for a large mark price) acts as the pity
valve. Rates and the vendor price are implementation-time tuning.

### Enchanting formulas

Enchanting today is always-known by a deliberate v1 scope rule (the header of
src/sim/professions/enchanting.ts): everything shipped so far is the craft's
commons, and commons are free. The raid formula is the first non-common, so
the gate arrives with it:

- EnchantDef (src/sim/content/enchants.ts) gains an optional acquisition
  list with the same grandfather-if-absent semantics isRecipeKnown uses.
  Every shipped enchant stays exactly as free as it is today.
- applyEnchant checks the gate on both the bagged and the worn arm, denying
  with a dedicated formula_not_learned reason.
- The formula scroll teaches through the same scroll path, with the floor
  checked against craftSkills.enchanting. The apply arms are enchanting's
  primary teacher (dust-tier applies gray out at 75; shard-tier Greater
  applies teach to the cap), so the climb to 100 is real but reachable.

The raid enchant is a proc enchant (the classic crusader identity: an on-hit
combat proc, not a flat stat line). Proc enchants need one new seam: the item
instance payload already records the applied enchant id (the same_enchant
replace check compares it), so combat resolves the proc from the equipped
weapon's enchant id through the def table, extending the existing
on-action proc seam in src/sim/combat/equip_procs.ts. No payload or wire
change. This is the single deliberate machinery investment of the tier and is
reusable for every future proc enchant.

### The discount exemption

Every crafter eligible to learn a raid recipe is specialized in that craft by
construction: the learn floor (100) sits above the specialization threshold
(PERK_THRESHOLDS in src/sim/content/professions.ts). Left alone, the
specialization material discount would silently reprice the core costs for
literally every eligible crafter (floored 20 percent off turns 3/6/15 into
2/4/12), and nobody would ever pay list price.

Fix: the recipe reagent record gains a per-reagent discount-exempt flag, set
on the core reagent in every raid recipe. The quantity path in
src/sim/professions/crafting.ts skips every quantity reduction for a flagged
reagent: the specialization discount, the self-signed reduction, and the Jack
of All Trades discount. The discounts keep applying to the ordinary gathering
materials, which is where those perks belong. Authored core numbers are the
real economy, for everyone, forever.

## The core reagent

One epic reagent (the classic molten-core shape; name pending the IP screen)
with two drop arms:

- Guaranteed per boss kill: 1 to 2 from each of the two bosses.
- A lesser random drop from raid trash, tuned so a full clear expects 1 to 2
  beyond the bosses.

A full clear therefore yields roughly 4 to 6 cores, and full clears (not boss
rushes) are the optimal farm. Costs against that income:

| Use | Cores |
|---|---|
| Enchant, per application | 3 |
| Epic gear piece | 6 |
| Legendary hammer | 15 |

The 1:2:5 ratio keeps the enchant repeatable across weapon upgrades while the
hammer stays a raid-level funneling decision (roughly three full clears of the
whole raid's core income, on top of its quest chain). Outfitting a ten-person
roster (ten gear pieces, ten enchant applications, one hammer) is on the
order of 105 cores, months of weekly clears: fast enough that the first
crafted epics appear in the opening lockouts, long enough that the core never
goes worthless mid-tier. The core is an ordinary tradeable material.

## The five outputs

The new tier sets are five pieces with 2 and 4 piece breakpoints, so every
spec has one free set slot by design. The three armor crafts each target a
DIFFERENT set slot per armor class, so the crafted piece is the deliberate
fifth-slot swap: it composes with 4pc instead of competing with it.

| Craft | Output | Notes |
|---|---|---|
| Armorcrafting | epic mail helm, item level 37 | mail wearers swap helm |
| Leatherworking | epic leather legs, item level 37 | leather wearers swap legs |
| Tailoring | epic robe, item level 37 | cloth wearers swap chest |
| Enchanting | proc weapon enchant | the tier's weapon enchant ceiling |
| Weaponcrafting | legendary two-hand hammer, item level 39 | quest chain, soulbound |

Stat rules:

- Every piece is budget-true through the same item_budget derivation the rest
  of the catalog uses, at item level 37: the crafted edge over the dropped
  alternative in the same slot is a real two-level budget step, on top of a
  secondary profile tuned for the wearer's role.
- No crafted piece carries hit. The hit program in the loot plan is settled
  and crafted carriers would reopen it.
- The robe is where the spellPower and healPower affix debut does the work;
  whether the healer line is a second robe or a hybrid line is decided at
  authoring.
- Item levels are derived, not authored. A crafted item's source level is its
  recipe's own level field, through the recipe arm of the source index in
  src/sim/item_level.ts (that arm carries no raid bonus), plus the quality
  bonus (QUALITY_ILVL_BONUS in src/sim/item_budget.ts). The epic recipes are
  authored at level 31 (31 plus the epic bonus is 37) and the hammer recipe
  at level 29 (29 plus the legendary bonus is 39), so both numbers are plain
  content edits with no new registration machinery. The hammer stays one
  quality rung and two item levels above the crafted epics, and its proc
  rides the existing legendary weapon proc seam.

The hammer chain: the starter reagent drops from Varkhul, Forgefather of the
Last Flame (the forge boss starts the forging quest), the chain runs collect
objectives through the raid, and the finale is a craft objective (the
QuestObjective 'craft' type in src/sim/types.ts) at the forge at skill 125.
The output is minted soulbound: the self-crafted rule is the point of the
chain.

## Gathering materials

Every recipe also consumes high-tier gathering materials, pulling the
gathering professions into the raid economy (the second half of the
originating direction). The shape, quantities at authoring time:

- The fine grades of the tier 3 materials (fine_thorium_ore,
  fine_elderwood_log, fine_sunpetal_herb: the grades that only drop when the
  gatherer's tool outclasses the node, src/sim/professions/material_grades.ts).
- Pristine hides (the rare signed corpse-harvest specimens) for
  leatherworking.
- Top cloth for tailoring, arcane shards for the enchant formula.

These ordinary materials DO keep the specialization and self-signed
discounts, so a crafter who gathers their own materials is still rewarded.

## Binding and the social loop

Crafted outputs leave the crafter unbound and flow through the existing
commission loop (the Maker's Bond: commissioned crafts bind on first trade,
delivered face to face), which is the intended channel for the one qualified
crafter serving the realm. The hammer is the exception: soulbound at mint.
Scrolls are tradeable, as above.

## Implementation work items

Code, each test-first:

1. teachRecipe ItemUse variant plus the use-path arm (learn floor, 'drop'
   acquire, deny-without-consume).
2. EnchantDef acquisition gate plus the applyEnchant denial on both arms.
3. The enchant proc seam extending src/sim/combat/equip_procs.ts.
4. The per-reagent discount-exempt flag in the crafting quantity path.
5. Crafting window: hide unlearned drop recipes.

Content, on this branch after the loot tables are re-cut:

6. The core reagent item, the four epic recipes plus outputs, the enchant
   formula, the five scrolls, the hammer quest chain and item, loot table
   wiring (boss guarantees plus the trash arm), and the quartermaster pity
   rows.

Obligations that ride every content item (the root new-content rules): item
art, i18n names, Reliquary pages for the unique outputs, Book of Deeds
records, wiki regen, the recipe economy invariant (no recipe vendors above
its input value, tests/recipe_economy.test.ts), and the shipped-ids pin.

## Open questions

- Exact scroll drop rates per boss and the quartermaster pity price.
- Per-boss core counts (1 vs 2) and the trash rate once trash density is
  final.
- One robe or two (healer line).
- A leather tank-legs variant for the bear, or one agility piece.
- Names for the core, the scrolls, the enchant, and the hammer: all behind
  the IP screen obligation before art.
