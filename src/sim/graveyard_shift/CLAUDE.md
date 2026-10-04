# src/sim/graveyard_shift - the Graveyard Shift side adventure

The player covers Morthen's shift in a private copy of the Hollow Crypt against a
party of adventurer bots. Concept and lot plan live outside the repo while this is
a prototype; this directory is built lot by lot. Today: the RUN SHELL (enter,
exit, survive every exit), the MORTHEN IDENTITY (the owner becomes Morthen in
the sim, on his own Dread bar: `dread.ts`), the ADVENTURER PARTY (five bots,
hostility, win and loss), the PARTY BRAIN (the bots fight like a pickup group)
Morthen's SKELETON ALLIES, the KIT EFFECTS (Raise the Fallen) and the SAY LINES
(the living bots talk aloud, heard only up close).

## Contract
- **Offline only while a prototype.** `canStartGraveyardShift` refuses unless
  `ctx.cfg.offlineHost` (set only by `src/game/offline_world_config.ts`, and the
  offline world itself is offered in dev builds only: `src/game/offline_mode_gate.ts`,
  so no production player can reach the grave yet); the dev entry also needs
  `ctx.devCommands`. Lifting this gate is the online work in progress (the
  save override below is in; client mirror and a per-viewer grave gate to come),
  and so is moving the mode's player-visible
  strings (grave and Staff Exit labels, Tibbs, hints, say lines) out of
  `devCommand.graveyardShift.*` into a player namespace with their non-Latin fills:
  the M16 guard skips `devCommand.` keys, which is only right while the mode is a
  dev-gated prototype.
- **Two ways in.** `/dev graveyardshift` (`src/sim/dev/graveyard_shift_dev.ts`,
  dev-channel English with a `[dev]` prefix) and the grave (`grave_entry.ts`, the
  pure leaf the renderer and client share, and `grave_staging.ts`): on the offline
  host the Glowing Grave by the Hollow Crypt spawns only while the player is
  eligible (level 15, Cryptbreaker or the Crypt quest, and the shift not yet won: it can be won once), so an ineligible player
  simply has no grave; touching it raises Tibbs <Mob Union Rep> (a dynamic NPC on a
  stable id, his caller and tick on his entity) and emits `graveyardShiftOffer`; the
  client's dialogue sends [Take the shift] as a targeted interact on Tibbs
  (`acceptGraveyardShiftFromTibbs`, honoured only from the player who woke him and
  re-checking eligibility, so a stale dialog after the win gets his 'covered' line;
  a refusal is one keyed Tibbs line). After a won shift his dialog shows only
  his closing line. Tibbs goes
  back down when his caller walks off, starts the shift or leaves him idle. A won
  grave shift grants the hidden `hid_boss_for_a_day` deed the moment the fight is
  won (`startWonOutro`, so its banner and sound mark the end of the fight). A grave
  shift (`run.entry`) ends back in front of the grave: Tibbs rises and a
  `graveyardShiftOffer` event carrying his report opens his NPC dialog (no say
  bubbles): on a win the counts and `GRAVEYARD_SHIFT_PAYOUT_COPPER` (20 silver,
  paid WITH the deed at the win, `payBossForADay`, so one save carries both and
  neither a crash nor an early logout loses it), on a loss his consolation and
  a fresh offer; an aborted one says nothing. A `/dev` shift
  pays nothing and grants no deed.
- **Leaving closes the run first.** `graveyardShiftResolveLeave` ends the run
  synchronously (a won scene keeps its win, anything else aborts; no Tibbs for a
  leaver). The server calls it from `server/graveyard_shift_session.ts` on a
  dropped connection (before the safety flush), on logout (before the leave
  save, with the other modes' desertions) and on a jail sentence (before the
  return point is captured), and refuses a hotbar layout upload while the
  identity is on. The parse segmenter skips a run's slot (`isGraveyardShiftRunKey`).
- **Saves write the real character.** `serializeCharacter` routes its result
  through `graveyardShiftSaveState` (`save_override.ts`, the `meta.fiestaRestore`
  precedent): for a run's owner a save writes the parked level and talents, the
  snapshotted pools, cooldowns and sickness, the real resource, a living body in
  front of the grave (or at the Crypt door for a dev run). Every save path reads
  `serializeCharacter` (autosave, a dropped socket's flush, logout, shutdown, the
  deed unlock's save, the leaderboard level), so none can persist Morthen.
- **State on Sim.** Runs live in `Sim.graveyardShiftRuns` (owner pid to run),
  exposed as the `ctx.graveyardShiftRuns` live view. Modules here hold functions.
- **Zero shared rng from this module.** Nothing here calls `ctx.rng`: starting
  and ending a run draw nothing, and with no run the tick entry only checks the
  offline grave (no draw), so a world without a run is byte-identical to one
  without this module (pinned in `tests/graveyard_shift_run.test.ts`). Once the
  fight runs (the opening starts it at once), combat rolls draw from the shared
  stream like any fight.
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
  (the createMob formula), then the solo multipliers (`MORTHEN_SOLO_HP_MULT` x2.2,
  rounded to a whole point, `MORTHEN_SOLO_DAMAGE_MULT` x2 on the weapon and the
  kit's damage): 2620 hp, 82 to 130 at 2.6 sec, 234 armor at level 10. Tuned on a
  headless probe against the party of five, the opening and the corpse run: hitting
  only the tank or pressing buttons at random lose; a sharp scripted player wins
  with about a third of his health left. Every recalc path (buff, expiry, equip) therefore
  lands on the same numbers.
- **No cast pushback:** the profile sets `castPushbackReduction` to 1, as for a
  boss. The classic player pushback is uncapped per hit, so five adventurers
  landing hits kept Shadow Pulse from ever finishing; kicks still cut it.
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
- **The kit rides the real bars:** the client shows it on the normal action bar,
  touch ring and cross hotbar as a possess-bar override (`src/game/morthen_controls.ts`);
  both layouts freeze their writers while it is on, and `Sim.actionBarReadOnly` is also
  true while the offline primary holds the identity, so nothing prunes or saves them.

## The adventurer party
- **Real players with no client** (`run_party.ts`): `ctx.addPlayer` (bot join,
  greeting already sent), level 10, in the room before Morthen's chamber, out of
  his say range and notice radius, in a fixed roster order: warrior tank
  Bulwarkbro, priest healer Mendolyn, mage Pyrotechnic, hunter Arrowsmith, rogue
  Stabbyjoe (the concept's classic five; no hunter pet, owner decision).
- **The opening** (`run_opening.ts`, the concept's soft start): the party is
  already fighting the last pack (two crypt shamblers and an acolyte, Morthen's
  own, on the pet AI's aggressive stance, aggro on the tank, at
  `GRAVEYARD_SHIFT_PACK_HP_FRACTION` of their health: a fresh pack of elites, with
  his skeletons, won the shift for him whatever he pressed), and the monsters it
  cleared on the way in lie dead toward the entrance on the Crypt's own spawn
  spots (ownerless, so Raise the Fallen can take them). The pack rides
  `run.allyIds`; the corpses `run.corpseIds`; the teardown drops both.
  No `PlayerMeta` flag (never
  `isDevBot`) and never a `characterId`; membership is the run's roster plus the
  permanent `gshift_adventurer` marker aura.
- **Hostility** (`hostility.ts`): one pure pair rule on the two entities' auras,
  Morthen against an adventurer both ways, adventurers friendly to each other.
  `Sim.isHostileTo` adds it as its own player arm (never through world PvP, so no
  honor or stake is paid), and the client reads the same rule in
  `pvp_hostile_core.ts` (red names, hostile frame) and `game/interactions.ts`
  (attack cursor, right-click attack).
- **Corpse run** (`corpse_run.ts`): a fallen adventurer lies silent, releases after
  `CORPSE_RELEASE_TICKS` (the living call it out; the body stays raisable), and
  after `CORPSE_RETURN_TICKS` walks back in alive at the Crypt entrance with the
  instance re-entry pools (`RES_HP_FRACTION`), its marker aura back on and a fresh
  brain; it announces its return once within say range. One corpse run each: a
  second death is final. A whole-party wipe in round one is not a win: they all run
  back together. A raised corpse leaves with its owner (`raisedCorpseIds` forgets it).
- **The ending is played in the Crypt** (`outro.ts`, markers in the pure leaf
  `shift_end_marks.ts` the renderer, HUD and dungeon exit import). A loss holds
  `LOSS_OUTRO_TICKS`: Morthen wears the Defeated aura (a `stun`-kind lockout pushed
  past his CC immunity; the client poses the living body dead through the Impaled
  effect bit, draws no stun band, and fades to black over the last
  `LOSS_FADE_TICKS`), never really dies, the party stands down and says its two
  loot lines, the allies are dismissed, then the teardown. A win removes whoever
  is still standing, sets the allies passive and opens the Staff Exit (a stock
  `dungeon_exit` object named `STAFF_EXIT_NAME`, in the slot's `objectIds` so
  freeing the slot removes it) behind the throne; walking into it, or the F-interact
  `leaveDungeon` (intercepted by `graveyardShiftTakesExit` before the stock teleport,
  which would read as abandoning the run), ends the run as a win, and so does
  `WON_OUTRO_MAX_TICKS` or leaving the claim any other way.
- **Win, loss, stall:** every adventurer fallen for good (or gone) wins, and so does
  the give-up: the last one standing with nobody left who can come back says a
  goodbye line and leaves; a lethal blow on
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
  path never refuses. The party engages as soon as anyone is hurt (the pack sees
  to that); it ignores Morthen (no target, no chip damage from the healer) until
  he comes within `PARTY_ENGAGE_RADIUS` of one of them (`run.noticed`).
- **Kicks:** each kicker rolls once per fresh cast whether it notices it at all
  (`BOT_KICK`: tank 45, rogue 30, mage 20 percent; the hunter never presses Counter
  Shot). With every kicker going for every cast, no Pulse ever landed. A bot that
  notices waits out its reaction delay, then, if its interrupt is ready,
  affordable and in reach, switches its target to Morthen and drops its own cast to
  land it (the verbs strike the current target); a pushed-back cast bar is the same
  cast, not a new stimulus.
- **Roles,** built from what the bots really know at level 10: tank (pummel a cast
  after the reaction delay, taunt a minion off the healer, Battle Shout when it is
  missing, Reaver Strike, auto-attack in melee), healer (shield, renew, lesser heal
  on the triage pick after a reaction delay; Shadow Word: Pain, Mind Blast and
  smite on Morthen when everyone is healthy), mage (counterspell a cast, then
  Frostbolt or Fireball), hunter (Auto Shot from range, Serpent Sting kept up,
  Arcane Shot, Raptor Strike inside the dead zone), rogue (kick a cast, Sinister
  Strike, Eviscerate at four combo points, in melee). Control spells they know (Charge's stun, Psychic Scream,
  Polymorph, Frost Nova) are filtered out by the fairness rule.
- **Never into a refusal:** the driver skips a cast while silenced or school-locked
  (Sexton's Chain) and only switches to Morthen for a kick that can go out.

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
  whole point per hit so the pool stays an integer) and from allies falling
  nearby. **Spent** by Shadow Pulse (`SHADOW_PULSE_DREAD`) through the ordinary cost
  path; a short cast is refused with "Not enough Dread!"
  (both cost checks in `casting_lifecycle.ts`), re-localized by
  `error_text_i18n_core.ts` into a `devCommand.graveyardShift.*` key.
- **Never persisted.** A save taken mid-run writes the real resource instead
  (`run.savedResource`, persistedResource at the start; see the save override).

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
- **Three buttons, one idea each** (`kit.ts`; the first playtest found five too many
  to learn mid-fight): Sexton's Chain picks a victim (pull, kick, silence), Shadow
  Pulse is the heavy blast the party tries to kick, Raise the Fallen turns their
  dead against them. The HUD teaches each with one hint line when it first becomes
  useful (`src/ui/hud/vehicle/morthen_hint_view.ts`).
- **One effect kind of its own** (`gshiftRaiseFallen` in the `AbilityEffect` union),
  reached from `combat/effect_dispatch.ts` by a one-line delegation into
  `kit_effects.ts`.
- **Raise the Fallen:** the nearest corpse within reach that the run has not raised
  (a fallen adventurer or any dead creature) rises as a temporary skeleton owned by
  Morthen (aggressive, tracked with the allies). With nothing to raise, castAbility
  refuses before the cooldown through `graveyardShiftCastError` (both cast paths,
  beside the necromancy check), re-localized by the client error matcher.
- The tooltips read the resolved effects (`soloEffect`), so the bar shows what lands.

## The say lines
- **Local only** (`bot_say.ts`): a LIVING adventurer speaks a keyed line on the
  `say` channel, pid-routed to every player within `SAY_RANGE` of it (the
  `emitMobYell` shape, never `Sim.chat()`); the dead are silent and nothing rides
  party chat. The event carries `textKey` (`devCommand.graveyardShift.say.*`) and
  the English as `text`; the HUD's say line and bubble render it through
  `localizeChatBody`, so player-authored say (no key) stays verbatim.
- **Observed state, never a timer:** the party's chatter over the pack once
  Morthen is in earshot and not yet seen (clearing, said by the nearest bot in
  range), the `noticed` flip (notice), an adventurer
  going down (death), the healer under 15 percent mana (oom), two down or the
  living party under 35 percent average health (wipe threat), a fallen one's
  release (corpse run, said by a survivor), a returner coming into earshot
  (returned, said by that returner only), each on its edge; the give-up line is
  said by the last one standing on the tick the teardown runs;
  a loss (`pendingOutcome` 'lost' or a dead owner) makes a living bot say a win
  line on the tick the teardown runs, ahead of it in the run loop. That line
  reaches the chat log only: the teardown removes the speaker before the HUD
  draws, so no bubble shows. An end or a win says nothing.
- **Pacing:** an observed event waits up to 10 sec for a voice (first in, first
  said), then drops; one waiting slot per trigger, so two deaths seen on the
  same tick make one death line. One line per 3 sec across the party, 10 sec
  per bot, no line twice in a run. The closing win line skips the cooldowns
  (the teardown follows it).
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
  The fight runs on plain hate and leash rules; no issue seen in the run tests.

- **Session damage tallies count.** `meta.counters.damageDealt` / `damageTaken`
  (session-only `RewardCounters`, never persisted) include the run's blows; kills,
  deaths, XP, loot, honor and deeds do not move.
- **Morthen ignores stat auras.** `applyMorthenProfile` overwrites every field a
  recalc folds auras into (armor, haste, power, crit, dodge, maxHp), so a buff or a
  debuff on him (an armor cut, an attack slow, an AP debuff) changes nothing. Kept
  inert for the prototype (the party's kit carries no such debuff today); decide
  after the first playtest whether to fold aura deltas over the template.
- **Open after the prototype:** the bots never form a party (their party buffs land
  on themselves only); the nameplate title and the greyed gear window wait for the
  content step; only the ferry counts as a transport refusal; the Raise
  the Fallen slot lights up with no corpse in reach (the cast is refused cleanly);
  `hasMorthenIdentity` is an aura scan on the swing, proc and recalc paths of every
  host, cheap and accepted rather than gated on a run existing.

## Modules
| File | Owns |
|---|---|
| `run_state.ts` | `GraveyardShiftRun`, its key, the owner lookup |
| `run_layout.ts` | pure placements as slot-origin offsets (the borrowed dungeon id, the arrival point, the door drop) |
| `run_slot.ts` | claim and release of the private Crypt slot |
| `morthen_identity.ts` | pure leaf: the identity aura, `hasMorthenIdentity`, the bare gear sentinels, `morthenBlocksAura` |
| `morthen_profile.ts` | `applyMorthenProfile` and the pinned level, from the `morthen` template |
| `morthen_transform.ts` | `applyMorthenIdentity` / `removeMorthenIdentity`, `knownAbilitiesFor` |
| `kit.ts` | the three mode-local kit `AbilityDef`s, their `KnownAbility` list and the bar's slot layout |
| `run_opening.ts` | the opening: the wounded pack fighting the party, the cleared corpses, their teardown |
| `run_party.ts` | the fixed party, its spawn after the identity and its removal |
| `hostility.ts` | pure leaf: the adventurer marker and the Morthen-versus-adventurer pair rule |
| `death_intercept.ts` | the lethal-blow clamp `dealDamage` calls |
| `corpse_run.ts` | the corpse run: release, the walk back in at the entrance, one run each, the give-up and the wipe rules |
| `outro.ts` | the closing scenes: the lost shift's Defeated scene, the won shift's Staff Exit, when each ends |
| `shift_end_marks.ts` | pure leaf: the Defeated aura id, the Staff Exit name and predicates, the outro timings, the `leaveDungeon` intercept |
| `run_allies.ts` | the two skeleton allies: spawn, engage stance, Dread on death, dismissal |
| `bot_brain.ts` | pure leaf: reaction, interrupt, kick-chance and control rules, ranges, triage, target scoring, seeds |
| `bot_driver.ts` | the per-tick party driver through the real player verbs |
| `dread.ts` | pure leaf: the Dread rate, the damage hook, the carry rule |
| `kit_effects.ts` | Raise the Fallen and its cast refusal |
| `bot_lines.ts` | pure leaf: the say pools per trigger (line id, catalog key, English, role limits) |
| `bot_say.ts` | the say observer: triggers, pacing, the private say Rng, the pid-routed emit |
| `grave_entry.ts` | pure leaf: the grave and Tibbs ids and spots, the eligibility rule, the deed id |
| `grave_staging.ts` | the grave spawn, Tibbs' rise, offer, lines and dismissal, the end of a grave shift |
| `save_override.ts` | what a save taken mid-run writes: the owner's real character (`graveyardShiftSaveState`) |
| `run_lifecycle.ts` | `canStartGraveyardShift`, `startGraveyardShift`, `endGraveyardShift`, `updateGraveyardShift` (the one tick entry, called just before the delve runs) |
| `index.ts` | the public barrel |

`sim.ts` and the dev command use the barrel. A combat, instance or spirit module
that later needs a predicate from here imports the LEAF module, never the barrel:
the barrel pulls in the lifecycle, which imports those same modules back.
