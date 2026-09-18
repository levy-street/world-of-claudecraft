# Druid Wildfang kit pass 2: engage, control, opener

Companion to `druid-v029-class-design.md` (the Wildfang engine) and the Cat Form
mobility pass (a separate branch). This pass gives Cat Form an in-combat engage, an
out-of-stealth opener, and in-combat control. Before it, the only Cat stun
(Slinkstrike) was gated on stealth and Bruin Rush's 1 sec stun expired before a Bruin
to Cat shift could land.

## The five changes

1. **Loping Stride is baseline.** Every form shift grants 60% movement speed for 3 sec,
   once per 20 sec, with no talent check. The row 5 slot keeps its option id
   (`dru_r5_ferocity`, so saved allocations still resolve) and becomes **Longstride**
   (mechanic `druid_longstride`): 5 sec on a 12 sec cooldown. The engine reads both
   numbers from the row option's `metrics`, so the talent tooltip and the sim share one
   source. Pinned by `tests/druid_wildfang_kit.test.ts` and
   `tests/talent_tooltip_accuracy.test.ts`.
2. **Pin.** Landing Bruin Rush opens a 3 sec window: Cat Form costs 0 mana and Pins the
   Rush target (a 50% slow for 4 sec on the target that was Rushed, never the current
   target). The window is an aura on the druid (`bruin_rush_window`, kind `internal_cd`,
   value = the target id), the Colossal Might cap precedent, rather than a new Entity
   field: it rides the ordinary aura wire so the shared cost tail
   (`combat/ability_resolution.ts`) shows the free cost in BOTH worlds' tooltips, it
   expires through the aura tick, a death wipes it, the engaged pass closes it on
   leaving combat, and it adds no field to the parity trace. Slows carry no
   diminishing-returns ladder in this sim (`combat/effect_dispatch.ts` 'slow'), and Pin
   follows the same rule.
3. **Stalk moves at full speed** (stealth value 0.95 to 1.0). Rogue Duskveil keeps 0.5.
4. **Lunge**, the out-of-stealth shape of the Slinkstrike button: 12 yd gap closer,
   40 energy, 12 sec cooldown, 60% weapon damage, 1 combo point, no stun. The
   `actionReplacement` rule shape gained `absentAuraKind`; an absence-only rule is a
   MODE of the button and keeps the replacement's own cooldown key, so a restealth
   Slinkstrike is never locked behind the Lunge it followed. The strike and the combo
   point land on ARRIVAL, not at cast (review round 1: a strike billed at cast from 12
   yd read as a ranged melee hit, and a route that aborted had still hit). The cast
   starts the charge route and parks the strike on a pending marker aura
   (`lunge_pending`, the Bloodhook shape in `combat/hunter_fieldcraft.ts`); the
   route's settle hook (`combat/charge_route.ts`, one call in
   `sim.ts updateChargeMovement` shared with Bloodhook) rolls the strike on the tick
   the body arrives and awards the point on a hit, and a route that ends short (deep
   water, a cliff, a root, the target dying, the 3 sec budget) strikes nothing and
   hands the 12 sec cooldown back. The energy is spent at cast either way, the bill a
   dodged strike pays. `LUNGE_WEAPON_MULT` in `combat/druid_lunge.ts` owns the 60.
   Lunge is never learned as a second action and does not bank Old Blood.
5. **Takedown** (id `hamstring_bite`), the Cat control finisher (learn 12, 30 energy,
   20 sec cooldown): `finisherStun` 1 sec plus 1 sec per combo point (2 sec at 1 up to
   6 sec at 5), the Low Blow numbers exactly. The first cut shipped 0.5 + 0.5 per point
   (3 sec at 5); retuned on review (Furyogen, 2026-09-13): a 3 sec cap was one GCD of
   control with 2 sec left to act. It sits in the controlled-stun diminishing category
   with Concuss and Low Blow. The sim keeps from-stealth openers (Slinkstrike) on their
   own ladder, the classic rogue rule `stun_dr.ts` documents, so Takedown cannot share a
   ladder with both Slinkstrike and Concuss; the finisher it is modelled on (Low Blow)
   decided.

The form tooltips (Cat, Bruin, Fleet, Moonwing) all carry one sentence pointing at the
baseline sprint and no numbers: the numbers scale with Longstride, and a static "3 sec,
once every 20 sec" was stale for every druid who took the row. The Loping Stride buff
line and the Longstride talent tooltip carry the live numbers.

## Naming (the `src/sim/content/CLAUDE.md` originality check)

Recorded here in the same change, as the rule asks. Exact-phrase and coined-token web
searches on 2026-09-15 against the usual game wikis:

- **Longstride**: GENERIC. A plain English compound (long + stride). The nearest
  neighbours are a different token in a different medium ("Longstrider", the D&D and
  Baldur's Gate 3 speed spell) and "Long Stride" across unrelated properties (a BLEACH
  Brave Souls skill), shared vocabulary rather than a coin.
- **Pin**: GENERIC. A plain English verb for a hold; used across many unrelated games.
- **Lunge**: GENERIC. A plain English verb; a common generic skill name across genres.
- **Takedown**: GENERIC. A plain English word (the wrestling hold, and what a cat does
  to prey). No distinctive ability of that name in the same role on the WoW, GW2, FFXIV,
  ESO, RuneScape, Diablo, or PoE wikis; the WoW analogues of this finisher are Maim and
  Mighty Bash, neither of which is reused. Chosen over the first cut, **Hamstring
  Bite**: not a collision (no game ships that phrase), but "hamstring" is the word the
  repo already renamed away for the warrior snare (`hamstring` ships as Hobbling Cut,
  `docs/design/naming-audit.md`), it is a well-known snare name in the same role
  elsewhere, and a hamstring reads as a slow while this is a stun. The id stays
  `hamstring_bite` (ids are frozen); the display literal is pinned in
  `tests/originality_renames.test.ts`.
- **Lunge** and **Bruin Rush** as aura names: the engine marker auras that borrow an
  ability's name (`bruin_rush_window`, `lunge_pending`, and the `_stun` auras) are not
  `ABILITIES` keys, so `src/ui/sim_i18n.ts` resolves those names to the ability's
  localized name (`ABILITY_NAMED_AURA_IDS`), never raw English.

## Placeholders owned by other passes

- **Icons:** `lunge` and `hamstring_bite` (Takedown) ship procedural glyphs. They are parked in
  `ABILITY_ART_PENDING` (`src/ui/icons.ts`, the `ITEM_ART_PENDING` shape), which the
  painted-census guards treat as parked rather than painted; the art pass removes the
  entry when it paints them.
- **VFX:** `src/render/druid_vfx_specs.ts` carries clearly labelled placeholder specs
  for Lunge, Takedown, and Pin, registered through `ability_vfx_registry.ts`
  (never the generated gallery tables). The VFX retune replaces them.
- **Default bars:** the Cat default bar is full (12 slots), so Takedown is
  dragged from the spellbook.

## Balance

Lunge is the only DPS-touching addition, and the Wildfang probe rotation does not press
it, so the single-target probe is unchanged versus `main` (see the PR body for the
measured numbers). Nothing in this pass draws rng.
