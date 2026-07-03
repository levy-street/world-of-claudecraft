# Talents 2.0: The Fun Pass

Status: DESIGN COMPLETE, ready for codex build waves. Owner directive: cut
every deviation-compromise, rebuild on existing primitives only, add procs,
aggregate the most fun mechanics from every WoW era. Grounded in two research
sweeps: community-beloved talents per class (all expansions) and the
mechanic-pattern analysis of WHY they are fun (both archived in the session
transcripts; key findings inlined below).

## Part 1: The rules

1. NO DEVIATIONS SHIP. If an option's fantasy cannot be expressed with the
   current primitive vocabulary, the option is cut and replaced by one that
   can, not approximated. (An "Ice Block" that lets you act under a bubble is
   not Ice Block; it is a lie with an icon.)
2. Every row still changes an in-combat decision; at most one plain-strong
   passive per row.
3. Procs are the backbone: anticipation -> jackpot -> payoff windows. The
   streak/charge machinery exists; spread it.
4. Healer and tank rows get the same fun budget as DPS rows.
5. Numbers stay sweep-checked (scripts/row_build_sweep.mjs after content).

## Part 2: The kill-list (deviation-compromises to cut or upgrade)

| Shipped compromise | Why it fails the fantasy | Fun-pass action |
|---|---|---|
| Ice Block = big absorb, can still act | Immunity fantasy gone | CUT. Replace with Cold Snap: clearCooldowns on frost spells (native, tempo jackpot) |
| Divine Shield = big absorb | Same | CUT. Replace with a Lay-on-Hands-style emergency self-heal + short cast_shield window (native post-feedback-pass) |
| Cloak of Shadows = flat absorb | Anti-magic identity gone | CUT. Replace with a proc: dodging/being missed grants an empower charge (native) or short cast_shield |
| Bestial Wrath = self AP buff | The PET should enrage | CUT unless pet-buff plumbing is trivial; else replace with an on-kill proc (Frenzy: kills reset Concussive/grant haste charge) |
| Rallying Cry = ally AP | Was party max HP | Keep as ally AP but RENAME to match (Inspiring Cry); the mechanic is native and fine, the name lied |
| Metamorphosis = armor/AP buff | No form, no tint | UPGRADE: real caster-form aura kind + demon render tint (machinery exists: form_shadow precedent) |
| Bladestorm/Avatar missing root immunity | Momentum fantasy dented | Keep; acceptable. Revisit only if a root-immunity aura kind ever lands |
| Multi-Shot / Chain Lightning / Holy Wrath = radius AoE, uncapped | Mechanically native, text lied | KEEP mechanic; fix descriptions to say what they do |
| Feign Death -> stats passive | Already cut honestly | Replace passive with a FUN native option from research |
| Mend Pet = friendly HoT | Close enough | Keep |
| Innervate/Evocation/Shamanistic Rage instant restores | Fine; tooltips now truthful | Keep |

## Part 3: The primitive vocabulary (what "existing" means)

Everything below is live on the branch (including the owner-feedback pass):
- Empower charges: next_cast_instant / next_cast_free / next_attack_crit.
- Streak procs: consecutive-crit tracking (Hot Streak pattern), reusable for
  any "X in a row" trigger.
- consumeAura: eat a dot/hot for burst/heal (Conflagrate/Swiftmend pattern).
- Leech dots (leechPct), addEffects riders (bolt-on dots/roots to any spell).
- vs-rooted conditionals (Ice Lance/Shatter), execute thresholds (Execute/
  Hammer of Wrath gate).
- Aura kinds: buff_spellcrit, buff_spellhaste, buff_spelldmg, cast_shield
  (uninterruptible), buff_haste (attack speed mult), buff_ap/armor/dodge/
  spellpower, thorns, absorbs, hots, dots, forms (+ render tints).
- Movement: swept teleports (blinkForward/repositionToAim), charges,
  cast-while-moving.
- AoE: aoeDamage/aoeHeal/aoeRoot/aoeFear (fleeing, DR'd)/aoeAllyAttackPower/
  aoeAllyHaste; ground-targeting with reticle + impact ring; channels with
  per-tick aoe damage or ally healing.
- Control: interrupts + school lockouts (consent + DR), stuns/incapacitates/
  roots/silence (DR'd), slows.
- Utility: clearCooldowns (Preparation pattern), gainResource, facing
  requirements, threat mods.

## Part 4: Per-class fun designs (aggregated from research)

Design rule refined by the research: DETERMINISTIC PSEUDO-PROCS over rng
chances wherever possible (every Nth tick/hit instead of X% chance): the
jackpot feel survives, parity discipline stays trivial. Three tiny
extensions unlock most of the list, all reusing the Hot Streak engine:
- [streak]: parameterize the streak counter (trigger: spell crit | melee hit
  | dot tick; count N; reward: empower charges or a timed buff), AND expose
  the partial state as a visible self-aura (the 'Heating Up' principle: the
  two-moment structure of anticipation THEN jackpot is what made Hot Streak
  the most-cited proc in WoW history; a hidden counter wastes half the fun).
  Maelstrom Weapon, Art of War, Lava Surge, Overpower all become content.
- [on-kill]: a kill-triggered reward hook at handleDeath (clearCooldowns or
  gainResource or an empower charge). Kill Shot resets, Marked for Death,
  Drain Soul shards.
- [consume-self]: consumeAura pointed at the caster's own aura (Fulmination
  eating Lightning Shield stacks).
- [bounce]: an auto-bouncing heal: heal the target, then transfer to the
  nearest injured friendly within range at a diminishing ratio, N jumps.
  The research prices this as one transfer algorithm + one proximity check
  (friendliesInRadius already exists): Chain Heal and Prayer of Mending both
  come back from the cut list on this one small extension.

### Warrior (Execute window exists; lean into momentum)
- Sudden Death [streak]: every 3rd melee hit grants a charge letting Execute
  ignore its health threshold once. (Top-2 mechanic, native + streak.)
- Sweeping Strikes: CUT (cleave-copy not native). Replace: Colossus Smash
  [native]: addEffects vulnerability debuff (spellvuln/vulnerability aura
  kind exists) opening a personal burst window.
- Rampage loop [native]: Bloodrage rework: killing blows refund rage
  [on-kill] and extend Berserker Rage.

### Paladin (Holy Power is too big; take Art of War + Wings instead)
- Art of War [streak]: every 2nd melee crit makes the next Holy Wrath or
  Exorcism instant and free (empower charges).
- Avenging Wrath already real; ADD the healing half via buff_spelldmg +
  healPct-style aura rider once the new aura kinds land.
- Word of Glory [native]: finisher-style self/ally heal spending combo-like
  resource: paladins lack combo points: express as consumeAura on own
  seal? FLAG: needs design; fallback: strong instant heal on 20s cd.

### Hunter (Kill Shot chain is the star)
- Kill Shot [native + on-kill]: execute shot (threshold gate exists) whose
  cooldown resets when the target dies [on-kill]. Replaces the Feign Death
  placeholder passive.
- Lock and Load [streak, deterministic]: every 4th Serpent Sting tick makes
  the next Arcane Shot free and doubled (addEffects + empower charge).
- Barrage-style channel [native]: cone channel aoeDamage (mind_sear pattern
  at range).

### Rogue (gambler + stealth identity)
- Roll the Bones [native]: spend energy to gain 1 of 6 random 20s selfBuffs
  (haste/AP/dodge/crit/leech-on-strikes/spellcrit): the ONE sanctioned rng
  proc: it is a cast-time roll, parity-safe as content.
- Shadow Dance-lite [native]: a 6s selfBuff letting Ambush/Backstab ignore
  the stealth/positional requirement (cannotBeDodged-style flag exists on
  weaponStrike; positional exemption is a def flag).
- Marked for Death [on-kill]: combo points refill when the marked target
  dies.

### Priest (SW:Death risk execute + Atonement flavor)
- Shadow Word: Death [native]: execute-gated nuke with selfDamagePctMax
  backlash when the target survives (both primitives exist; pure
  risk/reward).
- Shadowy Apparitions-lite [streak]: every 2nd Shadow Word: Pain tick fires
  a free Mind Blast-scale hit (deterministic dot-tick streak).
- Prayer of Mending [bounce]: place on an ally; when they take damage it
  heals them and bounces to the nearest injured ally, 5 jumps. The 'set and
  watch' conductor fantasy for holy priests.

### Shaman (Maelstrom Weapon is the crown jewel)
- Maelstrom Weapon [streak]: every 5th melee hit makes the next Lightning
  Bolt/Chain Lightning/Healing Wave instant and free. THE Enhancement
  identity, fully expressible with the parameterized streak.
- Fulmination [consume-self]: Earth Shock consumes your Lightning Shield
  stacks for burst scaled by charges eaten.
- Lava Surge [streak, deterministic]: every 3rd Flame Shock tick grants an
  instant-and-free next Lightning Bolt (stand-in for Lava Burst).
- Chain Heal [bounce]: heal that jumps to the 3 nearest injured allies at
  70% falloff per jump: THE restoration shaman identity, and the smart
  bounce does the spatial work.

### Mage (owner feedback pass already landing: Hot Streak, Icy Veins,
Combustion, Arcane Power)
- Arcane Blast stacking [native-ish]: FLAG: per-cast self-stacking damage
  buff (selfBuff stacking by id exists? auras refresh-by-id, not stack):
  needs stack support or express as ramping buff_spelldmg with duration
  refresh; small extension candidate.
- Frozen Orb: skip (moving zones not native). Blizzard-style ground channel
  [native] instead if a third frost row option is ever needed.

### Warlock (Backdraft + Haunt-lite)
- Backdraft [native post-pass]: Conflagrate grants buff_spellhaste for 6s
  (the Conflag -> fast Chaos Bolts rhythm, zero new machinery).
- Haunt-lite [native]: shadow bolt with a leechPct dot rider (damage
  amplification-on-return approximated by the leech heal; honest about it).
- Drain Soul [native + on-kill]: execute-gated drain (threshold + drainTick
  exist); kills during the channel refund mana [on-kill].

### Druid (Eclipse pendulum, simplified deterministic)
- Eclipse [streak variant]: casting Wrath empowers your next Starfire
  (+40%), casting Starfire empowers your next Wrath: expressible as paired
  single-charge empowers keyed by ability id: FLAG small extension
  (ability-keyed empower charge), reuses the charge engine.
- Tiger's Fury [native]: gainResource energy + buff_ap selfBuff, off-gcd.
- Omen of Clarity [streak, deterministic]: every 4th Claw/Rake makes the
  next ability free (empower charge).
- Starfall [native]: self-centered channel aoeDamage with star fx
  (bladestorm pattern, caster form compatible).

### Healer/tank fun budget (research agent 2 refines this)
- Holy Paladin/Resto: Swiftmend exists; add HoT-count payoffs: a heal that
  gains +X% per active hot on the target [FLAG: needs hot-count read: tiny].
- Disc: leech-flavored damage (Atonement-lite via leechPct on smite riders).
- Tanks: thorns windows (Holy Shield pattern exists), taunt-swap tools, and
  an active-mitigation rhythm via short selfBuff armor windows on a
  Shield-Block-style 8s cadence.


## Part 5: Build plan

One codex wave per 3 classes off this doc, the standard review-fix-commit
loop, sweep re-run, play-branch rebuild.

## Part 6: Synthesis principles (from the mechanic-pattern research)

The 8 archetypes ranked by fun-per-implementation-complexity, all either
native or one tiny extension away in this codebase:
1. Two-state proc chain (partial state visible, then jackpot) -> [streak].
2. Health-threshold phase gate (+ on-kill reset variant) -> native + [on-kill].
3. Consumption mechanic -> consumeAura, native.
4. Charge-based active defense with VISIBLE feedback -> selfBuff windows,
   native; the feedback (numbers drop) is the design, not decoration.
5. Auto-bouncing chain effect -> [bounce].
6. Stack/ramp with spend-now-vs-wait -> combo points + [streak] counters.
7. Movement-as-attack -> swept teleports/charge + addEffects, native.
8. Transformation window -> forms + tints + buff riders, native.

Cross-cutting rules for every option we build:
- Feedback immediacy: when an empower charge is up, the payoff button must
  GLOW (action-bar highlight keyed to the charge auras): one UI feature that
  multiplies the perceived value of every proc in the game.
- Two-moment structure beats one-moment: visible partial states everywhere.
- Triggers ride existing behavior (ticks, swings, crits): no new inputs.
- Every stacking mechanic keeps a spend-now-vs-wait decision.
- Phase shifts (execute windows, transformations) give every fight an arc.

## Part 7: Build order
1. Codex wave F1: the three tiny extensions ([streak] parameterization with
   visible partial-state auras, [on-kill] hook, [consume-self]) + [bounce] +
   the action-button glow, content-unused, parity-clean, tests first.
2. Codex wave F2: warrior/paladin/hunter fun options per Part 4 (cut list
   applied).
3. Codex wave F3: rogue/priest/shaman.
4. Codex wave F4: mage/warlock/druid (mage already partly done by the
   owner-feedback pass).
5. Sweep re-run + play-branch rebuild + owner playtest.
