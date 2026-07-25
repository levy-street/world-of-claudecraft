# The Source Cave

A dungeon generated at server startup from the GitHub contributors leaderboard: one mob per
contributor, named after them, with body, colour, weapon, and rank derived from their real
merged-PR count. The top-ranked contributor is the boss. Contributors start friendly in a
single arena around a centre reboot button and a stone seal that charges as the raid
gathers on it. Pressing the button turns the roster hostile and starts deterministic
weak-to-strong waves. Access is level 20, once per day; clearing it arms a reward chest.

The roster refreshes itself at each server restart, so a new contributor joins the cave
with no content authoring.

## Index

**Living** (source of truth for intent, though the code always wins on specifics):

- [state.md](state.md): the decisions the code was built against (D1 to D10), the
  constraints it must keep, the open items, and the traps. **Cited by identifier from code
  comments and tests**, so keep the D and O numbering stable.
- [encirclement-waves.md](encirclement-waves.md): the encounter contract. Wave composition,
  the fixed combat budget and overflow guardians, seal and breach rules, reset and exit
  rules, and the balance matrix from the deterministic raid probe.
- [friendly-reboot.md](friendly-reboot.md): the room and its objects. Friendly arrival, the
  reboot button, the sealed-then-armed reward chest and its loot distribution, the
  mains-to-backup lighting, and the reaction chorus.

**Historical record** (how it was built; read as history, not as a plan):

- [final-report.md](final-report.md): what shipped, the surface it added, how it was
  verified, and the two bugs no test caught.

## Working on the cave

Read the `src/sim/source_cave/` barrel first, then [state.md](state.md)'s gotchas section
before touching anything: several of them (the frozen `DUNGEONS` table, ctor-time entity id
draw order, and the synthetic templateId deliberately absent from `MOBS`) have each already
cost a real bug.

Balance numbers live in `src/sim/source_cave/tier_profiles.ts` and `encounter.ts`, never in
these docs, so there is one place to change them. Retune with the probe
(`npx tsx scripts/source_cave_probe_runner.ts`) rather than by eye.
