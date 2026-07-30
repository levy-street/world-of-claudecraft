# Talents 2.0: The Fun Pass

Status: SALVAGED from PR #1348 (closed) onto the flip branch (#1614) on
2026-07-09. S1 (row engine + flip) and S2 (the 162-option content
reconciliation) SHIPPED in #1614; waves 1-3 of the row-quality program plus
the proc engine (src/sim/combat/talent_procs.ts) cover much of what Part 3
proposed, so re-verify each item against the live content before building.
Still open from this document: the S3 streak engine (the dormant noteSpellHit
seam in combat/spell_combat.ts is the intended hook), Hot Streak content,
Ice Lance as a baseline frost spell (vs-rooted machinery is live), facing
enforcement on hostile casts, and the remaining S4 defs. Original status:
DESIGN COMPLETE, ready for codex build waves. Owner directive: cut
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

## Part 3: Primitive index

Every design item below cites a primitive by ID. E = exists today (with the
exact shape and file); N = needs implementation AND a test before any
content uses it. Engine work is content-unused on landing: all parity
goldens stay byte-identical (the acceptance for every N item).

### E: existing shapes (verified against src/sim, 2026-07-03)

Talent side (src/sim/content/talents.ts):
- TalentEffect = { stats?, grant?: {ability}, ability?: AbilityModEffect[],
  global?: GlobalModEffect }
- AbilityModEffect = { ability, dmgPct, flatDmg, costPct, cooldownPct,
  castPct, buffPct, castWhileMoving, addEffects: AbilityEffect[] }
- GlobalModEffect = { meleeDmgPct, spellDmgPct, healPct, threatPct,
  critVsRooted, hotStreak }
Effect types (src/sim/types.ts, dispatch in src/sim/combat/):
  damage/directDamage, dot (supports leechPct), drainTick, aoeDamage,
  aoeHeal, aoeRoot, aoeFear, consumeAura (target dot/hot), selfBuff,
  buffTarget, weaponStrike, groundAoE, charge, blinkForward,
  clearCooldowns, gainResource, comboPoint, finisherDamage/Haste/Stun,
  interrupt, aoeAllyAttackPower, aoeAllyHaste, absorb, thorns.
Aura kinds: next_cast_instant / next_cast_free / next_attack_crit
  (empower_next.ts), buff_spellcrit / buff_spelldmg / buff_spellhaste,
  cast_shield, spellvuln, imbue, forms (+render tints), stealth, lockout.
Execute gates and selfDamagePctMax backlash exist (hammer_of_wrath,
  SW:Death shape); hostile/PvP consent via isHostileTo; DR tables.

### N: needed primitives (each = shape + hook + test, then content)

- N1 streak engine: global.streak = { trigger: 'spell_crit' | 'melee_hit'
  | 'ranged_hit' | 'dot_tick', count, reward }. reward is ONE of:
  { empower: AuraKind[], abilityFilter?: string[] } (empower charges,
  optionally consumable only by listed abilities), { resetCooldown:
  abilityId }, { allowExecuteAnyHp: true } (one gate-free Execute), or
  { bonusHit: {pct} } (a free extra hit at pct of the triggering spell).
  Generalizes spellCritStreak/noteSpellHit (spell_combat.ts); hotStreak
  becomes streak sugar with IDENTICAL observable behavior. MUST expose the
  building state as a visible self-aura at count-1 and clear it on
  proc/reset. TRAP (verified): consumeNextCastInstant/Free currently fire
  for non-physical cast-time spells only; Aimed Shot is a physical-school
  cast-time shot, so N1 must extend empower consumption to physical
  cast-time abilities behind the abilityFilter, with a test.
  Tests (tests/streak_engine.test.ts): hotStreak parity (two crits proc,
  non-crit direct resets, AoE/cant-crit paths do not touch it), building
  aura appears at count-1 and clears both ways, each reward kind fires
  once and consumes, abilityFilter blocks other consumers, physical
  cast-time consumption, streak resets on death. Goldens byte-identical.
- N2 on-kill hook: global.onKill = { resetCooldown?: abilityId,
  gainResource?: n, gainCombo?: n, empower?: AuraKind }. Hook where kill
  credit already resolves (damage.ts death path). Tests: fires for the
  killer only, respects kill-credit rules, resetCooldown observable,
  no fire on friendly/self death. Goldens byte-identical.
- N3 consume-self: consumeAura gains { self: true, auraId?: string,
  kinds?: AuraKind[], scalePerStack: pct }: eats the CASTER's own aura by
  id or kind, scales the
  ability's damage by stacks consumed. Tests: eats own aura not target's,
  scaling, no-op error path reuses hud.errors.nothingToConsume.
- N4 bounceHeal: { type: 'bounceHeal', min, max, jumps, falloffPct,
  radius }: heal primary, then nearest injured friendly within radius at
  falloff per jump, never the same target twice, deterministic order
  (nearest, tie-break entity id). Tests: jump order, falloff, dedup, stops
  when no injured target, spell power scaling matches aoeHeal coeff.
- N5 schoolDmgPct: global.schoolDmg = { [school]: pct }, applied where
  spellDmgPct multiplies but filtered by ability school. Tests: fire pct
  boosts Fireball not Frostbolt; stacks additively with spellDmgPct;
  excluded from talent scaling like other multipliers.
- N6 dot-on-aoe (Serpent Spread): a dot inside addEffects on an ability
  whose primary effect is aoeDamage applies to EVERY struck target, not
  the primary. Shape: { type: 'dot', ..., perAoeTarget: true }. Tests:
  all struck targets dotted, LoS-blocked targets not, dot values scale
  once (no double talent scaling).
- N7 ability-keyed empower (Eclipse): aura { kind: 'empower_ability',
  abilityId, value: dmgMult }: next cast of abilityId consumes it for
  value x damage. Tests: only the keyed ability consumes, refresh not
  stack, cross-pair (Wrath grants Starfire empower and vice versa).
- N8 randomSelfBuff (Roll the Bones): { type: 'randomSelfBuff', options:
  SelfBuffSpec[6], duration }: ctx.rng picks one. Content-level rng is
  parity-safe (a recorded draw like any damage roll). Tests: draw comes
  from ctx.rng (architecture test covers Math.random), all six reachable.
- N9 payoff glow (UI, no sim change): action button pulses when an
  empower/streak-building aura the ability can consume is active; dimmer
  pulse for building. Pure hud.ts paint + css; no per-frame DOM churn when
  state unchanged. Test: tests/hotbar glow class toggling via fake auras.
- N10 moveSpeedPct: StatModEffect.moveSpeedPct, a permanent movement
  speed multiplier from talents, read where buff_speed/slow already
  resolve the entity's speed. Tests: stacks multiplicatively with
  buff_speed, slows still apply on top, player-only (mobs unaffected),
  wire-mirrored so ClientWorld prediction matches the server. Consumers:
  Fleet Footed (rogue), future utility passives.

Deferred (explicitly NOT in this pass): stacking self-buff engine (Arcane
Blast ramps), death-save (real Cheat Death), moving ground zones (Frozen
Orb), freeze-duration mods, HoT-count payoff reads.

## Part 4: Per-class change plan (verdict per option: KEEP / CRANK / REPLACE)

Format: row [theme]: option: verdict: exact effect (primitive).

### Warrior (reference class for bold percent mods)
- r5-r8: KEEP ALL (Juggernaut, Heroic Leap, Warbringer, Pummel, Concussive
  Clap, Crippling Strikes: all at the bar).
- r11 Commanding Presence: REPLACE with Sudden Death: global.streak
  { trigger: 'melee_hit', count: 3, reward: { allowExecuteAnyHp } } (N1).
  Building aura 'Sudden Death' at 2 hits; Execute button glows (N9).
- r11 Berserker Rage, Furious Bloodrage: KEEP.
- r14: KEEP ALL (Mortal Strike / Whirlwind / Executioner).
- r17: KEEP ALL (Iron Hide is the row's allowed passive).
- r20: KEEP ALL (three strong grants). Colossus Smash: SHELVED, no slot.

### Mage (post-feedback-pass, the quality bar)
- r11 Permafrost: CRANK buffPct 0.4 to 2.0 (owner: a barrier so big WHEN
  you cast it becomes the decision).
- Everything else: KEEP.

### Paladin
- r5 Vengeful Exorcism: CRANK dmgPct 0.25 to 0.5 (keep costPct -0.25).
- r11 Divine Wisdom: REPLACE with Art of War: global.streak { trigger:
  'melee_crit', count: 2, reward: { resetCooldown: 'exorcism', empower:
  ['next_cast_free'], abilityFilter: ['exorcism'] } }. Requires the
  melee_crit trigger in N1's union (one enum + one test case, already
  listed there). Verified against content: Exorcism is ALREADY instant
  (castTime 0, 15s cd), so the proc is a free extra Exorcism NOW, not a
  cast-time cheat.
- r11 Greater Blessing: CRANK buffPct 0.5 to 1.0.
- r14 Righteous Cause: CRANK seal dmgPct 0.15 to 0.3.
- r8, r17, r20: KEEP (Divine Shield rework is kill-list Part 2, already
  specified: emergency heal + cast_shield window, honest name).

### Hunter (owner picks; biggest rebuild)
- r5 [trick shots] REPLACE ALL THREE:
  - Master Marksman: global.streak { trigger: 'ranged_hit', count: 4,
    reward: { empower: ['next_cast_instant', 'next_cast_free'],
    abilityFilter: ['aimed_shot'] } } (N1, needs the physical cast-time
    consumption fix). Building aura 'Ready, Set, Aim...'.
  - Serpent Spread: ability mod on multi_shot, addEffects [{ type: 'dot',
    perAoeTarget: true, serpent sting values }] (N6). NOTE: requires
    Multi-Shot known; grant multi_shot with this option if r14 not taken:
    NO: simpler and honest: this option ALSO grants multi_shot (grant +
    ability mod in one TalentEffect, both fields exist). r14 Multi-Shot
    option then swaps for Kill Shot (below).
  - Glaive Toss: grant new ability glaive_toss (E: instant, two damage
    effects on primary + aoeDamage radius 6 at target, throw fx, 12s cd).
    Full i18n cost: name+description in all locales (the known tax).
- r11 Efficiency: REPLACE with Lock and Load: global.streak { trigger:
  'dot_tick', count: 4, reward: { empower: ['next_cast_free'],
  abilityFilter: ['arcane_shot'] } } plus arcane_shot dmg x2 while
  empowered: express as reward empower aura value consumed by the shot
  (N1 bonus value on the charge). Building aura 'Lock and Load'.
- r14 Multi-Shot: REPLACE with Kill Shot: grant kill_shot (E: execute-
  gated ranged nuke, threshold 0.2) + global.onKill { resetCooldown:
  'kill_shot' } (N2). (Multi-Shot lives at r5 Serpent Spread now.)
- r17 Master Tamer (the deadest slot shipped): REPLACE with Wyvern Venom:
  ability mod on concussive_shot, addEffects [{ type: 'dot', poison-tier
  values }] (E). Bold and thematic without new machinery; Deterrence and
  Thick Hide keep their slots.
- r20: KEEP ALL.

### Rogue
- r5: CRANK all three: Relentless Strikes costPct -0.2 to -0.4; Improved
  Backstab dmgPct 0.25 to 0.6; Opportunist ambush dmgPct 0.25 to 0.6.
- r8: CRANK Improved Gouge cooldownPct -0.3 to -0.6; Improved Kidney Shot
  costPct -0.25 to -0.5. Kick: KEEP.
- r11 Endurance: REPLACE with Roll the Bones: grant roll_the_bones (N8:
  randomSelfBuff of 6 x 20s buffs: haste / AP / dodge / crit / leech-on-
  strikes / spellcrit; energy cost, no cd). The one sanctioned slot
  machine. Preparation, Improved Slice and Dice (CRANK 0.25 to 0.5): KEEP.
- r14 Seal Fate: REPLACE with Marked for Death: global.onKill
  { gainCombo: 5 } (N2). Ghostly Strike KEEP; Deadly Brew CRANK 0.3 to 0.5.
- r17 Cheat Death: RENAME to 'Tenacity' (honest passive; real death-save
  is a deferred primitive). Cloak of Shadows, Improved Evasion: KEEP.
- r20 Master Assassin (+5% crit, bland): REPLACE with Fleet Footed:
  { stats: { moveSpeedPct: 0.25 } } (N10). Owner pick: a permanent +25%
  base run speed PASSIVE dueling Shadowstep's teleport in the same tier:
  always-on utility vs a big active, the best kind of row argument.
  Shadowstep, Adrenaline Junkie: KEEP.

BOLD UTILITY PATTERN (owner): every class should get at least one
always-on utility passive bold enough to rival an active in its row.
Fleet Footed is the template. Future candidates when a bland slot opens:
paladin Pursuit of Justice (+15% speed), druid Feline Swiftness (cat form
+30%), warrior Plate Runner (armor no longer slows sprint-type effects).

### Priest
- r5: CRANK Searing Light 0.25 to 0.4; Improved Renew 0.25 to 0.5;
  Twisted Faith 0.2 to 0.5.
- r8, r11: KEEP (Vampiric Embrace leech dot already at the bar).
- r14 Mind Melt: REPLACE with Shadow Word: Death: grant sw_death (E:
  execute-gated shadow nuke + selfDamagePctMax backlash if the target
  survives; both shapes shipped). Risk/reward in one button.
- r14 Pain and Suffering: REPLACE with Shadowy Apparitions: global.streak
  { trigger: 'dot_tick', count: 2, reward: { bonusHit: { pct: 0.6 } } }
  (N1 bonusHit: free extra shadow hit at 60% of the tick source spell).
- r14 Greater Heal: CRANK castPct -0.15 to -0.3.
- r17, r20: KEEP.

### Shaman
- r5: CRANK Concussion 0.15 to 0.3; Improved Lightning Shield buffPct 0.4
  to 1.0; Imbue Mastery 0.3 to 0.6.
- r11 Ancestral Guidance: REPLACE with Chain Heal: grant chain_heal (N4
  bounceHeal: 3 jumps, 30% falloff, radius 12). Healing Stream KEEP;
  Elemental Attunement CRANK costPct -0.2 to -0.35.
- r14 Weapon Fury: REPLACE with Maelstrom Weapon: global.streak
  { trigger: 'melee_hit', count: 5, reward: { empower:
  ['next_cast_instant', 'next_cast_free'], abilityFilter:
  ['lightning_bolt', 'chain_lightning', 'healing_wave'] } } (N1).
  Building aura 'Maelstrom Weapon' stacks visibly.
- r20 Elemental Fury: REPLACE with Fulmination: ability mod on
  earth_shock, addEffects [{ type: 'consumeAura', self: true, auraId:
  'lightning_shield', scalePerStack: 0.35 }] (N3: consume the caster's
  own Lightning Shield by aura id, +35% earth shock damage per stack).
- r17, rest: KEEP (Improved Ghost Wolf instant is already at the bar).

### Warlock
- r5: KEEP instant Corruption; CRANK Bane castPct -0.2 to -0.35; Improved
  Immolate 0.25 to 0.5.
- r11 Improved Life Tap: CRANK 0.3 to 1.0 (double conversion). Fel
  Concentration: REPLACE with Haunt: ability mod on shadow_bolt,
  addEffects [{ type: 'dot', leechPct: 1, modest values }] (E: the
  leechPct dot shipped with Vampiric Embrace). Demon Armor: CRANK 0.4
  to 0.8.
- r14 Amplify Curse: REPLACE with Drain Soul: grant drain_soul (E
  drainTick + execute threshold) + global.onKill { gainResource: mana }
  (N2) for kills mid-channel. Ruin: CRANK searing_pain 0.2 to 0.4;
  Shadow Mastery: CRANK 0.06 to 0.12 (the row's allowed passive).
- r17, r20: KEEP (Metamorphosis becomes a real form + tint per the Part 2
  kill-list; Backdraft moved to the destruction SPEC package, Part 4b,
  because Conflagrate is spec-exclusive and a row option must not depend
  on one spec's signature).

### Druid
- r5: CRANK Improved Wrath castPct -0.2 to -0.35; Ferocity -0.2 to -0.4;
  Nature's Bounty 0.25 to 0.5.
- r14 Moonfury: REPLACE with Eclipse: casting Wrath applies
  { kind: 'empower_ability', abilityId: 'starfire', value: 1.4 } and
  Starfire applies the mirror for Wrath (N7). Expressed as ability mods:
  wrath addEffects selfBuff empower_starfire etc. Pendulum, zero rng.
- r14 Savage Fury: REPLACE with Tiger's Fury: grant tigers_fury (E:
  gainResource energy + selfBuff buff_ap, off-gcd, 30s cd; new ability
  def + full i18n).
- r14 Empowered Touch: CRANK healing_touch dmgPct 0.2 to 0.35 and castPct
  -0.1 to -0.2.
- r8, r11, r17, r20: KEEP.

## Part 4b: Spec identity packages (all 27, exact effects)

Rule: pick a spec, feel a spike: one BIG themed number, one secondary,
plus the signature spell (already shipping). Uses N5 (schoolDmg) for
casters; physical kits use existing apPct/meleeDmgPct/ability mods.
Numbers are pre-sweep targets; the sweep tunes VALUE not SHAPE.

- warrior/arms: { meleeDmgPct: 0.15 } + mortal_strike dmgPct 0.1 | sig kept
- warrior/fury: { stats: { crit: 0.05, apPct: 0.1 } }
- warrior/prot: { threatPct: 0.3, armorPct: 0.15 }
- paladin/holy: { healPct: 0.2 }
- paladin/prot: { threatPct: 0.3, armorPct: 0.12 }
- paladin/ret: { schoolDmg: { holy: 0.2 }, meleeDmgPct: 0.08 }
- hunter/bm: { apPct: 0.12, maxHpPct: 0.08 } (pet scaling rides ap)
- hunter/mm: { apPct: 0.15, crit: 0.03 }
- hunter/surv: { agiPct: 0.12, dodge: 0.03 }
- mage/arcane: { schoolDmg: { arcane: 0.15 }, intPct: 0.1 } (owner: +mana)
- mage/fire: { schoolDmg: { fire: 0.2 }, crit: 0.05 } (owner example)
- mage/frost: { schoolDmg: { frost: 0.15 }, armorPct: 0.1 } (freeze-
  duration mod deferred; armor keeps the tanky-frost identity)
- rogue/assa: { crit: 0.04 } + eviscerate dmgPct 0.15
- rogue/combat: { meleeDmgPct: 0.15 }
- rogue/sub: { agiPct: 0.1 } + ambush/backstab/garrote dmgPct 0.2
- priest/disc: { healPct: 0.1, maxHpPct: 0.1 }
- priest/holy: { healPct: 0.2 }
- priest/shadow: { schoolDmg: { shadow: 0.2 } } (Shadowform tint stays)
- shaman/ele: { schoolDmg: { nature: 0.2 }, crit: 0.03 }
- shaman/enh: { meleeDmgPct: 0.12 } + imbue buffPct 0.5
- shaman/resto: { healPct: 0.2 }
- warlock/affl: { schoolDmg: { shadow: 0.15 } } + corruption/curse_of_
  agony dmgPct 0.2
- warlock/demo: { staPct: 0.12, armorPct: 0.12 }
- warlock/destro: { schoolDmg: { fire: 0.2 }, crit: 0.03 } + Backdraft:
  conflagrate addEffects selfBuff buff_spellhaste 0.3 x 6s (E, ships with
  the package since Conflagrate is the destro signature)
- druid/balance: { spellDmgPct: 0.15, intPct: 0.08 } (Wrath is nature,
  Starfire arcane: school split makes schoolDmg awkward; generic is fine)
- druid/feral: { threatPct: 0.25, meleeDmgPct: 0.1, armorPct: 0.1 }
- druid/resto: { healPct: 0.2 }

Migration note: retunes REPLACE the existing mastery effects in place
(same node ids), so saves and the wire format are untouched; only
resolved numbers move. Golden impact: fiesta/dps goldens WILL move
(spec masteries apply to bots): one accounted regen per content wave.

## Part 5: Balance sheet (design-phase gates)

- Row-internal parity: the three options of a row should sit within
  roughly +-10% of each other in expected combat value for the archetype
  that wants the row. Actives are priced by uptime x effect.
- Class band: post-wave sweep medians stay inside 18-38 dummy DPS
  (docs/balance/row-sweep.md baseline); no single build >40% over its
  class median (the existing hard gate).
- Spec parity: after Part 4b, the three DPS medians within a class stay
  within +-8% of each other; healer/tank packages are priced on healing
  done / effective HP, not DPS.
- Tuning direction (owner rule): when the sweep flags an option, tune the
  VALUE (damage numbers, durations) never the SHAPE; never regress a bold
  number back into blandness (-50% cd + lower dmg beats +12% dmg).
- Streak procs price at roughly one free GCD per count x trigger-rate;
  Maelstrom at 5 melee hits ~= one instant LB per ~7s of uptime melee:
  worth ~10-12% throughput, in line with a strong row option.
- Acceptance per content wave: node scripts/row_build_sweep.mjs (11 min)
  + the per-class wave test file + parity with only accounted regens.

## Part 6: Synthesis principles (from the mechanic-pattern research)

The 8 archetypes ranked by fun-per-implementation-complexity, mapped:
1. Two-state proc chain: N1 (Hot Streak, Master Marksman, Maelstrom).
2. Health-threshold gate + on-kill reset: E + N2 (Kill Shot, SW:Death,
   Drain Soul, Hammer of Wrath).
3. Consumption: E consumeAura + N3 self variant (Fulmination, Swiftmend).
4. Charge-based active defense, visible: E selfBuff windows + N9 glow.
5. Auto-bouncing chain: N4 (Chain Heal now, Prayer of Mending later:
   the delayed on-damage trigger variant is deferred).
6. Stack/ramp with spend-vs-wait: combo points (E) + N1 counters.
7. Movement-as-attack: E (swept charge/blink + addEffects).
8. Transformation window: E (forms + tints + riders; Metamorphosis).
Cross-cutting: feedback immediacy (N9 glow), two-moment structure
(building auras mandatory on every N1 use), triggers ride existing
behavior (no new inputs), spend-now-vs-wait preserved, phase shifts.

## Part 7: Build order (executor-agnostic; each step gated on its tests)

0. ENGINE (one PR-sized slice, content-unused, goldens byte-identical):
   N1 (with melee_crit trigger + physical cast-time consumption + bonusHit
   reward), N2, N3, N4, N5, N6, N7, N8, N9. Tests named in Part 3. This
   slice is pure primitives: reviewable without any balance questions.
1. Wave F2 warrior/paladin/hunter: Part 4 verdicts + Part 4b packages for
   those classes + new ability defs (glaive_toss, kill_shot) with FULL
   i18n. Sweep + accounted golden regen.
2. Wave F3 rogue/priest/shaman: same shape (roll_the_bones, sw_death,
   chain_heal defs + i18n).
3. Wave F4 mage/warlock/druid: mage is crank-only; warlock/druid rows +
   packages (drain_soul, tigers_fury defs + i18n).
4. Kill-list Part 2 items land with their class wave (Ice Block to Cold
   Snap with the mage wave, Metamorphosis form with the warlock wave...).
5. After F4: full sweep, spec-parity check (Part 5), play-branch rebuild,
   owner playtest.

Design-phase status: Parts 3-5 are the reviewable surface. Open design
questions for the owner are tracked at the bottom.

## Open design questions (owner input wanted, none blocking Part 7 step 0)

1. Rogue r17 'Cheat Death' rename ('Tenacity'?) vs deferring the row slot
   to a real death-save primitive later.
2. Hunter r5 loses ALL THREE current options; Multi-Shot moves inside
   Serpent Spread and Kill Shot takes the r14 slot. OK to ship, or keep
   plain Multi-Shot as an r14 alternative and put Kill Shot at r17 over
   Wyvern Venom?
3. Spec packages: fire +20%/+5% is the owner anchor; are 0.15-0.2 school
   bands for every caster acceptable pre-sweep, or start at 0.15 and let
   the sweep push up?
4. druid/balance keeps generic spellDmgPct (Wrath nature / Starfire
   arcane school split): fine, or should Eclipse make balance feel
   distinct enough that the package stays plain?
