# Warrior: Talent Choices kit and spec decisions

Single source of truth for the warrior redesign (Talents 2.0). BOTH Claude and any other agent
(Codex, Gemini) read AND update this file. If the operator gives a new decision mid-session,
write it here in the same change so the next agent does not have to guess. Never infer a warrior
design decision from memory or from World of Warcraft; if it is not written here and not obvious,
ask the operator.

Status legend: DONE = implemented and green on `integration`; PENDING = not yet built.

## Specs
- Arms (dps): two-handed, deliberate hits, bleeds. Signature `mortal_strike` ("Maiming Strike").
  Mastery "Sharpened Blades" (+10% melee ability damage).
- Fury (dps): dual-wield frenzy. Signature `bloodthirst` ("Bloodletting"). Mastery "Bloodletter"
  (+5% crit, +10 attack power).
- Protection (tank): active mitigation + control. Signature `shield_slam` ("Shieldcrack").
  Mastery "Recompense" (+30% threat, +10% armor).

## Warrior offhand and dual-wield identity (LOCKED 2026-07-09)
- See [offhand-dual-wield.md](C:/Users/joseg/Desktop/world-of-claudecraft/docs/prd/offhand-dual-wield.md)
  for the cross-system equipment/combat spec.
- Warrior spec identities for that system are locked as:
  - Arms: two-handed, no dual wield in the first pass
  - Fury: one-handed mainhand + one-handed offhand, dual wield enabled
  - Protection: one-handed mainhand + shield offhand, no dual wield in the first pass
- The first offhand pass keeps warrior weapon abilities on `mainhand`; offhand weapon gameplay is
  auto-attack only until a later change says otherwise.
- Protection's shield block follows the cross-system spec in
  [offhand-dual-wield.md](C:/Users/joseg/Desktop/world-of-claudecraft/docs/prd/offhand-dual-wield.md):
  passive Classic-style frontal melee mitigation, no visible block meter or HUD resource.

## Base-kit changes (DONE)
- `battle_shout` "Iron Bellow": GROUP attack-power buff (caster + friendlies within 40 yd),
  duration 1 HOUR, ranks 20/35/50 AP, cost 0 (free), learnLevel 7. Stays in the `warrior_shout`
  group, but as of Batch 2026-07-08 it is the sole member (Bolstering Cry left the group), so the two
  shouts now COEXIST.
- `bloodthirst` "Bloodletting" (es "Sangria"): Fury signature. Instant weapon attack that heals the
  caster 3% of max health AND generates 10 rage. Fury has NO `bloodrage`: Bloodletting is its
  generator instead (see gating). While `furious_mending` is active its self-heal is 20% (below).
- `mortal_strike` "Maiming Strike": Arms signature. Adds a 50% healing-reduction debuff on the
  target for 10 sec (the `mortal_wound` aura).
- `rend` "Deep Gash": learnLevel 5.
- `whirlwind` "Bladed Gyre" (Fury, talent-granted) AREA ECHO: after casting it, the caster's next
  2 single-target damaging abilities also strike enemies near their target (aura "Bladed Echo",
  2 charges).

## Spec gating (`AbilityDef.specs`; absent = every spec keeps it)
A player with no spec chosen keeps the full kit; once a spec is picked, abilities reserved for
other specs drop out. Talent/row grants are never gated (their tree is already spec-scoped).

| Ability (id) | Specs that keep it |
|---|---|
| `defensive_stance` (Guarded Stance) | arms, prot |
| `sunder_armor` (Armor Shear) | arms, prot (but its HIGH threat applies ONLY for prot, see below) |
| `commanding_shout` (Bolstering Cry) | prot |
| `demoralizing_shout` (Direhowl) | prot |
| `rend` (Deep Gash) | arms |
| `overpower` (Redhand) | arms |
| `slam` (Brute Swing) | arms, prot |
| `cleave` (Reaping Arc, es "Arco Segador") | arms (removed from prot 2026-07-08; prot uses Revenge) |
| `heroic_strike` (Reaver Strike, es "Golpe del Saqueador") | ungated BUT `excludeSpecs: ['prot']` (prot uses Revenge instead) |
| `bloodrage` (Blood Toll) | arms, prot (Fury uses Bloodletting instead) |

## New abilities

### Fury (DONE)
- `raging_gale` "Twinstrike": lvl 10, free, 2 charges (8s recharge), two 60%-weapon strikes + 8 rage.
- `furious_mending` "Furious Mending" (Regeneracion Enfurecida): lvl 14. For 10s you take 20% reduced
  damage AND, while it is active, your `bloodthirst` (Sangria) self-heal becomes 20% of max health
  (instead of 3%). It is NOT a flat 20% HoT (operator correction 2026-07-07): the healing is
  delivered by casting Bloodletting under the buff.
- `red_harvest` "Red Harvest": lvl 16, 80 rage, three full weapon strikes.
- `emboldening_roar` "Emboldening Roar" (es RENAMED to "Rugido Envalentonador" to avoid colliding
  with `commanding_shout`, whose es name stays "Grito Alentador"): FURY-only, lvl 18. Caster + allies
  within 40 yd: their next 3 ability casts are guaranteed crits. (Was briefly moved to Prot on
  2026-07-07 then moved back to Fury same day.)

## Spec must be COMMITTED for the kit to unlock (DONE 2026-07-07)
Spec-gating keys off the COMMITTED spec (`mods.spec`); default is NO spec. RULE (implemented):
a spec-restricted ability shows ONLY when the committed spec matches, so a NO-SPEC warrior sees
only the ungated shared base kit and gains a spec's exclusives by committing that spec. This is why
a specless warrior briefly "saw everything" (the old rule was "no spec = full kit"); fixed.
Committing a spec today: talents panel (N) -> pick a spec card -> Save a loadout (level 10+
required; `saveTalentLoadout` sets `meta.talents` + recomputes known). A simpler one-click spec
commit is still open, but deferred to ryze's #1614 engine (that UX is its territory).

### Arms (PENDING as of this writing; being built)
- `breachmaker` "Breachmaker" (Aplastar Coloso): lvl 16, 10 rage, 45s cd. Weapon strike + marks the
  target so ONLY THE CASTER deals +20% damage to it for 8 sec. PERSONAL, not raid-wide (aura
  `vuln_source`, sourceId = caster). Operator-confirmed 2026-07-07: personal, level 16.
- `measured_fury` "Measured Fury" (Intrepidez): lvl 12, PASSIVE (`AbilityDef.passive`). Your
  abilities cost 10% less rage. Not castable.

### Protection (DONE)
- `raised_guard` "Raised Guard": lvl 10, 15 rage, 12s cd, 50% PHYSICAL-only damage reduction for 6s.
- `iron_resolve` "Iron Resolve": lvl 14, spends ALL current rage (min 20), absorbs (rage x 4) for 10s.
- `faultline` "Faultline": lvl 16, 15 rage, 30s cd, frontal AoE damage + 3s stun.
- `defiant_bellow` "Defiant Bellow": lvl 18, free, 60s cd, area taunt (10 yd).
- (emboldening_roar lives in Fury, see the Fury section: the operator moved it back to Fury
  2026-07-07 late.)

## Spec-conditional and UI decisions (operator, 2026-07-07)
- `sunder_armor` (Armor Shear) threat: the HIGH tank threat applies ONLY when the caster's committed
  spec is Protection. For Arms it is a plain armor-shred with normal threat (no tank threat bonus).
- Choosing a spec must be a STAGED edit that requires an explicit Save, like talent points; it must
  NOT apply the instant it is clicked. STATUS: spec selection is ALREADY staged in our engine
  (`talents_window.ts` `setSpec` mutates the staged allocation, committed only on loadout save).
- Choice-row picks should ALSO require an explicit Save instead of applying instantly (they are
  respec-free/instant today via `pickRow` -> `sim.pickRowTalent`). DEFERRED to the ryze #1614
  consolidation on purpose: making row picks staged means folding them into the build/loadout system,
  which ryze's engine will own, so it is built once there rather than twice. Raise it as a UX
  preference for the consolidated engine.

## Batch 2026-07-08 (operator)
- `commanding_shout` (Bolstering Cry, es "Grito Alentador", the STAMINA shout, prot-only): cost 10 -> 0,
  duration 120s -> 3600s (1 hour), and REMOVE `exclusiveGroup: 'warrior_shout'` so it coexists with
  Iron Bellow (the AP shout). Stays a self buff unless the operator asks for group.
- NEW `revenge` "Revenge" (es "Revancha"), PROT-only, REPLACES `heroic_strike` for prot (via the new
  `AbilityDef.excludeSpecs: ['prot']` on heroic_strike + `specs: ['prot']` on revenge). Frontal-arc AoE
  physical hit to all enemies in front; reduced damage above 5 targets (soft cap: total caps at 5x per
  target); and a defensive proc: when the warrior DODGES or PARRIES an incoming attack, a chance
  (default 30%) that the next Revenge costs no rage. Chosen defaults to tune: learnLevel 1, cost 15,
  no cooldown (GCD), radius 8, damage ~ cleave-tier, proc 30%. New mechanics: `excludeSpecs` field,
  aoeDamage `softCap`, and a dodge/parry -> free-cost proc (reuses the next_cast_free machinery).
- `cleave` (Reaping Arc): removed from prot -> `specs: ['arms']`.
- `raised_guard` (Raised Guard / Bloquear con Escudo): add `maxCharges: 2`.

## Rage economy (balance, 2026-07-08, operator-approved)
A deterministic bench (level 20, same weapon, 60s vs a dummy that hits back, greedy rotation)
showed the base warrior was badly rage-starved: signatures fired 1-3x/min (cap ~10), Desenfreno
(red_harvest, 80 rage) was unreachable. Fix (applied, being finalized):
- `rageFromDealing` (types.ts): the outgoing-damage rage constant 7.5 -> 18 (auto-attack rage x2.4).
  Main lever; Arms/Prot rely on auto-attack rage.
- `rageFromTaking` (types.ts): drop the *1.5 divisor (`damage / max(1, attackerLevel)`) so being hit
  gives ~1.5x rage. Helps Prot (tank rage from being hit).
- FURY = generator/spender model (operator: "las habilidades del fury dan ira; Desenfreno es el
  spender"): `bloodthirst` (Sed de Sangre) is now a GENERATOR, cost 30 -> 0 and gainResource 10 -> 12
  (plus its weapon strike + 3% heal). Twinstrike (+8) and Bladed Gyre (+5-10) also generate.
  `red_harvest` (Desenfreno) is the sole spender, cost 80 (reverted from a 55 experiment), the
  hardest hitter. Fallback if still too tight in play: lower Desenfreno's cost.
- Validated result: all three specs healthy rage (~7-8/sec); signatures fire well (mortal_strike 7,
  bloodthirst 10 as a generator, shield_slam 5); Desenfreno reaches ~4/min. DPS Fury 92 > Arms 73 >
  Prot 39. OPEN for PTR tuning: the Fury(92)/Arms(73) DPS gap (nudge Arms up if desired).

## Naming (de-brand)
New ability names must be original (not WoW). The locked rename table is `ip-refactor/NAME-MAP.md`.
Known debt: 12 abilities still ship WoW names today (pummel, heroic_leap, rallying_cry, storm_bolt,
intimidating_shout, bladestorm, victory_rush, piercing_howl, die_by_sword, recklessness, avatar,
sanguine_aura); the G0 scanner does not arm them yet. Flag to the maintainer, do not block on it.

## The row/choice engine (PENDING consolidation)
Our warrior work is built on OUR choice-row engine (`src/sim/content/talent_rows.ts` +
`warrior_rows.ts`). The maintainer (ryze) opened PR #1614 with a DIFFERENT engine covering all 9
classes (`src/sim/content/choice_rows.ts` + `choice_rows_classic.ts`). The agreed plan is to
consolidate onto ryze's #1614 as the base, with our playtested warrior tunings + mechanics ported
on top, credited to the operator. The sim MECHANICS (area echo, guaranteed-crit override,
spec-gating field, buff_dr/buff_dr_phys, vuln_source, aoe_echo, absorbSpentResource, aoeTaunt,
frontal AoE, maxCharges) live in engine-independent combat files and port cleanly; only the row
DATA must be re-expressed in ryze's `choice_rows.ts` format. A naive cherry-pick FAILS (the engines
differ); it is a manual port. Do NOT push anything until the operator has playtested.

## Handoff notes (update on every session switch)
- 2026-07-08: Batch 2026-07-08 IMPLEMENTED and green on `integration` (local only). `commanding_shout`
  is now free (cost 0), 1-hour duration, and left the `warrior_shout` group so it coexists with Iron
  Bellow. `cleave` is arms-only. `raised_guard` stores 2 charges (`maxCharges: 2`). NEW `revenge`
  "Revenge" (es "Revancha"): prot-only frontal-arc AoE (radius 8, 18-24), soft target cap
  (`aoeDamage.softCap: 5`, total held to 5x per-target above 5 enemies), and a dodge/parry -> free-cost
  proc (30%, `revenge_free` aura applied in `mobSwing`, consumed via `empower_next.ts`). Reaver Strike
  (`heroic_strike`) gained `excludeSpecs: ['prot']` (new `AbilityDef` field) so committed prot swaps it
  for Revenge; no-spec/arms/fury keep Reaver Strike. Icon, en+es+5-non-Latin i18n (ability name/desc,
  the revengeFree buff line, and the guide abilityHook), and the guide content regen are all in. Tests:
  new `tests/revenge.test.ts` + updates to spec_gating/prot_kit/battle_shout/commanding_shout. Parity
  goldens NOT re-minted here (the new prot dodge/parry rng draw + gating shifts them; operator re-mints).
- 2026-07-07: the WHOLE warrior kit is DONE and green on `integration` (local only, never pushed):
  base-kit changes, spec gating, Fury kit, Protection kit, Arms kit (Breachmaker + Measured Fury),
  and all operator tweaks (battle_shout free/lvl7, rend lvl5, slam/cleave arms+prot, demoralizing_shout
  prot, emboldening_roar Fury (moved to Prot then back to Fury; es renamed to "Rugido Envalentonador"),
  bloodthirst +10 rage, furious_mending<->bloodletting coupling,
  sunder spec-conditional threat). Parity goldens re-minted (rng draw order unchanged). Codex's earlier
  Arms commit is preserved on branch `integration-codex-arms`. The only deferred item is choice-row
  force-save (to the consolidation). NEXT: port onto ryze's #1614 engine (operator confirmed HIS warrior
  rows win, no ryze conversation needed); nothing pushed until the operator playtests + approves.
