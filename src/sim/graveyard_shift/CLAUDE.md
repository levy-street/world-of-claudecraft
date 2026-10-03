# src/sim/graveyard_shift - the Graveyard Shift side adventure

The player covers Morthen's shift in a private copy of the Hollow Crypt against a
party of adventurer bots. Concept and lot plan live outside the repo while this is
a prototype; this directory is built lot by lot. Today: the RUN SHELL (enter,
exit, survive every exit), the MORTHEN IDENTITY (the owner becomes Morthen in
the sim, on his own Dread bar: `dread.ts`), the ADVENTURER PARTY (three bots,
hostility, win and loss), the PARTY BRAIN (the bots fight like a pickup group)
Morthen's SKELETON ALLIES, the KIT EFFECTS (barrow marks, Raise the Fallen) and the
SAY LINES (the living bots talk aloud, heard only up close).

## Contract
- **Offline only while a prototype.** `canStartGraveyardShift` refuses unless
  `ctx.cfg.offlineHost` (set only by `src/game/offline_world_config.ts`) and
  `ctx.devCommands`. A server would autosave the run's state over the real
  character. Lifting this gate is a step of its own (save override, client mirror).
- **Reachable only through `/dev graveyardshift`** (`src/sim/dev/graveyard_shift_dev.ts`),
  so every message is dev-channel English with a `[dev]` prefix. Player-facing
  strings arrive with the content step, as catalog keys.
- **State on Sim.** Runs live in `Sim.graveyardShiftRuns` (owner pid to run),
  exposed as the `ctx.graveyardShiftRuns` live view. Modules here hold functions.
- **Zero shared rng.** Nothing here calls `ctx.rng`; with no run the tick entry
  returns at once, so a world without a run is byte-identical to one without
  this module (pinned in `tests/graveyard_shift_run.test.ts`).
- **One teardown.** Every exit funnels into `endGraveyardShift`: the arena pools
  snapshot (`snapshotArenaReturnPools`) goes back, the stowed pet returns (Morthen
  cannot summon one on shift), the slot is freed. A dead owner,
  corpse or released ghost, is revived at the Crypt door drop. It is an
  arena-style CLEAN SLATE, not an exact restore: auras carried in (buffs, food,
  flasks) are shed and not given back, as in every arena-shaped mode (owner
  decision for the prototype; the shipped version should restore them). A path
  that decides mid-tick (the dev `end`, later a lethal hit) only sets
  `pendingOutcome`; `updateGraveyardShift` tears down on the next tick.
  Exits nobody announces (a teleport, a logout, a death, a party) are caught by the
  same tick watch, one tick late at most.
- **The slot is claimed directly**, never through `enterDungeon`: no roster spawn on
  shared rng, no exit portal, no lockout. Its key (`gshift:<pid>`) is never an
  `instanceKeyFor` key, so Reset All Instances and the Crypt door ignore it.

## The Morthen identity
- **One permanent, undispellable aura** (`gshift_morthen_identity`, kind
  `form_morthen`, kept OUT of `FORM_AURA_KINDS`) is the whole switch; every rule
  keys on `hasMorthenIdentity` (`morthen_identity.ts`, a pure leaf so `entity.ts`,
  `sim.ts` and the lock sites can import it without a cycle).
- **Stats:** `recalcPlayerStats` re-enters over no gear and no talents, then
  `applyMorthenProfile` lays the `morthen` template on top through `mobBaseStats`
  (the createMob formula), then the solo multipliers (`MORTHEN_SOLO_HP_MULT` x3,
  `MORTHEN_SOLO_DAMAGE_MULT` x2 on the weapon and the kit's damage): 3573 hp, 82 to
  130 at 2.6 sec, 234 armor at level 10. The raw template lost to the party in
  under 45 sec without a kill; the multipliers are the playtest's tuning knobs.
  Every recalc path (buff, expiry, equip) therefore lands on the same numbers.
- **Level and talents:** the real level and `talentMods` are parked on the run
  (`MorthenParked`); the owner is pinned to the template's level with
  `emptyModifiers()`. Removal runs BEFORE the teardown's clean slate and pool
  restore, so the hp clamp sees the real maximum.
- **Kit:** `knownAbilitiesFor` (the one known-list rule, called in place by
  `Sim.refreshKnownAbilities`) returns only `MORTHEN_KIT`: the real class kit is
  uncastable. The kit is mode-local, never in `ABILITIES`.
- **Locks (silent while dev-gated):** item use, equip and unequip, mounts, pet
  commands, talent commits and the equipment mods refresh, XP, the warrior stance,
  deed evaluation; the kit runs on the standard GCD whatever the real class.
- **Immunities:** the template's `ccImmune` and `slowImmune`, through
  `playerAuraGuarded` (`morthenBlocksAura`); interrupt lockouts still land.
- **Look (render side, no sim state):** every client draws an identity holder on
  the `morthen` mob's own rig and colour (`src/render/characters/identity_body_core.ts`,
  read by `visualKeyFor` and `createCharacterVisual`); the authored look is never
  composed. The swap rides the renderer's gated base-visual replace. Body size
  stays the player's (1.0), the real boss is drawn at its template scale.
- **Real action bar frozen:** `Sim.actionBarReadOnly` is true while the offline
  primary holds the identity, so the HUD never prunes or saves the real bar.

## The adventurer party
- **Real players with no client** (`run_party.ts`): `ctx.addPlayer` (bot join,
  greeting already sent), level 10, placed in Morthen's chamber in line of sight
  (owner decision for the prototype), in a fixed roster order: warrior tank
  Bulwarkbro, priest healer Mendolyn, mage Pyrotechnic. No `PlayerMeta` flag (never
  `isDevBot`) and never a `characterId`; membership is the run's roster plus the
  permanent `gshift_adventurer` marker aura.
- **Hostility** (`hostility.ts`): one pure pair rule on the two entities' auras,
  Morthen against an adventurer both ways, adventurers friendly to each other.
  `Sim.isHostileTo` adds it as its own player arm (never through world PvP, so no
  honor or stake is paid), and the client reads the same rule in
  `pvp_hostile_core.ts` (red names, hostile frame) and `game/interactions.ts`
  (attack cursor, right-click attack).
- **Win, loss, stall:** every adventurer dead (or gone) wins; a lethal blow on
  Morthen from any source is clamped to 1 hp by `death_intercept.ts` (called from
  `dealDamage`) and loses, and a loss beats a same-tick wipe; an adventurer that
  leaves the claim is removed from the run; a shift nobody finishes ends after
  `GRAVEYARD_SHIFT_MAX_SECONDS`. The teardown removes every bot.

## The party brain
- **Pure rules** (`bot_brain.ts`, no `SimContext`, no shared rng): reaction delay
  (8 to 18 ticks, never faster), no interrupt in the first 0.3 sec of a cast, no
  crowd control on the boss, healer triage (tank weighs 1.5, self 0.6: the
  exploitable flaw), target scoring (assist the tank, finish the wounded, answer
  attackers, tunnel vision), and the per-run and per-slot private seeds.
- **Driver** (`bot_driver.ts`): thinks every 4 ticks (staggered by roster slot),
  moves every tick (walk to role range and line of sight, steer around cover with
  the shared `bots/steer.ts` core, never move while casting), and acts only
  through the real verbs (`castAbility`, `targetEntity`, `startAutoAttack`,
  `moveInput`), pre-checking cooldown, GCD, resource, range and sight so the real
  path never refuses. The party waits idle until Morthen comes within
  `PARTY_ENGAGE_RADIUS` or lands a hit.
- **Kicks:** a bot switches its target to Morthen and drops its own cast to land
  an interrupt (the verbs strike the current target); a pushed-back cast bar is
  the same cast, not a new stimulus.
- **Roles:** tank (pummel a cast after the reaction delay, taunt a minion off the
  healer, sunder to 3, Reaver Strike, auto-attack in melee), healer (shield,
  renew, lesser heal on the triage pick after a reaction delay, smite when all are
  healthy), mage (counterspell a cast, Fire Blast, then Frostbolt or Fireball).

## Dread
- **A `ResourceType` of its own** (`'dread'`, 0 to 100), never rage, energy or mana,
  so no class-keyed or type-keyed branch fires: `updateRegen` has no arm for it
  (no regen, no decay), the respawn and arena top-offs fall to 0.
- **The profile owns the bar.** `applyMorthenProfile` sets the type and maximum and
  takes the pool from BEFORE the recalc (`carriedDread`), because the base pass has
  already reset the resource for the real class. The identity landing starts it at 0;
  removal hands the real type back through the recalc, and the teardown's pool
  restore puts the exact real value back.
- **Earned** from every hit landed (`dreadFromDamageDealt`, called from the
  rage-from-damage hook in `combat/damage.ts`, rate `DREAD_PER_DAMAGE` rounded to a
  whole point per hit so the pool stays an integer) and from
  Gravecall's `gainResource`. **Spent** by Shadow Pulse (30) and Barrow Shroud (40)
  through the ordinary cost path; a short cast is refused with "Not enough Dread!"
  (both cost checks in `casting_lifecycle.ts`), re-localized by
  `error_text_i18n_core.ts` into a `devCommand.graveyardShift.*` key.
- **Not persisted.** Offline only; `persistedResource` would write a warrior's Dread
  as rage and a mana class's stale `savedMana` (pinned in `tests/dread_resource.test.ts`),
  a step of its own (save override, client mirror).

## Skeleton allies
- **Two temporary necromancy skeletons** (`run_allies.ts`, `necromancy_skeletal_warrior`
  through `summonUndead`, dominion bypassed) rise at Morthen's sides at his level.
  Owned by him (so the hostility rule resolves them to Morthen), never his pet (no pet
  slot, no pet save), dismissed by the teardown.
- **Passive until the party engages**, then the pet AI's aggressive stance: an
  aggressive pet would pick the waiting party from across the chamber and start the
  fight on its own. Pet commands stay locked while Morthen (no Hold or Attack yet).
- **An ally falling within `ALLY_DEATH_DREAD_RADIUS` of Morthen feeds his Dread**
  (`ALLY_DEATH_DREAD`, once per ally), the concept's second Dread source.
- The party treats them as adds: the tank taunts one off the healer, and damage
  dealers may tunnel on them (the exploitable flaw).

## Kit effects
- **Three effect kinds of their own** (`gshiftMark`, `gshiftMarkBurst`,
  `gshiftRaiseFallen` in the `AbilityEffect` union), reached from
  `combat/effect_dispatch.ts` by one-line delegations into `kit_effects.ts`.
- **Barrow mark:** Gravecall stacks a `gshift_mark` aura on its target (up to 3,
  refreshed each hit). **Burst:** Shadow Pulse first deals a bonus per mark to every
  marked enemy it reaches and strips the marks, then its own blast lands.
- **Raise the Fallen:** the nearest corpse within reach that the run has not raised
  (a fallen adventurer or any dead creature) rises as a temporary skeleton owned by
  Morthen (aggressive, tracked with the allies). With nothing to raise, castAbility
  refuses before the cooldown through `graveyardShiftCastError` (both cast paths,
  beside the necromancy check), re-localized by the client error matcher.
- The solo multiplier scales the burst bonus too (`soloEffect`), and the tooltips
  read the resolved effects, so the bar shows what lands.

## The say lines
- **Local only** (`bot_say.ts`): a LIVING adventurer speaks a keyed line on the
  `say` channel, pid-routed to every player within `SAY_RANGE` of it (the
  `emitMobYell` shape, never `Sim.chat()`); the dead are silent and nothing rides
  party chat. The event carries `textKey` (`devCommand.graveyardShift.say.*`) and
  the English as `text`; the HUD's say line and bubble render it through
  `localizeChatBody`, so player-authored say (no key) stays verbatim.
- **Observed state, never a timer:** the `engaged` flip (notice), an adventurer
  going down (death), the healer under 15 percent mana (oom), two down or the
  living party under 35 percent average health (wipe threat), each on its edge;
  a loss (`pendingOutcome` 'lost' or a dead owner) makes a living bot say a win
  line on the tick the teardown runs, ahead of it in the run loop.
- **Pacing:** an observed event waits up to 10 sec for a voice (first in, first
  said); one line per 3 sec across the party, 10 sec per bot, no line twice in a
  run. The closing win line skips the cooldowns (the teardown follows it).
- **Its own Rng** (`botSaySeed`, salted off the run seed): the speaker and line
  draws never touch the shared stream or the bots' brain rngs. The state rides
  the run (`run.say`), created on the first tick. The pools are `bot_lines.ts`.

## Known limits of the shell (each owned by a later lot)
- **A non-damage death still runs `handleDeath`** (death counter, deeds death
  hooks, the `playerDeath` event). Lethal damage is clamped first; only `/dev kill`
  and other direct `handleDeath` paths reach it, and the watch then ends the run.
- **The slot has no exit object** (`exitId === null`), so everything that resolves a
  claim through `claimedInstanceAt` / `instanceClaimIdAt` (the instance combat hold,
  corpse rebinding, unstuck lookups) treats it as unclaimed. In-run Unstuck refuses.
  Revisit when mobs and bots arrive.

- **Session damage tallies count.** `meta.counters.damageDealt` / `damageTaken`
  (session-only `RewardCounters`, never persisted) include the run's blows; kills,
  deaths, XP, loot, honor and deeds do not move.
- **Morthen ignores stat auras.** `applyMorthenProfile` overwrites every field a
  recalc folds auras into (armor, haste, power, crit, dodge, maxHp), so a buff or a
  debuff on him (an armor cut, an attack slow, an AP debuff) changes nothing. Decide
  when bots fight him: fold aura deltas over the template, or keep the boss inert.

## Modules
| File | Owns |
|---|---|
| `run_state.ts` | `GraveyardShiftRun`, its key, the owner lookup |
| `run_layout.ts` | pure placements as slot-origin offsets (the borrowed dungeon id, the arrival point, the door drop) |
| `run_slot.ts` | claim and release of the private Crypt slot |
| `morthen_identity.ts` | pure leaf: the identity aura, `hasMorthenIdentity`, the bare gear sentinels, `morthenBlocksAura` |
| `morthen_profile.ts` | `applyMorthenProfile` and the pinned level, from the `morthen` template |
| `morthen_transform.ts` | `applyMorthenIdentity` / `removeMorthenIdentity`, `knownAbilitiesFor` |
| `kit.ts` | the mode-local kit `AbilityDef`s and their `KnownAbility` list |
| `run_party.ts` | the fixed party, its spawn after the identity and its removal |
| `hostility.ts` | pure leaf: the adventurer marker and the Morthen-versus-adventurer pair rule |
| `death_intercept.ts` | the lethal-blow clamp `dealDamage` calls |
| `run_allies.ts` | the two skeleton allies: spawn, engage stance, Dread on death, dismissal |
| `bot_brain.ts` | pure leaf: reaction, interrupt and control rules, triage, target scoring, seeds |
| `bot_driver.ts` | the per-tick party driver through the real player verbs |
| `dread.ts` | pure leaf: the Dread rate, the damage hook, the carry rule |
| `kit_effects.ts` | the barrow mark, the mark burst, Raise the Fallen and its cast refusal |
| `bot_lines.ts` | pure leaf: the say pools per trigger (line id, catalog key, English, role limits) |
| `bot_say.ts` | the say observer: triggers, pacing, the private say Rng, the pid-routed emit |
| `run_lifecycle.ts` | `canStartGraveyardShift`, `startGraveyardShift`, `endGraveyardShift`, `updateGraveyardShift` (the one tick entry, called just before the delve runs) |
| `index.ts` | the public barrel |

`sim.ts` and the dev command use the barrel. A combat, instance or spirit module
that later needs a predicate from here imports the LEAF module, never the barrel:
the barrel pulls in the lifecycle, which imports those same modules back.
