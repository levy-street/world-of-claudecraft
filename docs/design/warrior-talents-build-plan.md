# Warrior talents: implementation build plan (Pandaria choice-row design)

Status: DESIGN LOCKED, NOT YET IMPLEMENTED. Produced 2026-07-06 from a 3-agent
code-grounded survey of `src/sim`. This is the build sheet: hand it to an
implementer and the work is mechanical. The design (18 talents, 6 tiers, pick 1
of 3, level 20) lives in the bilingual calculator mockup (Artifact / CodePen).

## 0. The one decision that gates everything: the FOUNDATION

The Pandaria "choice-row" talent SYSTEM does not exist in the codebase. The game
uses the old POINT-TREE (`src/sim/content/talents.ts`, `talents_warrior.ts`,
11 points at level 20). The choice-row engine lives ONLY in unmerged draft PR
#1348 (`levy-street`, author ryan-foo), on `release/v0.19.0`.

Three paths, pick one before writing talent code:

- **A. Build a fresh, minimal choice-row engine (RECOMMENDED).** A small container
  scoped to this game: 6 tiers gated at levels 5/8/11/14/17/20, pick-1-of-3 per
  tier, class-wide, free respec. `TalentAllocation = { rows: (id|null)[6] }`. Reuse
  the EXISTING effect engine unchanged (see 2). This is the cleanest fit for the
  20-level game and avoids the PR #1348 rebase.
- **B. Revive PR #1348. NOT recommended as-is.** Its base (`v0.19.0`) is **452
  commits behind** current `release/v0.22.0`, and it is **159 files / +120k lines**,
  half-done (its own "fun pass" checklist is unbuilt). Rebasing + finishing +
  testing is a multi-week epic. Mine it for reference, do not merge it blind.
- **C. Ship the effects on the current point-tree now, swap the container later.**
  Every engine hook below is **container-agnostic** (all 3 agents confirmed): only
  the node-authoring shape (`TalentNode` vs choice-row) differs, the
  `effect`/`AbilityEffect`/`GlobalModEffect`/aura hooks are identical. So the hard
  work (2-4) can proceed and the container is a thin final layer.

Recommendation: **A + C** in parallel: build the engine effects (2-4) first (they
port anywhere), and stand up the minimal choice-row container (A) as its own slice.

## 1. What became BASE warrior abilities (out of talents)

Per the design, these leave the talent pool and join the baseline warrior kit
(implement as normal abilities, not talents): **Heroic Leap**, the **charge that
stuns** (current `charge`/Onrush already does this), **Pummel** (interrupt), and
**Rallying Cry** (party temp-HP shout).

## 2. Shared engine primitives (build ONCE, unblock many)

The current effect model: `TalentEffect = { stats?, grant?, ability?[], global? }`
folded flat by `accumulate()` at allocation (`talents.ts:553-602`); consumed in
`entity.ts recalcPlayerStats` (stats), `classes.ts applyTalentMods`/`abilitiesKnownAt`
(ability + grant), and the Sim reads `global.*` (precedent `global.threatPct`,
`sim.ts:2711`). Granted abilities are pure data (`effect.grant`, like `whirlwind`).

Build these three first:

1. **`damageOutputMult(source)`**: a source-side outgoing-damage multiplier read
   in `dealDamage`, mirroring `hexOutputMult` (`damage.ts:136`, impl `heal.ts:46`).
   Sums a new `buff_dmg_done` aura's `value` -> `1 + amp`. Unblocks Avatar, Bloodbath,
   Sanguine Aura, and Battle Rhythm's +5%.
2. **`buff_crit` AuraKind** folded into `e.critChance` in the recalc aura loop
   (`entity.ts:219-252`, crit at `:331`); expiry already marks `statsDirty`
   (`auras.ts:195-201`). One fold covers autos + all specials (they read
   `p.critChance`). Unblocks Recklessness, Bloodbath.
3. **Rage-gain multiplier**: there is NO central rage helper; rage is minted at
   `rageFromDealing` (`damage.ts:336-340`, white physical only), `rageFromTaking`
   (`:346-350`), `gainResource` (`effect_dispatch.ts:736-738`), and Charge's +9
   (`:762`). Add `global.autoRagePct` + `global.abilityRagePct` (fold in
   `accumulate`/`zeroGlobal`) and wrap each mint site. Unblocks Anger Management,
   Recklessness, Battle Rhythm.

New `AbilityEffect` variants -> union at `types.ts:1080-1149` + a `case` in
`runEffects` (`effect_dispatch.ts`). New `AuraKind` -> `types.ts:143-197`
(`Aura` already has `value`/`stacks`/`remaining`/`duration`). Auras ride the wire
generically (`id/name/kind/rem/dur/value/stacks/charges`, encode `game.ts:614`,
decode `online.ts:1429`), so a new buff + its magnitude + stacks reach the client
and render (icon/tooltip) with ZERO new wire fields. `e.scale` also already wires.

## 3. Per-talent build notes

Legend: effort S/M/L; "wire" = needs a NEW wire field (else rides existing
aura/scale/cds wire for free).

### Tier 1 - Mobility
- **T1c Crushing Charge** (S, no wire). Charge also roots 4s + slows 50% 15s.
  Pure data via `ability.addEffects`: `{ ability:[{ ability:'charge',
  addEffects:[{type:'root',duration:4},{type:'slow',mult:0.5,duration:15}] }] }`.
  `root`/`slow` already dispatch (`effect_dispatch.ts:435-447,420-434`). Test: cast
  charge, assert target root+slow+base stun.
- **T1b Pursuit** (M, no wire). On kill: +30% move speed 6s. `buff_speed` aura
  already read in `moveSpeedMult` (`sim.ts:2913`). NEW: `global.onKillSpeedPct/Dur`;
  hook in `handleDeath` credit loop (`damage.ts:613-624`, + PvP `killer`) to
  `applyAura(buff_speed)`. Test: kill a mob, assert killer speed buff 1.3.
- **T1a Double Charge** (L, WIRE `chg`). Charge stores 2 charges. NEW SUBSYSTEM
  (no ability-charge system exists). Add `ability.extraCharges`, a per-entity
  `abilityCharges: Map`, cast-gate change (`casting_lifecycle.ts:238-245`), recharge
  in `updateTimers` (`auras.ts:97-107`). Wire the charge count (`chg`) + register in
  `ALL_DELTA_KEYS`. Default `extraCharges:0` -> identical to today. Build as its own
  `SimContext` module. Test: 2 casts while on cd, 3rd errors, refills over time.

### Tier 2 - Survival
- **T2b Die by the Sword** (M, no wire). Active CD: -10% dmg taken, -20% below 30%.
  NEW `AuraKind 'die_by_sword'` + granted ability (`selfBuff`) + a `dealDamage` arm
  beside Defensive Stance's 0.9 (`damage.ts:96-102`): `mult = hp<30%?0.8:0.9`. HP
  check is server-authoritative (fair). Test: cast, assert 10%, drop below 30%,
  assert 20%.
- **T2a Second Wind** (M, no wire). Below 35% HP: regen 3% max HP/sec IN combat.
  NEW conditional-regen field; SEPARATE arm from `updateRegen` (which gates on
  `!inCombat`, `auras.ts:76`). Fold 3%/s as 6%/2s cadence or add a 1s subtimer; emit
  `heal` event. Test: hp to 30%, tick, assert heal; above 35% stops.
- **T2c Victory Rush** (M-L, WIRE `vrUntil`). Heal-strike usable after a kill.
  Proc-window precedent = Overpower's `overpowerUntil` (`casting_lifecycle.ts:262`).
  Add `victoryRushUntil` (Entity), `requiresVictoryProc` (AbilityDef), gate in
  `castAbility`, set window in `handleDeath`. NEW self-heal `AbilityEffect` (the
  generic `heal` heals the enemy for enemy-target abilities). Wire `vrUntil` (0/1
  like `opUntil`) + delta registry. Test: errors before kill, lands+heals after.

### Tier 3 - Control
- **T3b Storm Bolt** (S, no wire). Thrown weapon, single stun. Pure data:
  `directDamage` + `stun` both exist. New ability, `projectile:true` (else resolves
  instantly), verify `stunDrCategory` default. Test: cast, assert damage + stun DR.
- **T3a Piercing Howl** (M, no wire). Shout, AoE 50% slow 15s in 15yd. NEW
  `aoeSlow` AbilityEffect (clone the `aoeAttackPower` loop, `effect_dispatch.ts:625`);
  apply `slow` aura to `hostilesInRadius`. New ability (model `demoralizing_shout`).
  Test: 2-3 mobs in radius slowed, one outside not.
- **T3c Lingering Dread** (L, parity). Feared enemies take more damage before the
  fear breaks. PREREQUISITE MISSING: `breaksOnDamage` currently breaks on the FIRST
  hit (`damage.ts:283-293`), no threshold. Add `Aura.breakThreshold/damageAccrued`,
  accumulate before breaking (default preserves today's behavior for all other
  CC), + `global.fearBreakThresholdPct` scaling it. Touches SHARED CC-break -> add a
  `tests/parity` scenario. Depends on a warrior area-fear existing.

### Tier 4 - Resource
- **T4b Blood Offering** (S, no wire). Sacrifice 5% max HP -> 30 rage. Pure data:
  copy `bloodrage` (`classes.ts:589`) with `selfDamagePctMax:0.05` + `gainResource:30`.
  Test: assert hp -5%, rage +30.
- **T4a Anger Management** (M, no wire). +25% auto rage, +15% ability rage. Uses the
  shared rage-gen globals (2.3). Test: band-assert 1.25x auto rage; +15% on
  bloodrage/charge.
- **T4c Battle Rhythm** (M, no wire). Every 3rd ability: +20% rage, +5% damage.
  NEW `PlayerMeta.abilityRhythm` counter incremented once per `runEffects`; 3rd cast
  empowered (transient scalar cleared each dispatch, NOT persisted/wired). Rage half
  only bites on rage-gen abilities. Precedent: rogue combo streak. Parity scenario
  (draw order unchanged). Test: 3rd cast 1.05x dmg + rage, resets on 4th.

### Tier 5 - Offensive cooldown
- **T5a Recklessness** (M, no wire). Enrage 12s: +50% rage gen, +20% crit. One
  aura read by both the `buff_crit` fold (2.2) and the rage-gain mult (2.3). Test:
  crit +0.20, rage 1.5x, reverts after 12s.
- **T5c Bloodbath** (M, no wire). Each kill: +5% crit & +5% dmg 8s, stacks to 5
  (25%). On-kill hook in `handleDeath` (credited player, `damage.ts:585`); ONE aura
  with `stacks` (sunder precedent), `value` for `damageOutputMult`, crit via
  `buff_crit`. MUST call `recalcPlayerStats` after mutating (handleDeath is outside
  runEffects). Stacks ride the wire free. Test: 5 kills -> +25%, cap holds, fades.
- **T5b Avatar** (L, maybe wire). Transform 20s: break all control, +20% dmg. Three
  parts: `buff_dmg_done` (2.1); NEW `breakControl` one-shot (extend `isControlAura`
  `sim.ts:2883`, emit `aura` lost per stripped, precedent `cleanseFriendlyNpcAuras`
  `auras.ts:120`); transform via `buff_scale` (free wire via `e.scale`) OR a distinct
  colossus model (that alone = new Entity field + wire + render). Watch `buff_scale`
  inflating maxHp. Test: stun then cast -> stun gone, dmg 1.2x, scale>1.

### Tier 6 - Capstone
- **T6a Colossal Might** (S-M, no wire). Rage spent shaves major-CD cooldowns. Hook
  the single spend site (`spendResource`, `casting_lifecycle.ts:507`/`auto_attack.ts:141`):
  reduce `p.cooldowns.get(id)` for a named const set of offensive ids by
  `rageSpent * rate` (delete at <=0). `cds` already wires. Test: spend 30 rage,
  assert CD dropped 30*rate, never below 0.
- **T6c Sanguine Aura** (M-L, no wire). You + MELEE allies: +10% attack speed &
  +10% dmg 20s. Iterate `partyOf(p.id)` (`party.ts:41`); attack speed via existing
  `attackspeed` kind (value 1/1.1, `swingIntervalMult` `sim.ts:2994`), dmg via
  `buff_dmg_done`. NEW: a pure `isMelee(meta)` predicate from class + resolved
  spec/role (`TalentModifiers.spec/role`) - unit-test it across all 9 classes. Buffs
  on allies ride the wire free (party frames show them). Test: warrior+rogue get it,
  mage does not.
- **T6b Bladestorm** (L, render + parity). Channel, caster-centered AoE pulses. NEW
  primitive: a channel that re-centers on live `p.pos` each tick (existing channel
  AoE centers on the fixed `castAim`, `casting_lifecycle.ts:536`). Decide movement
  (`castWhileMoving`). Spin VFX = a `src/render/` addition keyed off the wired
  `castingAbility`. New rng-drawing tick path -> `tests/parity` scenario. Test:
  surround with mobs, each pulse hits all; follows/cancels on move per decision.

## 4. Suggested phased roadmap

- **Phase 0** - shared primitives (2): `damageOutputMult` + `buff_dmg_done`,
  `buff_crit` fold, rage-gain globals. Each with a focused unit test. Unblocks 6+.
- **Phase 1** - the S talents (pure data / one small hook): Crushing Charge, Storm
  Bolt, Blood Offering, Colossal Might. Fastest wins, no new wire.
- **Phase 2** - the M talents (sim-contained, no new wire): Pursuit, Second Wind,
  Die by the Sword, Piercing Howl, Anger Management, Battle Rhythm, Recklessness,
  Bloodbath, Sanguine Aura.
- **Phase 3** - the L talents (cross-cutting): Victory Rush (wire), Double Charge
  (charge system + wire), Lingering Dread (CC-break semantics + parity), Avatar
  (transform render), Bladestorm (channel + render).
- **Container** (foundation A): the minimal choice-row model + picker UI + migration,
  as its own slice, any time after Phase 0.

## 5. Cross-cutting checklist (every talent)

- Author as choice-row content (foundation A) OR a point-tree `choice`/`active`
  node (`war_tactical_choice` / `war_berserker_rage` precedents) if shipping on the
  current tree first.
- i18n: English name/description in the catalog; a talent name must equal an ability
  name or get a `src/ui/talent_i18n.ts` per-locale title override (guard fails
  otherwise). Any sim-emitted log line needs a `src/ui/sim_i18n.ts` matcher IN THE
  SAME CHANGE (S3 guard `tests/localization_fixes.test.ts`).
- `/wiki`: run `npm run wiki:content` per content change (`tests/guide.test.ts`).
- Wire: only Double Charge (`chg`) and Victory Rush (`vrUntil`) need new self fields
  -> add to `selfWireJson` + `online.ts` + `ALL_DELTA_KEYS`/`TERSE_TO_IWORLD`
  (`tests/snapshots.test.ts`). Everything else rides aura/scale/cds wire for free.
- Determinism: no new `Rng` draws except Bladestorm (new pulse path) and the
  Lingering Dread break-timing change -> both need a `tests/parity` scenario. All
  other talents are draw-order neutral.
- Guards to run each slice: `npx vitest run tests/talents.test.ts`,
  `tests/architecture.test.ts` (sim purity), plus `tests/snapshots.test.ts` for the
  two wire talents and `tests/parity` for Bladestorm / Lingering Dread.

Key files: `src/sim/content/talents_warrior.ts`, `classes.ts` (ABILITIES),
`talents.ts`, `src/sim/types.ts`, `src/sim/combat/{effect_dispatch,damage,
casting_lifecycle,auras,auto_attack}.ts`, `src/sim/entity.ts`, `src/sim/social/party.ts`,
`src/sim/sim.ts`, `server/game.ts` + `src/net/online.ts` (wire),
`src/ui/{talent_i18n,sim_i18n}.ts`, `tests/{talents,sim,snapshots}.test.ts` + `tests/parity`.
