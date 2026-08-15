# The Reliquary: collection log, spoils, and Curator prestige

The permanent trophy cabinet for unique spoils, clear counts, and curated
collections. One deterministic sim system, cosmetic-only prestige, a server
that observes but never invents outcomes. This page is the system in brief
plus the contract every new Reliquary page (and every new piece of
conquerable unique loot) must follow.

Companion documents: Book of Deeds at `docs/design/deeds.md` (achievements;
orthogonal surface), professions at `docs/design/professions.md`, interface
standard at `DESIGN.md`.

## Vocabulary (player-facing, all rendered through t())

| Term | Meaning |
|---|---|
| Reliquary | The window and the system (default keybind beside Book of Deeds). |
| Shelf | Top-level category: Conquerors, Professions, Horizons (and Overview). |
| Page | One boss, dungeon, delve, raid wing, profession gallery, or horizon group. |
| Relic | One unique slot on a page (item id, profession mark, mount, skin, title). |
| Clear count | Lifetime clears / kills credited for that page's source. |
| Illumination | Completing every relic on a page (first-time celebration). |
| Curator rank | Cosmetic completion tiers over character-durable catalogued fills (items, marks, mounts, titles). Account weapon skins never score rank, so grants and display stay aligned. Five ranks at 1 / 10 / 25 / 50 / 100 owned (`apprentice`, `keeper`, `master`, `grand`, `eternal`, in `src/sim/reliquary.ts`). The thresholds are deliberately NOT rescaled as the catalog grows: rank 5 stays at 100 owned. |
| First find | Optional metadata on a filled relic: clear# (and source) at first obtain. |
| Obtain count | How many times a filled relic has been taken from the world. Information on a tooltip, never a score. |

Do not call this a "collection log" in player copy. Do not reference other
games products in code comments, docs, commits, or player strings.

## What it is (and is not)

| Reliquary | Book of Deeds |
|---|---|
| What you have **taken** / filled | What you have **accomplished** |
| Continuous grids and clear counts | Thresholds, skill, story, Renown |
| Silhouettes of missing uniques | Criteria text and progress bars |
| Curator ranks (cosmetic) | Renown board (scoring set) |

Both are permanent prestige surfaces. They pair; they do not merge.

## Architecture

Catalog is data-as-code: `src/sim/content/reliquary.ts` exports shelves,
pages, and relic definitions. Runtime evaluation lives in
`src/sim/reliquary.ts` behind the `SimContext` seam (module-first; never grow
`sim.ts` with Reliquary method banks). Ownership of **item** relics reuses
`deedStats.itemsDiscovered` via the existing first-obtain hub
`markItemDiscovered` (`src/sim/deeds.ts`). Reliquary-specific state is a
**bounded, allowlist-only** sibling on `PlayerMeta` (first-find meta,
profession lifetime marks, derived or stored curator progress). Render and
UI talk only through `IWorldReliquary` (facet under `src/world_api/`); the
window is pure `reliquary_view.ts` + cold `reliquary_window.ts` painter.

The server remains observer: character blob autosave (30s) carries the
sparse Reliquary fields; no per-relic SQL table and no per-drop save storm.

## Rules that bind every page and relic

1. **Cosmetic only.** Curator ranks, Illumination seals, titles, borders,
   window chrome flourishes: never power, convenience, drop rate, or
   actionable combat information.
2. **Luck never scores Renown.** Filling a luck page may complete zero-Renown
   collection deeds (existing `col_*` doctrine) but must not invent a second
   competitive score. See `docs/design/deeds.md` rules 1 to 2.
3. **Bounded by construction.** Reliquary state membership is limited to
   authored catalog ids (and existing discovery sets already bounded by the
   live `ITEMS` catalog). Never log trash commons, never unbounded history
   streams, never per-drop timestamps for non-relics.
4. **First obtain at grant, not at roll.** Credit only when the item enters
   the player through `addItem` / `addItemInstance` / `markItemDiscovered`
   (need/greed winner, personal world-boss take, craft grant). Do not mark
   on corpse roll alone.
5. **Item-global ownership, multi-page fill.** Owning a unique item id fills
   every page that lists that id (shared uniques are intentional).
6. **Clear counts are outcomes already tracked.** Prefer
   `deedStats.dungeonClears`, `delveClears`, and any bounded world-boss
   counters. Add a new counter only when no existing site credits the
   source, and only for authored page sources.
7. **No permanently missable relics** for live content. Seasonal or retired
   pages become Feats-style shelves (visible, labeled retired) rather than
   silent deletes. A page nobody can finish (retired content, or a
   class-personal grant like the Riftbound bands) carries
   `excludeFromCompletion` naming which of the two it is, and drops out of
   BOTH sides of every completion pair and all completion deeds; its own
   page-local pair still renders, so a player still sees the part they hold.
   Illumination follows the local pair, which only the retired case can
   complete (a veteran holding the whole vault still gets the celebration);
   a personal page can never fill, so it never illuminates.
8. **Same-change authoring.** Every new dungeon, delve, raid, world boss,
   rare, or unique loot table that should appear in the Reliquary authors
   its page(s) in the **same change** that lands the content. Content tests
   pin pages against real loot / set / mount tables so catalogs cannot drift.
9. **Performance is part of the design.** See the performance contract
   below. A beautiful Reliquary that doubles character-blob write cost or
   heavy-self wire size is a defect.
10. **English-only new player strings** in the matching i18n catalog domain;
    sim/server stay language-agnostic (ids + values; client localizes).

## Performance contract (load-bearing)

| Rule | Detail |
|---|---|
| No per-drop character save | Pure relic fills ride the existing 30s autosave and leave/shutdown saves. Immediate `saveCharacter` only when a durability-critical grant already exists (e.g. deed unlock that grants a title), never "because a silhouette filled." |
| No second full discovery set | Item ownership = `itemsDiscovered`. Do not dual-write a parallel set of every item id. |
| Sparse first-find | `firstFind` / equivalent maps store entries **only** for catalogued relic item ids on first fill. Zero-default omit on serialize. |
| Bounded profession marks | Lifetime profession trophies are authored mark ids (recipe, event flavor, milestone), not every craft. Prefer reusing `visited` namespaces (`gather_event:*`) when they already exist. |
| Wire thrift | Presentation: id-only `reliquaryUnlock` (or reuse a narrow discovery signal). Do not re-send full inventory on every loot when the id was already known. Heavy self may carry a **small** sparse Reliquary blob that changes only when membership grows. Prefer digests / counts for overview while the window is closed. The blob is **memoized** (`reliquaryWireJson`): built once per state CHANGE, not once per heavy tick, so a staggered refresh with nothing moved re-serializes nothing. Delta semantics are unchanged by that: an absent key still means "unchanged, keep the mirror". |
| Obtain counts cost | Read this production-absolute, not against the branch: the Reliquary has never shipped, so **no production row carries the key at all today** and every byte below is new. Measured worst case, a veteran with the whole catalog as of v0.36.0 (135 item relics then, 10 marks, a full recent ring; the byte figures date the same way and re-measure at catalog growth): the character row grows about **+1,772 stored bytes** under pglz, and character autosave rewrites the full JSONB, so that is paid every `AUTOSAVE_SECONDS` (30) per online session rather than once. The percentage figure this row once carried is retired: the v0.36.0 gear-set loadouts (`SavedLoadout.gear`, bounded by `MAX_LOADOUTS` x the equip slots x a full-JSON `itemCopyPin`) added a second variable-size surface to the same JSONB, so the row-share denominator is no longer stable; size the Reliquary against its own absolute bound. The headline is distribution-sensitive: it assumes the measured mix of stamped and unstamped entries, and an independent second model (Phase 17 QA migration review) with every entry carrying a clears stamp and multi-digit tallies lands nearer +2,460 stored. **Re-measured at the Phase 21 catalog** (237 catalogued item ids, 29 marks, 35 pages), by taking worst-case `SavedReliquaryState` raw JSON on both trees and scaling the Phase 17 stored figures by the raw ratio: raw goes 6,121 to 10,191 bytes (mid model) and 7,731 to 13,025 (all-stamped), a 1.67x ratio on both, which puts the scaled stored estimates near **+2,950 (mid)** and **+4,150 (all-stamped)**. So size the autosave write amplification against a **4.2 KB bound** (was 2.5 KB) rather than against the mid case. The bound stays catalog-MEMBERSHIP by design even though the realistic ceiling is lower: a character holds at most one of the three Riftbound bands, so two of those ids are unreachable for everyone, and the four Vault of Ages ids are reachable only for pre-v0.25.0 veterans. The component deltas reproduce exactly across both models (dropping pageId and zero-clears gives back 881 stored bytes to the byte). Raw size lands about 15 percent below the pre-fix branch shape, which is the half that helps: cheaper detoast for the seq-scan readers. Carrier vector to watch: for a character whose relics were discovered before the Reliquary ships, the re-obtain carrier entry is the ONLY way `firstFind` entries ever accrue, bounded by the catalog size (v0.36.0: about 2.2 KB stored when full). Intra-branch, kept for the design record: counts cost 371 bytes where dropping the dead `pageId` stamp and the zero-clears entries gave back 881, which is why the tally folds onto the first-find entry instead of shipping as a sibling map. |
| Cold UI | Window is cold: signature-gated rebuild when open (Book of Deeds pattern). No per-frame full grid rebuild. The always-on HUD tracker shipped in Phase 15 and is a separate pure core (`src/ui/reliquary_tracker_view.ts`) plus a write-elided painter (`src/ui/reliquary_tracker_painter.ts`), holding pins under `woc_reliquary_pins_<class>_<name>` with a cap equal to `DEED_WATCH_CAP`. |
| Catalog growth is the bound | Every new relic id is a permanent potential blob key for veterans who obtain it. Author pages deliberately; do not auto-include every loot table row without review. |

Character autosave today rewrites full JSONB for every online session every
`AUTOSAVE_SECONDS` (30). Reliquary must not make that worse: keep added
fields small, sparse, and omit-empty.

## Catalog shape (conceptual)

Shelves:

1. **Overview** - total progress, Curator rank, recent finds, nearly complete.
2. **Conquerors** - dungeons (normal/heroic), raids, world bosses, delves, the
   Rift, realm rares, open-world spoils, and the two warfare pages.
3. **Professions** - masterwork gallery, rare field notes, key recipe / specimen trophies.
4. **Horizons** - mounts, weapon skins (account cosmetics), titles earned, and
   the two outside-completion pages (Vault of Ages, retired; Riftbound, personal).

Each page declares: stable id, shelf, display keys (i18n), clear-count
source (or none), ordered relic list (one relic kind per page: items, marks,
mounts, weapon skins, or titles; single-kind is pinned by
tests/reliquary_content.test.ts and the reliquaryUnlock emit path depends on
it), optional links to deeds (`col_*`, clear milestones).

Page shapes beyond the v1 grid, all authored in
`src/sim/content/reliquary.ts` and pinned by `tests/reliquary_content.test.ts`
(read the pins for live totals rather than quoting a number here, per the
repo's anchor rule):

- **Dual clear meters.** A page may declare `secondaryClearSource` alongside
  its primary, so The Rift shows lifetime clears and S-rank clears together.
- **Kill-proof mark pages.** The realm-rares page fills from `slain:*` marks
  rather than item ids, one mark per authored rare.
- **Honor-stock pages.** The warfare pages list purchasable honor gear, which
  has no class gate and no drop roll.
- **Outside-completion pages.** Rule 7's `excludeFromCompletion` pages
  (retired and personal) render their own local pair and drop out of both
  sides of every completion pair.

**Catalog growth reverts page completion.** Adding a relic to a shipped page
lowers the live read for players who had finished it, so a completed page
shows as incomplete again until they find the new relic. This is inherent to
a growing catalog (earned deeds stay sticky, live page reads do not) and will
repeat at every growth. It owes a release-note line whenever a growth ships.

## Adding a page (the recipe)

1. Identify the unique set from live content (`HEROIC_BOSS_LOOT`, set members
   in `item_sets.ts`, delve items, world boss table, mount reins, etc.).
2. Append the page at the end of the catalog table (append-only order if
   order is derived from table order; otherwise use an explicit order list).
3. Ensure every relic id exists in the live content tables; pin with a
   content test that fails if loot tables drop a referenced id.
4. If clears are missing for the source, add a bounded counter and bump it
   at the existing gameplay site (same tick discipline as deeds).
5. UI and wiki pick up the page from the catalog; no hand-listed HTML.
6. If the page is conquerable content, deeds for that content still follow
   `docs/design/deeds.md` in the same change when required by the content
   rule.

## Surfaces

| Surface | Notes |
|---|---|
| Reliquary window | Primary; DESIGN.md window grammar; mobile full-bleed. |
| HUD tracker | Always-on pinned-page strip beside the deed tracker; pins persist per character. |
| Live toast / combat log | Relic logged; page Illumination; rank up. All four emitters are node-built and clickable, deep-linking to the page. |
| Book of Deeds | Unchanged; optional soft links from collection deeds. Also hosts the "Titles and Borders" shelf where a border is picked. |
| Nameplate and portrait rings | The active border renders in-world as a slug-keyed accent (cosmetic only; carries no actionable information). |
| Inspect card | Curator standing line, border accent, and the rank-5 Curator sigil (identity-wire note below). |
| Character sheet / public sheet | Completion pair, Curator rank (labeled set/scope), and the capped recent-finds strip (ids and kinds; privacy note below). |
| Wiki `/wiki` | Spoiler-safe catalog of pages and relic names, with the rule-7 outside-completion label (Retired / Personal tag plus note) on flagged pages; no personal progress. Also indexed by guide search. |
| Population rarity | Two optional lines (relic tooltip, page header) served from an anonymous aggregate endpoint; online only, absent offline (section below). |
| Discord / marquee | Optional marquee only for full-page Illumination or high Curator ranks; never spam per-relic. |
| Steam / Epic achievements | Mapped ids mirror the Reliquary deeds to linked storefront profiles (see the mirror note below). |

### Public sheet exposure (privacy note)

The public character sheet (`sheetReliquaryFromState` in
`server/character_sheet.ts`, rendered by the `/c/` page in
`server/profile_page.ts`) carries these Reliquary fields and no others: the
character-scoped completion pair, the Curator rank derived from it, and the
capped recent-finds strip. The strip is ids plus kinds, newest first, bounded
by `SHEET_RECENT_RELICS`; when authored marks sit in the window, up to that
many mark ids surface individually (the full marks SET never does). It fails
closed on any id the live catalog does not know, and it carries no first-find
provenance, no obtain tally, and no timestamp (the recent ring stores none, so
there is nothing to coarsen the way the deeds strip coarsens `earnedAt`). It
rides both visibilities unfiltered because the Reliquary has no hidden concept
to strip: hidden deeds never enter the catalog at all, so the strip cannot
name one.

The missing timestamp bounds what the payload STATES, not what a determined
reader can infer, and the honest version of the claim is worth writing down. A
poller differencing successive reads of one sheet still sees a new entry appear
between two fetches, so it can date each find as coarsely as its poll rate
allows. The floor on that rate is the per-IP public-read budget
(`PUBLIC_READ_MAX_PER_MINUTE` in `server/ratelimit.ts`, shared by the page and
the public sheet read), and a per-IP budget widens with IP rotation. The
`Cache-Control: public, max-age=120` header the `/c/` page serves bounds only a
poller that goes through a shared cache (the origin re-renders per request),
and the JSON sheet read sends no cache header at all. The timing property
itself is one `deeds.recent` already has on the same sheet, where the entry
additionally carries a day-granularity `earnedAt`.

What IS new: the strip is the first PER-ITEM acquisition naming on the
crawlable `/c/` page (`deeds.recent` rides the JSON sheet but the page renders
no deed names), and the ring pushes on every first acquisition, movement finds
included: a trade, a mail, a market buy, an enchant re-mint, an unbind stack
split, or a returned commission pushes the ring exactly like a loot drop
(`pushRecent` is deliberately unchanged on a movement find; a bank withdrawal
is NOT one, it moves slots without re-granting). So "Recent finds" reads as discovery while meaning "recently first
acquired, however acquired", the page is crawlable and archivable, and a relic
later traded away still prints.

The strip is also LOCATION-BEARING, which the earlier wording did not carry: a
`slain:*` entry names a rare whose camp zone is published, so the ring can
place a character at camp granularity within the polling window. The increment
over what `/c/` already exposes is camp-within-zone rather than a new exposure
class (the page already publishes the live zone uncoarsened), but it should be
weighed as part of the strip, not discovered later.

Whether movement acquisitions should push the ring, whether the public arm
should carry the strip at all, and whether any character-level suppression is
wanted are OWNER CALLS recorded under "Open owner calls" below, not decided
here; closing the timing channel itself would be a change to both strips, not a
Reliquary fix. Candidate mitigations if one is ever wanted: an owner-only arm,
a window shuffle, or dropping movement pushes.

One consequence is deliberate and stated here rather than left to be
rediscovered: mount ownership behind that pair reads bags **and** bank, the
same seam live `ownedMounts` uses, so reins sitting in a character's bank score
their completion pair and can carry their Curator rank. An unauthenticated
reader can therefore infer that a character owns reins they have never carried.
Accepted, with the exposure bounded to the aggregate: the sheet publishes an
owned count and a rank, never a mount id, never a bank slot, and never anything
else the bank holds. Narrowing it to bags alone here would also put the public
pair at odds with the collection the owner sees in game, which counts both
containers.

This acceptance covers BOTH audiences, not just the sheet: the entity-wire
standing below is bank-inclusive through the same seam
(`refreshCuratorStanding` scores `characterReliquaryOwnership`, whose mount
surface is live `ownedMounts`), so everyone within interest radius receives
the same bank-derived aggregate the sheet publishes. Because reins trade like
any item, borrowed reins raise the broadcast standing until the next sweep
after they leave; the aggregate bound above is what keeps that a cosmetic
oddity rather than a leak.

Bags-only is a **recorded follow-up and an owner call**, not a defect to fix in
passing: it would visibly drop the pair for every character with banked reins,
so it belongs in its own change that moves the sheet, the window, the Curator
rank bridges, and the wire stamp together.

### Inspect and identity-wire exposure (privacy note)

The public sheet is not the only surface a stranger reads a standing from, and
the inspect card is not gated the way its name suggests. The Curator standing
(the rank plus the character-scoped owned/total pair behind it) rides the ENTITY
IDENTITY record, not an inspect response: `refreshCuratorStanding` in
`server/game.ts` stamps `curatorRank`, `relicsOwned`, and `relicsTotal` on the
player entity, and `wireEntity` encodes them as `crk`, `cro`, and `crt`. Every
client holding that player in interest therefore receives them on first sight
and again on every change. Interest is proximity, not consent: a player enters a
viewer's set at `INTEREST_RADIUS` and persists out to
`PLAYER_INTEREST_DROP_RADIUS` (roughly a hundred yards today; inside a
battleground slot the same record reaches same-team members out to the wider
`BG_MATCH_INTEREST_RADIUS` / `BG_MATCH_DROP_RADIUS` band, per
`bgWideInterestApplies`), so the standing reaches everyone nearby whether or
not one of them ever clicks inspect. That is
a wider audience than the card implies, and the gap between the two is the
reason this note exists.

That is the same audience pattern the `$WOC` holder tier, the developer badge,
and the linked-Discord flair already have, and for the same reason: the
nameplate and the card both need them without a round trip. What rides is a
cosmetic aggregate and nothing else, a rank and a count pair, never a relic id,
a page, a mark, or any per-relic detail. The recent-finds strip stays on the
sheet and never touches the wire.

Cadence is join plus the 60 second flair cycle, the two places
`refreshCuratorStanding` runs, so a third party's view of a rank-up can lag the
real thing by up to a minute. Self-inspect does not: the card reads the owner's
LIVE standing off their own ownership surfaces instead of the mirrored record,
so the owner always sees the true rank at once and only OTHERS ever see the
stale one.

`relicsTotal` (`crt`) rides the wire despite being player-independent, and that
is deliberate rather than redundant. The total is catalog size, and a client on
an older build carries an older catalog; sending the server's total means a
mixed-version client can never print a pair whose denominator disagrees with the
server catalog that produced the numerator.

### Rewards ladder (shipped)

Five zero-Renown collection deeds sit on top of the Curator rank bridges:
two capstones (`col_reliquary_complete` for the whole character catalog,
`col_reliquary_conquerors` for the Conquerors shelf) and three flagship page
Illuminations (Heroic Nythraxis Raid, Thunzharr, Heroic Gravewyrm Sanctum),
all title rewards, all sticky (catalog growth lowers the live read but never
revokes the earned record). `col_reliquary_complete` carries `feat: true`
(the one off-prefix feat, pinned): it is a dynamic meta over a growing
catalog, so it stays out of `feat_book_complete`'s requirement set and the
Book completion pair, and its title stays off the titles page (the
non-terminating self-reference).

The rank 5 bridge deed's border reward (`reliquary_gilt`, Eternal Spoils) is
wearable in-world: one active border per character, selected in the Book of
Deeds beside the title picker, rendered as a slug-keyed accent on the
wearer's nameplate and on the player and target portrait rings (the deeds
design doc owns the border reward definition; palettes live in
`src/ui/deed_border_view.ts`). The rank-up banner and the Overview note say
so at rank 5, and every LIVE border deed unlock logs a wear hint. Retro
back-credits (the on-join catch-up) log no hint at all, by the same rule that
keeps them free of banners and celebration audio; the pure unlock plan is what
draws that line, and `tests/deeds_view.test.ts` pins it.

First-ever page Illumination is a persisted, sticky record
(`illuminatedPages` on the reliquary blob, once per durable record): the
`reliquaryUnlock` event names a page only on its first-ever completion, so
the client banner and the guild/follower marquee inherit once-ever semantics.
The three no-emit Horizons pages (mounts, titles, weapon skins) never fire
an Illumination celebration; their payoff is the deed channel. One consent
flag, `accounts.deed_broadcasts`, covers all celebration broadcasts: deed
marquees, Discord deed and border cards, and illumination marquees.

The storefront mirror is the one exception and is stated here so it is not
mistaken for an oversight: the Steam and Epic achievement maps are NOT gated
by `accounts.deed_broadcasts`, because linking the account is itself the
consent act. A consequence follows from that: the login reconcile pushes
retroactive unlocks for every already-earned mapped deed to a linked player's
PUBLIC storefront profile. Registering the mapped ids on both portals is
therefore release work with a deploy-order constraint, recorded under
"Operational riders" below.

### Population rarity (shipped)

Two optional player-visible lines answer "how rare is this": a relic tooltip
line ("Found by {percent} of collectors") and a page header line
("Illuminated by {percent} of collectors"). Both are read-only flavor. Rule 1
still binds: rarity feeds no completion, rank, drop rate, deed, or reward.

The binding rules, all of them load-bearing:

- **Global, not per realm.** The aggregate is cross-realm by design (the deeds
  rarity precedent): at current population, per-realm percentages would be
  noise. There is no realm predicate in the query. The eligibility filter is
  the shared account filter (ban and suspension only).
- **Aggregate only, anonymous.** `GET /api/reliquary/rarity`
  (`server/reliquary.ts`, a `RouteDef` behind the registry) serves counts and a
  population total, never a character name, id, or roster. It is anonymous and
  public-read rate limited.
- **Tri-kind exclusion.** Weapon skins (account-scoped), titles (deed-scoped),
  and mounts (possession-based, where a cell's id is the mount key rather than
  the reins item id) are never counted, so their absence always renders as no
  line rather than a wrong percentage.
- **Online only, null offline.** The facet member `reliquaryRarity()` returns
  `null` in the offline `Sim`; the UI renders no node for `null`, an empty
  population, or an unknown id. There is no spinner, no placeholder, and no
  English literal on the offline path.
- **Cadence.** One single-flight walk per process, shared with the deeds
  rarity refresh on a 5 minute TTL, so the cost is one walk per TTL per realm
  process (not per request). The deeds slice installs first so a reliquary
  failure can never blank deeds rarity; a failure is negative-cached for one
  TTL, and a carried slice is dropped once it is more than three TTLs stale
  (after which the degraded path serves an empty aggregate, which the null
  gate above renders as no line).
- **Statement allowance is 10 seconds**, deliberately not the 60 second heavy
  tier: three blob scans under a 60 second ceiling could hold one pooled
  client for minutes.

**Numerator caveat, forward-dated.** The page line counts the STICKY
`illuminatedPages` record rather than live completion. Because catalog growth
reverts live page completion (see "Catalog shape") while the sticky record
never revokes, after any future growth the header line will read higher than
the same characters' live page meters. Harmless while the feature is new (no
pre-growth production blobs exist), but a growth that matters should revisit
it.

**Scaling lever, with its trigger.** If the refresh exceeds one second at
production scale, build a `character_relics` observer table on the
`character_deeds` exemplar (idempotent insert at first find, login reconcile)
and convert the blob unnests into indexed `GROUP BY`s. Two measured results
are worth keeping so nobody re-derives them:

- Folding the numerator statements into one pass is **refuted by
  measurement**: folded ran 11 to 17 percent slower at identical buffer
  counts, because Postgres detoasts per expression reference.
- Measured cost: about 62 ms at 1,000 eligible characters, about 269 ms at
  5,000, against a 6.6 to 17.7 ms deeds baseline, and about **2.1 s at 42,000**.
  Note the trigger consequence: the one second bound is crossed near 42,000
  eligible characters, so population alone reaches the lever before any
  round-number character ceiling does. Treat the one second measurement as the
  real trigger.

The Overview "rarest owned relic" card was considered and deliberately not
shipped; the recipe if it is ever wanted is the per-relic rarity fraction
evaluated over the ownership options.

## Deliberately deferred (do not "fix" by shipping)

- Per-drop full loot history: quantity streams, every common, one entry per
  drop, and any timestamp on any of them. Still deferred, and the counts below
  are not a foot in its door.
  - **Sanctioned instead (maintainer, locked decision): grant-time per-relic
    obtain COUNTS.** The counts-only form supersedes this deferral; the history
    form does not become shippable with it. A count is one integer per relic
    and answers "how many", never "when" or "which drop".
  - The rules that keep it counts-only, all of them binding:
    - Catalogued relic ITEM ids only: `isCataloguedRelicItem` gates every
      write, so no common, no mark, no mount, skin, or title has a tally.
    - World-sourced grants only. `noteRelicObtain` runs at the grant hub for
      every acquisition EXCEPT the ones flagged `movement: true`: a trade, a
      mail delivery, a market purchase, a vendor buyback reclaim, an enchant
      re-mint, an unbind stack split, a returned commission. Two players
      handing one relic back and forth must never watch both tallies climb,
      and that is the reading the flag exists to refuse.
    - No timestamps and no per-drop entries, ever. One integer per relic.
    - Sparse and omit-empty on serialize. An absent id costs nothing and
      means "no counted obtain", which is deliberately NOT the same claim as
      "never obtained"; the UI answers it by rendering no line at all.
    - Folded onto the first-find entry on the wire, never a second map.
    - Rule 1 still binds: counts feed no completion, rank, drop rate, deed,
      or reward. They are shown, and nothing consumes them.
- Power rewards, pity timers, or drop-rate buffs for incomplete pages.
- Account-wide item discovery merge (character-scoped like deeds v1 unless
  a later account lane lands).
- Housing museum props (no housing system yet).
- A per-character third-party API. Still deferred: no endpoint may serve one
  character's Reliquary state beyond the existing public sheet fields.
  (Superseded in part: the anonymous population-rarity endpoint above ships an
  AGGREGATE read, which is a deliberate exception to the older blanket wording.
  Aggregate counts plus a population total are sanctioned; per-character reads
  are not.)

## Locked decisions (maintainer rulings; do not re-litigate in passing)

- **Hidden deeds are out of the catalog entirely**, existence included. The
  Titles page is every NON-hidden title-reward deed, and that is the authoring
  rule for the page: a hidden deed never appears on any Reliquary surface,
  including the wiki.
- **No weapon-skin reward at rank 5.** Proposed and vetoed. A future
  rank-reward proposal starts from that.
- **Retro (join catch-up) is silent.** Join-seeded fills raise no banner, play
  no sound, push nothing onto the recent ring, and stamp no clear count; the
  player gets one summary line. Rank bridge deeds granted at join carry a retro
  flag so the server never fans them out to guild or followers. The border wear
  hint follows the same rule: live unlocks log it, retro back-credits do not.
- **Re-pin policy.** A seed or golden re-pin must name its real cause.
  "Inherited red from the release base" is a valid cause. "Feature-branch
  world-gen shift" was investigated and disproven for this feature (it adds no
  world-gen draws; identical recordings at identical seeds on both sides) and
  must not reappear as an attribution.
- **Source-hint vocabulary.** An uncollected silhouette lists EVERY real way to
  get it, in collection-log voice, with multiple hints per relic where multiple
  routes exist. Kinds are `delve`, `rift`, `quest`, `store`, `activity`. All
  weapon skins are `store`. The **Rift gear exclusion is permanent**: derived
  tier-mirror pools paid out as one uniform pick are not a route a player can
  aim at a single relic, so they are not listed. The reins ladder IS such a
  route and is listed.
- **Obtain counts omit at zero, widened.** A movement grant at ANY clear-meter
  value must not stamp a clear count. A market buy at 12 clears must never
  print "first found on clear 12": that is the same fabricated-provenance class
  the zero case refuses. Both the tooltip and the aria line drop together when
  the stamp is absent.

## Migration hazards (one-way contracts)

These are the ways a future edit silently destroys player data. All four are
load-bearing.

- **Reliquary page ids are effectively append-only.** Restore filters
  `illuminatedPages` against live page ids, so renaming or retiring a page
  silently drops every character's sticky illumination record. Treat a page-id
  rename as a MIGRATION, not an edit.
- **Border deed ids are the same.** Removing or renaming a border deed, or
  changing its reward kind, erases every holder's pick at the next
  load-plus-save through the restore validator.
- **A rollback erases border picks.** A rollback or mixed-fleet bounce drops
  the `activeBorder` key on the pre-border serializer's first autosave, about
  30 seconds after login. Any deploy that could roll back past the border
  feature owes a release-note line saying so.
- **Load ordering is a constraint, not an accident.** `activeBorder` is
  re-applied AFTER the earned-deed fill and the legacy-milestone union. A
  future border-flavored legacy milestone must preserve that ordering or
  veterans load borderless.

## Deliberate oddities (pinned; they are not defects)

A future reader will file these as bugs without the record. Each is
intentional and pinned by a test.

- The shelf card's newest thumbnail can surface a find from an
  outside-completion page.
- Shelf-card sums can run above the headline pair: a shelf counts per page
  while the headline de-duplicates a shared unique across pages.
- A capstone holder's Overview can read below its denominator, because the
  earned deed is sticky while the live read follows catalog growth.
- The Book of Deeds Collection shelf carries a denominator that cannot be
  reached, for the same reason.
- **A player's own Riftbound band scores zero** toward Curator rank and both
  completion pairs (the both-sides exclusion of a personal page). An earned
  chase item contributing nothing to the collection score is deliberate; if it
  is ever revisited, the shapes would be a per-relic exclusion or an
  alternates relic kind.

## Growth constraints (read before adding a page)

- **The growth sweep has escape hatches.** The excluded-dungeon and
  world-boss-page lists in `tests/reliquary_content.test.ts` sit on BOTH sides
  of their completeness equalities, so adding one row turns a newly added
  rare-plus dungeon green with no contents pin. A reviewer must eyeball new
  rows in those lists; the suite cannot catch an author opting itself out.
- **Uncatalogued rare-plus items remain** repo-wide, all of them open-world or
  Rift sourced. That is a known backlog, not a drift bug.
- **Three catalog slots are permanently unfillable today** and keep 100 percent
  catalog completion (and therefore the whole-catalog capstone deed)
  unreachable: the engineering masterwork mark (every engineering recipe
  produces a slotless, statless tool, so the masterwork proc can never fire)
  and two mount reins (one with no acquisition path, one dev-grant only). This
  is why the capstone deed is marked as a feat and kept out of the Book
  completion pair. See "Open owner calls" for the consequence that is still
  undecided.
- **Re-acquiring an already-discovered mount's reins never runs the completion
  ladder live**, because first-discovery fires once while mount ownership is
  possession-based. A player whose last missing relic is reins they once owned
  receives the capstone silently at their next join rather than in the moment.

## Operational riders (release and deploy work, not code)

- **Steam and Epic portal registration.** The mapped achievement ids for the
  Reliquary deeds must be registered on BOTH portals (Steamworks App Admin and
  the Epic Dev Portal) before the mapping binary goes live with a storefront
  mirror enabled. This is a DEPLOY-ORDER constraint, not cosmetic polish:
  unlock pushes batch many names into one call, so a portal rejecting the batch
  over one unregistered name burns the batch's retries, two consecutive
  exhausted batches trip the outage wire (which fast-drops other accounts'
  queued unlocks), and the login reconcile re-sends the poisoned set on its
  cadence indefinitely. The rank-bridge wave arrives at FIRST login on the
  shipping binary, because the join-time retro pass grants every qualifying
  rank deed in the same session that then feeds the reconcile push.
  - **HOLD the registration of the whole-catalog capstone achievement** until
    the three unfillable slots above land. The deed is unearnable until then,
    and a registered impossible achievement is player-visible on both
    storefronts as a permanent 0.0 percent unlock rate.
  - Both mirrors default OFF, so nothing is live until they are enabled.
- **Release-time i18n locale fill.** Every Reliquary key is English-only in the
  Latin locales by contributor policy; the five non-Latin overlays carry
  contributor-authored fills flagged for maintainer translation review. The
  release-tier i18n gate hard-fails on pending rows by design, so the fill is a
  release gate, not optional. Two items need a decision rather than a
  translation: the progress-text key is pure placeholders with no words (it
  needs an exemption or a literal fill, since a translation cannot differ from
  English), and the Russian retro plural leaves want a native-speaker pass. All
  35 page DESCRIPTIONS are English in every locale today; the coverage arm
  widens from names to descriptions at that fill, not before.

## Open owner calls (recorded, not decided)

None of these is a defect. Each is a product decision with no ruling yet.

- **Bags-only mount ownership.** The completion pair reads bags AND bank, so
  banked reins score and borrowed reins can raise a broadcast standing until
  the next sweep. Narrowing to bags alone would move the sheet, the window, the
  rank bridges, and the wire stamp together, and would visibly drop the pair for
  every character with banked reins.
- **The public recent-finds strip bundle**: movement pushes, the polling timing
  channel, the location-bearing `slain:*` entries, and the absence of any
  character-level suppression. Described honestly above; unchanged pending a
  call.
- **Out-of-range remote inspect omits the Curator standing** that the public
  sheet publishes, so proximity shows a rank that a by-name lookup hides. A
  clean follow-up would add the facet field, the parse, the remote card, and a
  by-name flair cache.
- **A per-page Illumination deed for The Rift**, peer to the three flagship
  pages that carry one. The flagship list is a curated product list.
- **The Conquerors capstone grew a long tail**, and the Book completion feat
  behind it with it: the honor stock, the realm-rare drops, and the two
  S-rank-only Rift legendaries at a very low roll per clear. Everything is
  verified reachable (the heroic pool draws class-agnostically and the honor
  stock has no class gate), so this is a difficulty escalation to accept or
  soften deliberately, not a defect.
- **The unfillable-slot nudge.** Because the two pages holding the three
  unfillable slots are not `excludeFromCompletion`, they permanently satisfy the
  "nearly complete" rule (remaining at or under the threshold) and therefore sit
  at the top of the Overview strip and the HUD tracker's default rows forever,
  for any player who has filled everything earnable. The exclusion machinery
  exists but was never applied here, and applying it wholesale would be wrong
  (both pages hold earnable relics). The clean shapes are a per-relic
  unearnable flag that the nearly-complete rule skips, or landing the three
  slots. Recorded rather than fixed, because it is a product call.
- **Compact-tier mobile collision.** On the compact mobile tier the minimap
  coordinate readout and clock overprint the tracker chip. Raised during the
  packet and never ruled on; it ships as-is.
- **The Overview shared-uniques note is now imprecise.** It tells the player
  that shelf and page counts list every slot, so a relic on two pages is
  counted by each. Since the outside-completion pages landed, shelf totals skip
  those pages entirely while the shelf still lists their rows, so a player
  summing the visible rows gets a number above the shelf card and the one line
  meant to explain the gap asserts the opposite rule. Rewording it is a copy
  change that stales the shipped non-Latin fills, which is why it was recorded
  rather than done at the merge gate.
- **Rare-kill trophies paint at the common rung.** The cell-quality resolver
  knows the masterwork and gathering-event mark families but not the rare-kill
  family, so every cell on the realm-rares page frames grey while sibling mark
  families carry a colour. Which rung those trophies deserve is a product call,
  which is the only reason it is not simply fixed.
- **The cell hover keyline never renders.** The quality classes set
  `border-color` with `!important` in the same cascade layer, so the
  `.reliquary-cell:hover` keyline (and the resting showcase border) never wins,
  despite a comment stating the opposite intent. The guard is a source-text
  presence check, blind to selector reach. Restoring the intended hover
  treatment is a visual change and wants a before/after capture.

## Anchors (stable paths)

| Concern | Path / symbol |
|---|---|
| Runtime | `src/sim/reliquary.ts`, `src/sim/content/reliquary.ts` |
| UI | `src/ui/reliquary_view.ts`, `src/ui/reliquary_window.ts`, `src/ui/reliquary_sheet_view.ts` |
| Discovery hub | `src/sim/deeds.ts` `markItemDiscovered` |
| Obtain counts | `src/sim/reliquary.ts` (state, serialize, `reliquaryWireJson`), `IWorldReliquary.reliquaryObtainCounts`, `src/ui/reliquary_view.ts` `reliquaryObtainCountsDigest` |
| Illuminated set | `src/sim/reliquary.ts` (`illuminatedPages`, `syncIlluminatedPages`, the emit gate in `emitReliquaryUnlock`); save-only from the client's perspective |
| Completion ladder | `src/sim/reliquary.ts` `RELIQUARY_COMPLETION_DEED_IDS` + `syncReliquaryCompletionDeeds`; records in `src/sim/content/deeds.ts` |
| Illumination marquee | `server/game.ts` `fanOutIllumination`, `server/social.ts` `broadcastIllumination`, hud arm `reliquaryIlluminationBroadcast` |
| Population rarity | `server/reliquary_rarity_db.ts` (the aggregate + its cadence), `server/reliquary.ts` (the `RouteDef`), `IWorldReliquary.reliquaryRarity`, `src/ui/reliquary_view.ts` (the null gates) |
| HUD tracker | `src/ui/reliquary_tracker_view.ts`, `src/ui/reliquary_tracker_painter.ts` |
| Borders in-world | `src/ui/deed_border_view.ts` (palettes), `src/render/nameplate_canvas.ts`, `src/ui/deeds_window.ts` (the picker), command `deed_set_border` guarded by `server/cosmetic_op_guard.ts` |
| Inspect / identity wire | `src/ui/inspect_view.ts`, `src/ui/curator_sigil.ts`, `server/game.ts` `refreshCuratorStanding` |
| Public sheet | `server/character_sheet.ts` (`sheetReliquaryFromState`, `SHEET_RECENT_RELICS`, `sheetRelicRecentText`), `server/profile_page.ts`; narrow reads `restoreReliquaryMarks` / `restoreReliquaryRecent` in `src/sim/reliquary.ts` |
| Clear counts | `DeedStats.dungeonClears`, `PlayerMeta.delveClears` |
| Heroic uniques | `src/sim/content/heroic_loot.ts` |
| Sets | `src/sim/content/item_sets.ts` |
| World bosses | `src/sim/world_boss.ts` |
| Delves | `src/sim/content/delves/` |
| Mounts | `src/sim/content/mounts.ts`, `src/sim/mounts.ts` |
| Weapon skins | `src/sim/content/weapon_skins.ts`, account cosmetics |
| Deeds UI exemplar | `src/ui/deeds_view.ts`, `src/ui/deeds_window.ts` |
| Interface standard | `DESIGN.md` |
| Autosave | `server/game.ts` `AUTOSAVE_SECONDS` |
