# Book of Deeds: maintainer handoff notes

The open decisions, deferrals, and follow-ups for the Book of Deeds feature on
this branch, current as of 2026-07-11. The design contract (vocabulary,
architecture, the binding rules, the add-a-deed recipe) lives in
`docs/design/deeds.md`; the catalog source of truth is
`src/sim/content/deeds.ts` (pinned by `tests/deeds_content.test.ts`); the
public rendering is `/wiki/deeds`. The full development record for this
directory lives in git history before 2026-07-11.

## State at a glance

- Live set: 192 deeds, 2365 Renown, 19 titles, 3 distinct borders, 72 Steam
  marquee entries.
- A second red arrived with the v0.25.0 merge and is inherited, not
  branch-caused: the new `sfx check` gate step (`npm run sfx:check`, added to
  `scripts/gate.mjs` by the SFX conform pipeline) exits 1 with 111 legacy
  audio files out of spec. The audio tree and the conform tooling on this
  branch are byte-identical to the release/v0.25.0 tip, so the pristine base
  is equally red; conforming the assets (`sfx:conform`) belongs upstream, not
  in this branch's diff.
- The translation pass has landed: registry pending is zero in every locale
  and `tests/i18n_completeness.test.ts` (M16) is green. The pass also
  refreshed the reworded existing keys surfaced by an en-resolved diff
  against the merge base (rewording an English value does not mark its
  translations pending, so that diff is the only way to catch them). The
  inherited `sfx check` red above is the only red left on this branch.
- Icon art in progress: six deeds still render the procedural category crest;
  the work order is `icon-brief.md` beside this file. Icon files land as
  512x512 RGBA named by deed id, ingested by `npm run assets:deeds`.

## Decisions needing a maintainer call

- Privacy sign-offs: the public recent-earn timestamps (earnedAt) on public
  surfaces, and the deed-broadcast opt-out defaulting to sharing ON.
- Three public deed names echo withheld boss epithets (Fogbinder Unbound;
  Scourge No More plus the Deathless; Drowning the Moon). Accepted by design;
  confirm.
- A one-sentence jail mention was added to `guide.social.etiquetteBody` (the
  system is wired and player-visible); editorial call, single-sentence revert
  if unwanted.
- Paragon and mythic reward TITLES where the legacy milestones granted
  borders: deliberate, and changing it now would invalidate persisted
  activeTitle picks.

## Deferred until an engine surface exists

See also the deferred section in `docs/design/deeds.md`.

- `prog_ringwright`: jewelcrafting and inscription have zero recipes.
- `soc_first_salvage` and `soc_salvage_50`: salvage has no player-facing
  wiring on any host; the salvagesPerformed counter ships with the
  transcription; ACH_FIRST_SALVAGE is held unregistered.
- Enchanting deeds: disenchant and apply-enchant are unwired on every host.
  When enchanting wires, the count-form craftSkill triggers only get easier,
  and the wiki professions and gear pages need their sections in the same
  change (enchanting, salvage, and archetype declaration are deliberately
  undocumented on the wiki while unwired).
- The nine account-level ids including ACH_NINEFOLD: no account-grant lane
  exists.
- `dgn_sanctum_speed` stays calibrate-at-implement; the v0.24.0 Sanctum entry
  move lengthened the entry walk about 6 yd (timing baseline only).
- Deed titles deliberately do not render yet on party/raid frames, mail
  sender lines, chat bubbles, or the localized OG card page.

## Rollback

Rolling the server binary back past this feature is the one direction the
deeds persistence cannot heal itself from (the `server/deeds_records.ts`
header comment calls this out): the base serializer reconstructs only the
fields it knows, so the FIRST save a pre-deeds binary makes strips `deeds`,
`deedStats`, `activeTitle`, and `renown` from that character's
`characters.state` blob. Before rolling back, snapshot the characters table:

```sh
pg_dump "$DATABASE_URL" --table=characters --format=custom \
  --file=characters-pre-deeds-rollback.dump
```

What survives a base-binary save:

- The legacy `unlockedMilestones` dual-write: new grants keep writing the
  legacy ids for exactly this insurance (the one-release retirement window
  in the follow-up chores below), so every milestone-unified deed re-derives
  from it on re-upgrade.
- The `character_deeds` rows (deed_id plus earned_at per character): a base
  binary rewrites only the state blob, never the table. These rows are the
  seed for a manual blob restore: they enumerate exactly which ids each
  character had earned, and when.
- Everything a state predicate can prove: on re-upgrade the join path
  re-derives it (unionLegacyMilestones, recomputeRenown, seedItemDiscovery,
  retroFallbackGrants, then the full evaluateDeedsFor retro pass, all wired
  in `src/sim/sim.ts`).

Genuinely unrecoverable once a base binary saves a character:

- The deedStats lifetime counters.
- The per-deed earn-day stamps (the utcDay values in the persisted `deeds`
  map; a retro re-grant stamps the current day, not the original).
- The persisted activeTitle pick.
- Event-witnessed deeds no state predicate can re-prove: the retro pass can
  only grant what the surviving blob demonstrates.

Safe re-upgrade path: restore blobs from the snapshot where you have one,
then let the join path re-derive the rest; renown recomputes from the
earned map on every load, so it never needs hand-repair. For characters
that saved under the base binary with no snapshot, `character_deeds` is the
recovery seed: their earned ids are still known even though the blob no
longer carries them, so a restore script can rebuild the `deeds` map from
the table (earn days, deedStats, and activeTitle stay lost).

### Rollout population

`character_deeds` fills lazily, and that is the accepted launch semantic.
Rows arrive from three sources only (live unlocks, the login reconcile, and
the login retro pass); nothing walks dormant characters. The rarity
denominator (`deedRarityCounts` in `server/deeds_db.ts`) counts every
eligible character (level 5 or above, state present, eligible account), so
immediately post-rollout every rarity percentage reads near zero, and
dormant veterans dilute the numbers until they log in. The Renown board
likewise shows only characters that have rows. This self-heals as the
active population logs in, and the public wording already matches it: a
dormant-forever character was never GRANTED its deeds, so the aggregates'
earned framing stays literally true.

If launch-accurate rarity is wanted on day one, a deterministic one-shot
backfill is feasible and is the named follow-up: iterate the eligible
characters, run each state blob through the same Sim join retro evaluation,
and batch the results through insertCharacterDeeds (already idempotent);
never write blobs back. Follow the `server/market_backfill.ts` marker
pattern (a completion marker row so re-runs no-op). Its risks, and why it
is a follow-up rather than in this branch: every backfilled row gets a
run-time earned_at stamp, which compresses the Renown board's
completionTime tie-break (score-then-earliest collapses to the backfill
timestamp for everyone it touches); the public rarity numbers jump visibly
when it runs; and boot-time placement would be far too heavy, so it runs
script-driven, off-peak only.

## Follow-up chores (none blocking)

- Retire the unlockedMilestones dual-write after one release (rollback
  insurance only).
- Wiki-bundle severance: the shared icons chunk bakes deed descriptions,
  hidden names, and boss names, and entity-English also rides the per-locale
  resolved chunks; consuming the catalog at build time closes both and
  shrinks the wiki bundle.
- The orphaned `game.milestone.unlocked` catalog key (18 live translations,
  zero consumers) joins the orphan sweep.
- Dead guide keys are marked deprecated in place (`nav.onThisPage`,
  `classPage.roleLabel` and `resourceLabel`, six `dungeonsPage` name and size
  keys, `delvesPage.affixesLabel`, `models.count`); removing one needs the en
  leaf plus all 21 overlay rows dropped together.
- `col_discovery_250`'s luck-free floor has thin headroom; recompute it at
  the next content removal.
- If a zero-stakes-PvP ledger exclusion ever lands, it must include
  jailed-versus-jailed matches.
- mailAttachmentsSent bumps once per send; counting attachments instead
  would silently retune `soc_by_ravens_wing`.
- The leaderboard header subtitle reads Lifetime XP on every tab
  (pre-existing shared chrome, not deeds-owned).
- The nameplate declutter stack offset (fixed 20 px) does not model the
  deed-title subtitle line on a titled plate; cosmetic clustering only, the
  same class as the guild-tag line.
- Daily-rewards moderation writes (setDailyRewardsBan and the IP form)
  commit without firing the onAccountModerated cache-bust hook; benign today
  because that hook busts only the lifetime-XP and guild board caches;
  revisit if a board cache ever covers daily rewards.
- finalizeDay winner selection filters participation bans but not
  ELIGIBLE_ACCOUNT_SQL (the five board reads delist banned and suspended
  accounts, prize selection does not); a pre-existing divergence on both
  parents, flagged rather than changed.
- One early commit message on this branch contains internal process
  vocabulary; clean it when squashing.

## Upstream unifications the locale fill mirrored

Fix these upstream and in the deed locale rows in ONE change, or the two
drift apart again:

- ru sister_nhalia is rendered two ways by the two mob anchors; ko Thornpeak
  splits between the zone anchor and the Nythraxis epithet anchor; ja
  Gravecaller splits between the Morthen anchor and the cult transliteration;
  Tidewatcher Ondrel carries differing title-and-name shapes across the CJK
  locales.
- Pre-existing per-locale noun divergences: zh_CN Highwatch (3 renderings),
  Thornpeak (2), Redbrook (2), Troll Mounds (2); zh_TW Brightwood Glade page
  title versus POI label, Redbrook (2), Ashen Coliseum (2), and a duplicated
  eastbrook pois.8 and pois.9 label.
- Locale coinages to sanity-check at the next release fill: da Vogterens
  Told for the Keeper aura (no prior da rendering existed); de valePlaceNotes
  unified Reliquienhuegel to Reliquiarhuegel; the cs
  `aura.resurrectionSickness` seed row is still English while the death UI
  says Strazcovo myto.

## Merge-watch

- An upstream duplicate of this branch's More-tray visibility fix may arrive
  at a later release merge (the closed tray keeps display:flex while
  syncAnyWindowOpenState excludes it); dedupe deliberately when it does.
- Steam happy-path verification still needs a logged-in Steam client to mint
  a real ticket; every automated layer around the mint is tested
  (`tests/electron_steam.test.ts`, `tests/server/steam_routes.test.ts`).
