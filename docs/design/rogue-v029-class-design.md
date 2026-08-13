# Rogue v0.29 class design: themed rows and capstones

Status: build spec for the rogue slice of the v0.29 per-class talent redesign.
Companion docs: the hunter, shaman, and priest v0.29 designs on PR #2218 set the
tier template this document follows; `docs/design/class-design-rules.md` holds the
row jobs and stacking rules; `docs/design/spell-balance-framework.md` holds the
measurement contract. Naming follows `ip-refactor/NAME-MAP.md` (append-only; no
verbatim WoW names).

## Direction

The rogue keeps its three specializations exactly as shipped (Knifework,
Thuggery, Skulduggery: signatures and masteries untouched, both were retuned in
July 2026). This redesign replaces the six class-wide choice rows so that every
tier is a themed decision, ending in a build-defining capstone, per the v0.29
template:

| Level | Theme | Row job |
|---|---|---|
| 5 | movement | No damage or healing increase |
| 8 | defense | One clear survival behavior per option |
| 11 | control | Damage incidental |
| 14 | kit management | Energy and combo cadence, never raw throughput stacking |
| 17 | major window | Personal burst vs aggressive defense vs party rally |
| 20 | capstone | Build-defining; grants no new rotational action; serves all three specs; state readable on mobile |

Mobile responsiveness is a hard requirement. The core damage loop stays at four
to five buttons per spec (builder, damage finisher, signature, one major
cooldown, plus Cutthroat Tempo only where a build opts in). Each row grants at
most one new action. No option requires sub-second reactions or repositioning
precision beyond what the base kit already asks. Stealth, Eye Jab, Sap, Gut
Punch, Swift Heels, Ghostfoot, and Smokestep remain the deliberate PvP and
utility layer outside the main rotation.

## Constraints that shaped the rows

- The unlock guard (`tests/choice_rows_unlock_guard.test.ts`) forbids an option
  from modifying an ability learned after the row unlocks. Consequences: no
  Swift Heels option at row 5 (Sprint learns at 10), no Smokestep option before
  row 18+ (Smokestep learns at 18), no poison option before row 14 (poisons
  learn at 12 to 14).
- Thuggery's mastery axis is attack speed: no row option may add attack speed.
  Knifework's axis is poison/DoT damage; Skulduggery's is crit damage. No row
  option stacks a mastery axis.
- Row options are class-wide and must be live for all three specs at unlock.

## The six rows

Option ids are new (`rog_r<level>_<slug>`); the flip is a full replacement with
a content-revision free repick, the hunter pattern from PR #2218.

### Level 5, movement. Decision: teleport vs kill momentum vs rotational speed

1. Shadeslip [grant, the row's one action]: the existing teleport-behind
   ability, moved from the old capstone row. Preserves Duskveil.
2. Killer's Pace [global]: killing blows grant 40% movement speed for 4 sec
   (`onKillSpeedPct`, the shipped warrior machinery; refreshes, never stacks).
3. Quickstep [proc]: landing Wicked Slash or Craven Thrust grants 20% movement
   speed for 2 sec (8 sec internal cooldown). Rotational movement, the hunter
   Predator's Pace shape.

### Level 8, defense. Decision: lethal insurance vs hardened Ghostfoot vs active cloud

1. Borrowed Breath [global]: a killing blow leaves you at 1 health instead,
   once per 120 sec (shipped `cheatDeathIcd`, moved from the old row 17).
2. Ghostfoot Ward [mod]: Ghostfoot also reduces all damage taken by 30% while
   active (adds a `shield_wall` self-buff to the existing ability; no button).
3. Smoke Screen [grant, the row's one action]: the existing dodge-cloud active,
   kept from the old row 8.

### Level 11, control. Decision: stun payoff vs free utility CC vs mid-fight stun access

1. Marked Prey [mod]: enemies you stun with Gut Punch or Low Blow take 10% more
   damage from all sources for 6 sec (`debuffTargetSource` + the shipped
   `vulnerability` aura fold; the party-utility pick).
2. Foul Play [mod + small hook]: Eye Jab and Sap cost no energy, and your own
   poison and bleed ticks no longer break your Eye Jab incapacitate.
3. Cheap Trick [small hook]: Gut Punch no longer requires Duskveil. Mid-fight
   stun access, the PvP pick (relaxes the ability's stealth requirement via a
   talent flag, the same family as the shipped positional checks).

### Level 14, kit management. Decision: stealth economy vs poison economy vs builder rhythm

1. Dusk Economy [global + hook]: abilities cost 50% less energy while in
   Duskveil and for 6 sec after leaving it. The stealth-window pick.
2. Venom Dividend [proc, kept verbatim from the shipped rows]: landed poisoned
   auto-attacks have a 20% chance to restore 10 energy.
3. Ceaseless Cuts [proc, kept verbatim]: every 3rd Wicked Slash restores 30
   energy.

The three options are deliberately flavored toward Skulduggery, Knifework, and
Thuggery respectively while remaining fully cross-spec.

### Level 17, major window. Decision: personal cleave burst vs aggressive defense vs party rally

1. Flurry of Knives [grant NEW, the row's one action]: instantly lash every
   enemy within 6 yd for weapon damage and gain 2 combo points, 45 sec
   cooldown. The rogue's first area tool, deliberately a cooldown burst rather
   than a rotation.
2. Ghostfoot Gambit [proc, kept from the shipped rows]: Ghostfoot restores 30
   energy and makes your next builder within 8 sec cost 50% less. Defense
   turned into tempo.
3. Thieves' Chorus [grant NEW, the row's one action]: rally your party, 10%
   attack and cast speed for 10 sec within 12 yd, 90 sec cooldown, exhaustion
   rules shared with the other group haste bursts.

### Level 20, capstone. Decision: shadow echo vs marked target vs kill momentum

No option adds a button. Each is a build identity with a visible state.

1. Second Shadow [global + hook]: Dirt Nap cast at 5 combo points strikes again
   from the shadows at 40% of its damage. The echo is attributed to Second
   Shadow in the combat log and floating text.
2. Grave Brand [mod]: your stealth openers (Lurker's Strike, Throat Wire, Gut
   Punch) brand the target for 20 sec; you deal 15% more damage to the branded
   target (`vuln_source` fold, source-scoped; the boss/dungeon pick; the brand
   is a visible target debuff).
3. Kill Chain [global + hook]: killing blows refresh Smokestep and grant 5
   combo points (refreshes, never stacks; the leveling and delve momentum
   pick).

## Spec uniqueness

Signatures and masteries already split the specs; the rows reinforce without
locking: Knifework wants Venom Dividend, Marked Prey, and Grave Brand synergy
through poisons and crits; Thuggery wants Ceaseless Cuts, Flurry of Knives, and
Kill Chain tempo; Skulduggery wants Dusk Economy, Shadeslip, and Grave Brand
opener windows. The DPS probe must show the three optimal builds differ in at
least three of six rows and that rotations differ visibly (poison upkeep and
crit fishing vs builder tempo and cleave vs stealth-window openers).

## Engine additions (all small, test-first, content-unused until the flip)

1. `GlobalModEffect.onKillCombo` and `onKillVanishReset`: folded at the shipped
   `onKillSpeedPct` kill-credit site in `combat/damage.ts`.
2. `GlobalModEffect.secondShadowPct`: finisher echo at the `finisherDamage`
   case in `combat/effect_dispatch.ts`, fires only at 5 combo points.
3. `GlobalModEffect.duskEconomyPct`: energy-cost fold at the cost resolve site,
   active while a `stealth` aura or the 6 sec `dusk_economy` linger aura is
   worn; the linger applies where stealth breaks.
4. `GlobalModEffect.foulPlayCostFree` and the incapacitate-break exemption for
   the caster's own dot ticks at the damage-side CC break.
5. `AbilityModEffect.ignoreStealthRequirement` consumed where `requiresStealth`
   is enforced (casting_lifecycle).

New ability definitions: `flurry_of_knives`, `thieves_chorus` (full i18n).

## Balance gates

Row-internal parity within roughly 10% for the archetype that wants the row;
class band per `docs/balance/row-sweep.md`; the capstones priced so no build
exceeds 40% over the class median; deterministic per-spec probes (sustained,
burst, area) extend the existing probe harness; fail-first pins for every new
mechanic. Kill Chain's boss-fight floor (no kills available) must be measured
and accepted before ship.
