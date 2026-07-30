# Choice-row quality pass: priest, shaman, paladin above the warrior bar

Status: design locked, implementation in progress on `feature/talents-2-0-flip`.
Companion work (separate lanes): engine buffPct fixes + tooltip alignment; the
dead-at-unlock guard test + learn-level moves for the other five classes.

## Why

The 8-class row review (2026-07-07, warrior bar = the live-playtested #1609 set)
scored priest (11 of 18), shaman (10), and paladin (9) options as invisible
passives, plus dead picks. The bar: options should change BEHAVIOR (rhythms,
on-event triggers, resource weaves) and rows should pit a passive against two
actives. This pass rebuilds the flagged options of the three worst classes and
adds the shared engine those mechanics need, so later passes on the remaining
classes are data-only.

## The proc engine (the reusable piece)

One new sim module, `src/sim/combat/talent_procs.ts`, behind the SimContext
seam. A row option may now carry `proc: ProcDef` in its TalentEffect:

- Triggers: `castNth` (every Nth cast matching an ability filter), `spellCrit`
  (filtered), `shieldConsumed` (an absorb the player applied is fully eaten),
  `hotExpired` (a HoT the player applied runs its full duration), `bigHitTaken`
  (a hit above a max-hp fraction, with internal cooldown), `meleeSwingWhile`
  (auto-attack lands while a condition aura such as an imbue or seal is up).
- Responses: `empowerNext` (grants a next-cast aura: free / instant / amp, with
  an ability filter), `cooldownRefund` (seconds or full reset on one ability),
  `resource` (flat refund), `heal` / `absorb` (on the trigger's subject), and
  `echo` (a watcher aura that fires a heal if the subject drops below a health
  fraction inside a window).

Counters and internal-cooldown timers are transient combat state on the player
entity (never persisted; deterministic, no rng). Trigger hook points are single
delegating lines in casting_lifecycle (cast completion), damage.ts (absorb
break, big-hit, cheat-death), auras.ts (HoT expiry), and the crit path in
applyHeal/dealDamage.

Four bespoke arms ride the same change (not generalizable into ProcDef):

- `dmgPctVsDotted` on AbilityModEffect: bonus damage when the caster's DoT is
  on the target (priest Twisted Faith).
- Channel ticks extending a DoT (`extendsDot`, Mind Flay feeding Shadow Word:
  Pain), capped.
- `consumesDot` on an ability: detonates the caster's named DoT remaining
  damage instantly (shaman Earth Shock eating Flame Shock).
- `cheatDeath` global with a long internal cooldown: a killing blow leaves the
  player at 1 hp (paladin Deathless Ardor).

## Redesigned rows

Option ids and names are kept wherever the concept survives (their locale name
overrides stay valid); only effects and descriptions change. KEEP means
unchanged. All numbers are level-20 baselines, PTR-tunable.

### Priest

| Row | Option | New behavior |
|---|---|---|
| 5 | Searing Light | Every third Smite makes your next healing spell free (8 sec window). |
| 5 | Improved Lingering Grace | A Renew that runs its full duration hardens into a 40-damage absorb. |
| 5 | Twisted Faith | Mind Blast deals +25% to targets afflicted by your Shadow Word: Pain. |
| 8 | Silent Treatment / Terror Shriek | KEEP (two actives). |
| 8 | Improved Shield | A fully consumed Power Word: Shield erupts, healing its owner 45. |
| 11 | Stilled Mind / Leeching Dirge | KEEP. |
| 11 | Nocturns | Every third healing spell halves the cost of your next heal. |
| 14 | Mind Melt | KEEP (the row's passive). |
| 14 | Greater Heal | Heal leaves an echo for 10 sec: if the target drops below 35% health, they are instantly healed 60. |
| 14 | Pain and Suffering | Mind Flay ticks extend your Shadow Word: Pain by 1 sec each (max +6). |
| 17 | Last Prayer | KEEP. |
| 17 | Improved Litany of Resolve | KEEP (party passive third). |
| 17 | Inner Fire | Taking a hit above 15% of your max health grants a 70 absorb (20 sec internal cooldown). |
| 20 | Choirmend / Thoughtburn | KEEP. |
| 20 | Blessed Recovery | Your critical heals also shield the target for 50. |

### Shaman

| Row | Option | New behavior |
|---|---|---|
| 5 | Fault Line | Every third Lightning Bolt makes your next shock free. |
| 5 | Improved Thunder Ward | When Thunder Ward reflects, your next Lightning Bolt is instant (learn level moves 8 -> 5). |
| 5 | Imbue Mastery | KEEP (the row's passive). |
| 8 | Improved Earthen Jolt | KEEP (interrupt). |
| 8 | Frost Bind | Root 1 sec -> 2 sec; frost_shock learn level moves 14 -> 8. |
| 8 | Shock Efficiency | KEEP (passive third). |
| 11 | Springwell | KEEP. |
| 11 | Guiding Spirits | Healing Wave crits make your next Healing Wave instant. |
| 11 | Elemental Attunement | KEEP (passive third). |
| 14 | Forked Lightning | KEEP. |
| 14 | Improved Cinder Jolt | Earth Shock detonates your Flame Shock, dealing its remaining damage instantly. |
| 14 | Weapon Fury | Imbued auto-attacks shave 0.5 sec off your shock cooldowns. |
| 17 | Gripping Earth / Improved Shadewolf | KEEP. |
| 17 | Elemental Warding | Taking a hit above 15% of your max health grants an 80 earthen absorb (20 sec internal cooldown). |
| 20 | War Drums | KEEP. |
| 20 | Earthen Fury | Your spell crits reset Earth Shock's cooldown and refund its cost. |
| 20 | Tidal Waves | Each Chain Heal cast makes your next Healing Wave instant (signature weave). |

### Paladin

| Row | Option | New behavior |
|---|---|---|
| 5 | Blessed Momentum | KEEP. |
| 5 | Vengeful Exorcism | Judgement resets Exorcism's cooldown; exorcism learn level moves 14 -> 5. |
| 5 | (third r5 option) | Reviewed at implementation; passive third stays if healthy. |
| 8 | Reproach / Fist of Justice | KEEP. |
| 8 | Consecrated Ground | Live at 8 (consecration learn level moves 18 -> 8), keeps the damage/cost tune. |
| 11 | Divine Wisdom | Every third healing spell makes your next Holy Light instant. |
| 11 | Greater Blessing | KEEP (passive third). |
| 14 | Swift Verdicts | KEEP. |
| 14 | Righteous Cause | Melee swings while your Seal is up shave 0.5 sec off Judgement's cooldown (replaces the half-broken passive after the engine fix). |
| 17 | Lightward | KEEP the grant; divine_shield absorb retuned 5000 -> level-scaled (roughly 2x max hp at 20). |
| 17 | Sacred Ward | Lay on Hands also shields every nearby ally for 60. |
| 17 | Deathless Ardor | Cheat death: a killing blow leaves you at 1 hp instead (3 min internal cooldown). |
| 20 | Wrathwing / Tolling Hammer | KEEP. |
| 20 | Aura Mastery | Activate: your aura's effect is doubled for 10 sec (2 min cooldown), granted as an active ability. |

## Constraints carried from the repo rules

- Determinism: no rng in any trigger or response; counters and ICDs are plain
  tick math. Parity goldens regenerate only where scenario bots use the
  changed abilities; per-frame draw counts must stay byte-identical in
  unrelated scenarios.
- i18n: option names are stable (existing locale overrides stay); changed
  descriptions are English source + regenerated tooltips; any new aura display
  name lands in sim_i18n's dictionaries and AURA_NAME_KEY in the same change.
- The dead-at-unlock guard test's priest/shaman/paladin skip-list is emptied by
  this pass; the three learn-level moves above (lightning_shield, frost_shock,
  exorcism, consecration) land with it.
- No WoW spell names for anything new; existing coined names are reused, and
  any genuinely new name goes through the NAME-MAP request-row flow.
