<!-- src/sim/moderation/: operator-applied sanction state the sim wears. Repo-wide
     architecture/invariants live in the ROOT CLAUDE.md; sim-local rules in
     src/sim/CLAUDE.md. This file is only this subsystem's local contract. -->

# src/sim/moderation/: sanctions the sim wears

Host-agnostic state for sanctions an operator applies from the admin dashboard
and the sim then displays. Pure leaf modules: no `SimContext`, no `Rng`, no wall
clock. Every function takes the caller's elapsed seconds or its own state, so the
identical math runs in the offline browser `Sim`, on the authoritative server,
and in the headless RL env.

Import through `index.ts`, never from a module directly.

## The one rule: a sanction here is VISIBILITY, never POWER

Nothing in this directory may change a stat, a cooldown, a resource, a drop, or
any combat outcome. This is the same rule the Book of Deeds lives under
(`docs/design/deeds.md`: cosmetic-only, never power), for the same reason: a
sanction that also handicaps is a balance change applied by an operator with no
review, and it silently makes the player's every subsequent match unfair to the
people they are matched against.

`cheater_mark.ts` holds that line in three places, and a change to any of them
needs a maintainer decision:
- the aura carries `value: 0`,
- its `kind` is the dedicated inert `'cheater_mark'` rather than a zeroed borrow
  of a real debuff kind, so no later tuning pass can give it an effect by
  editing a shared constant,
- no arm of the stat fold in `entity.ts` matches that kind.

`tests/cheater_mark.test.ts` pins all three.

## `cheater_mark.ts`: the Cheater tag

An ACCOUNT-scoped tag every character on the account wears until a budget of
PLAYED seconds is burned down.

- **Account-scoped, not character-scoped.** The mark lives on `accounts`; the
  server pushes the remaining budget into the world at join through
  `Sim.setCheaterMark`, which puts it on the aura (the sim keeps no other copy),
  and reads it back off that aura on save. Rolling an alt does not escape it.
- **Played seconds, never wall clock.** A wall-clock sanction expires while the
  account is logged out, which is precisely the window a sanctioned player waits
  out. The budget burns only while the character is ALIVE in world.
- **The aura IS the timer.** While a character is alive in world, one second of
  sim time is one second of played time, so the ordinary aura tick is already the
  correct countdown. Do not add a second timer, and do not keep a second copy of
  the remaining budget on `PlayerMeta` or the entity: two clocks drift. The only
  companion state is `Entity.cheaterMark`, a bare BOOLEAN the wire carries so a
  nearby client can render the tag without being told the wearer's countdown.
  - **It pauses while dead**, corpse and ghost alike, because `updateAuras`
    (`../combat/auras.ts`) returns early for a dead entity and no aura's
    `remaining` decrements. That is deliberate and matches the recovery
    sicknesses (`../types.ts`, `cauterize_fatigue`): a sanction whose point is
    being WORN in front of other players is not served by a parked corpse, so
    the aura clock is intentionally the alive-in-world clock and runs slower
    than raw `/played`. Never "fix" this by special-casing the mark above that
    early return: it is a tick-phase change and needs a fresh parity run.
    `tests/cheater_mark_lifecycle.test.ts` pins the pause.
- **The tag is not a deed.** `WireEntity.title` carries a deed id resolved
  through `DEEDS`. Routing the tag there would put a punishment in a cosmetic
  reward catalogue AND make it removable through the ordinary title picker
  (`setActiveTitle` accepts `null` from the player). It rides its own wire field
  so no player-driven command can reach it.
- **Two guards against being shed, not one.** `undispellable` for the same reason
  the recovery sicknesses carry it (see `applySickness` in `../spirit.ts`): a
  penalty a dispel, a cleanse, or a right-click can shed is not a penalty. AND the
  PHYSICAL school, which `isDispellableAura` (`../aura_classify.ts`) refuses
  independently of that flag, the way the repo's other inert markers
  (`flag_carried`, `internal_cd`) already do. One boolean is one careless edit
  away from making the tag dispel food; the school is the guard that holds
  without it.
- **Nothing but the sanction ending takes it off.** Exactly three things clear the
  mark: its own countdown reaching zero (the natural-expiry hook in
  `../combat/auras.ts`, which also drops the wire flag), an operator lift
  (`Sim.setCheaterMark(0)`, which emits the ordinary aura fade), and the budget
  being written back at logout for the next session to resume. Every wipe a
  player can trigger preserves it: death and every respawn/resurrect path
  (`aurasSurvivingDeath`), arena entry and Fiesta down (`aurasSurvivingCleanSlate`),
  both in `../resurrection.ts`. `tests/cheater_mark_lifecycle.test.ts` pins all of
  them, because a sanction with an escape hatch is not a sanction.
- **Not on a party or raid frame.** Those frames cap how many auras they draw and
  sort harmful ones first, so a marked raider's tag would push a real dispellable
  debuff off their healer's frame. That is an information handicap, which the one
  rule above forbids as squarely as a stat change would be, so
  `isPartyFrameRelevantAura` excludes the kind. The tag's render surfaces are the
  nameplate and the target frame.

Absent-when-empty throughout: an unmarked account's save and wire stay
byte-identical to what they were before this system existed, and every flag write
uses the absent form (`undefined`), never `false`.
