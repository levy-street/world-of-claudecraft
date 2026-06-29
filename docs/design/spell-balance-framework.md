# Spell & ability balance framework

A repeatable, sim-driven way to answer "is this spell pulling its weight?" and to
keep the kit balanced as Spell Power, haste, and content change. Two layers:

| Layer | Tool | What it gives you |
|---|---|---|
| Analytical | `scripts/balance_report.mjs` | Fast per-spell metrics (spamDPS, dps/mana, effCast) for every caster spell, with class-median outlier flags. No sim needed. |
| Empirical | `scripts/dummy_sim.mjs` | The REAL `Sim` driven against an immortal, pinned, passive **target dummy** (300s, infinite mana). Measures actual DPS per nuke (spam) and per class (priority rotation). Validates the analytical model. |

Run them:

```
npx tsx scripts/balance_report.mjs        # analytical table, all caster classes
npx tsx scripts/dummy_sim.mjs             # target-dummy DPS, all classes
npx tsx scripts/dummy_sim.mjs mage        # one class
```

Both run a level-`MAX_LEVEL` reference caster so Spell Power and crit are realistic;
they reuse the exact combat coefficients (`src/sim/spell_scaling.ts`) so the numbers
match what a real fight does.

## The metrics

- **spamDPS** - damage per second if you cast ONLY this spell, respecting cast time,
  GCD, cooldown, crit, and Spell Power (rider DoTs kept up). The single best "is
  this nuke worth a global cooldown" number. Note: a *pure* DoT spammed is ~0 (each
  recast resets its tick) - DoTs are valued by the rotation, not by spam.
- **dps/mana** - sustain / efficiency.
- **rotation DPS** - real single-target throughput: keep DoTs up, then spam the best
  castable nuke. The class-parity number.

## The balancing rules

1. **Proportionality.** A nuke's base damage should be roughly proportional to its
   cast time, so every nuke's spamDPS is comparable. A spell that does *less* DPS
   than a shorter-cast peer is a trap nobody casts. (Real classic-era spell math:
   damage scales with cast time; this is also why the Spell Power coefficient is
   `castTime / 3.5`.)
2. **Burst premium.** A long, interruptible, mana-hungry cast may sit a little above
   the filler's spamDPS (a reward for committing) - that is its niche.
3. **Roles, not strict dominance.** Equal spamDPS is fine; differentiate by range,
   school, instant-cast, DoT, or AoE. No spell should be strictly better than
   another of the same role.
4. **Class parity.** Rotation DPS should sit in a band across the damage classes.
   `tests/spell_balance.test.ts` pins rules 1 and 3 as a regression guard.

## Findings (level 20, current tuning)

Target-dummy single-target ROTATION DPS:

| class | rotation DPS |
|---|---|
| warlock | ~48 (multi-DoT stacking) |
| druid | ~41 (after Starfire fix) |
| shaman | ~38 |
| mage | ~36-46 (Frostbolt filler to Pyroblast burst) |
| priest | ~32 (low; shadow spec especially) |

**Fixed in this pass (clear proportionality outliers):**

- **Pyroblast** 75-100 -> **170-225** (+ DoT 24 -> 48). A 6s cast was doing 24.8
  spamDPS vs Frostbolt's 41 - strictly worse than the 2.5s filler. Now 46.3: the
  mage's hardest hit, a small premium over the filler for the long cast.
- **Starfire** 60-74 -> **80-112**. A 3s cast doing 31.2 vs Wrath's (shorter) 41.7.
  Now 40.8, on par with Wrath; lifts the druid rotation from ~35 to ~41.

**Flagged for a follow-up design pass (need judgement, not just a number):**

- **Class parity:** warlock (~48) is well above priest (~32). Warlock's stacked
  DoTs (Corruption + Curse of Agony + Immolate) are strong; the priest kit is thin.
- **Shadow priest** is much weaker than smite/holy: Mind Flay (~21) and Mind Blast
  (~11 on an 8s CD) trail Smite (~38). Shadow needs its filler brought up.
- **Shaman** has only one spammable nuke (Lightning Bolt); the shock line is all on
  a shared cooldown, so its rotation is one-button.

Re-run the two scripts after any damage/coefficient change to re-check the table.
