# Buddy companions: acquisition and cosmetics

Status: implemented on the buddy branch (2026-09-09), owner plan. Content rates
are placeholders marked CALIBRATE in the tables.

## The shape

Buddies are rare. They are the culmination of hard work or a rare reward for a
challenging fight. Mounts already fill the "cosmetic you can buy or farm in a
dozen ways" space; buddies fill a different one, so a companion is never bag
loot and never a gold vendor row.

A companion **attaches to the character**: ownership is the per-character
collection (`PlayerMeta.buddies`, persisted as `CharacterState.buddies`), never
an item in a bag. Nothing about a companion trades, mails, lists or sells.

There are exactly two ways to a companion, and both are content tables in
`src/sim/content/buddy_sources.ts`:

1. **Boss pets** (`BUDDY_BOSS_DROPS`). A boss kill rolls once per eligible
   player, independently, at very low odds (per-player chance, a heroic rate,
   and an optional heroic-only gate). Nobody loses a roll to a party member.
   A win does not drop an item: the companion attaches as a *pending* buddy,
   the player reads a per-companion "presence" line in chat, and the buddy
   reveals itself (owned, announced, summoned) when they walk out of the
   instance or `BUDDY_WORLD_REVEAL_DISTANCE` away from a world boss. Logging
   out with a pending companion is safe: it reveals at the next join.
2. **Achievement pets** (`BUDDY_DEED_REWARDS`). A Book of Deeds entry names a
   companion; earning the deed grants it outright, retro grants included. A
   character who earned the deed before the pet was authored receives it at
   their next login.

The two prestige-currency companions keep their vendor rows: Proud Grunt for
honor at the Warfare stores (the "honour-bought pet" the ladder cosmetic hangs
off) and Loot Goblin for Heroic Marks. Penny Goldspark lost her 1000g row and
has no source until one is authored; the Hunting window says so.

### Grant tokens

The whistle items survive only as **grant tokens**: soulbound, consumed on use,
attaching the companion. No loot table lists one. A duplicate token is refused
unconsumed. They are the channel a vendor, a letter or an admin grant uses to
hand a companion over, and the reason `/dev give whistle_<key>` still works.

## Cosmetics ("looks")

A look is a per-character unlock (`buddies.cosmetics`), one of which can be
worn per buddy (`buddies.equipped`). The only kind today is a tint: the worn
dye replaces the follower entity's color, which the existing entity-tint
render path already honors (`tint: 'entity'` rigs take it outright; the
baked-texture buddy rigs opt in with `tint: 'cosmetic'`, which leaves the
authored look alone until a cosmetic dyes it). Catalog:
`src/sim/content/buddy_cosmetics.ts`.

Sources, all derived for the Hunting window:

| Source | Table | Mechanism |
|---|---|---|
| Challenge | `BUDDY_COSMETIC_CHALLENGES` | Resolved at the boss's death for every credited player (`src/sim/buddy_challenges.ts`). `speed`: kill within N seconds of the attempt's first damage. `dps`: the player's own damage on the boss over the attempt meets a rate. Both re-arm on evade or respawn. |
| Deed | `BUDDY_COSMETIC_DEED_REWARDS` | Same hook as achievement pets. |
| Crafted | a recipe whose result is a `buddy_cosmetic` token | The Acorn Crown recipe eats the logs of three different woods, gathered in three regions (the "acorns from across the map" shape); a leatherworking craft at the tannery, learned from the master there. Using the charm unlocks the look. |
| Store | a vendor row for a `buddy_cosmetic` token | Gilded Charm at Armorer Hode for plain gold. Honor or marks prices use the same item fields. |
| Seasonal award | `BUDDY_COSMETIC_GRANT_ONLY` | Nothing in the game hands it out; the admin grant endpoint does (below). |

## The seasonal award channel

Monthly PvP-ladder, top-parse-per-boss-and-spec and zodiac/gemstone awards are
decided outside the game (the ladder, the parse service). They land through
`POST /admin/api/moderation/characters/:id/grant-buddy` with `{ buddyKey }` or
`{ cosmeticId }` plus a reason (permission `moderation.act`, audited as
`grant_buddy`). An online target takes the sim's grant path at once; an
offline target is queued in `character_buddy_grants` and drained at the next
join (`server/buddy_wire.ts`). Zodiac pets and gemstone looks are content
records added to the two catalogs as each month's award is authored.

## Player surfaces

- Hunting window (Shift+C): the companion's own name, a Summon/Dismiss button
  for a collected buddy, the source lines (per-player boss rolls with the
  heroic rate, the deed, the token vendor), the pending state, and a Looks list
  with unlock state, sources and Wear/Remove.
- Chat: `buddyPresence`, `buddyRevealed`, `buddyCosmeticUnlocked` are text-free
  events rendered by `src/ui/buddy_event_lines.ts`.
- The bare buddy keybind dismisses, or re-summons the last companion out; the
  last companion also walks back out at login.
- Dev: `/dev buddies` (collect everything), `/dev buddy <key>` (stage a boss
  win at your feet), `/dev buddylook <id>`.

## Determinism

The per-player roll draws `rng.chance()` once per (player, row) only for a boss
with rows; ordinary kills draw nothing. The old per-kill whistle tiers and the
fishing catch slice are gone, so every parity golden that kills a mob or lands
a catch was re-minted with the change. The challenge tracker and the reveal
sweep draw no rng.
