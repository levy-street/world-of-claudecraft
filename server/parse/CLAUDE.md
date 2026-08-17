# server/parse/

The combat parse recorder: a host-side, read-only observer at the tick drain in
`server/game.ts` that segments play into fights (arena, battleground, raid,
dungeon, rift), enriches events with capture-time state joins, and ships gzip
NDJSON batches to the external woc-parse-service (a separate repo; the vendored
`contract.ts` below is the wire contract between the two).

## Invariants (keep these)
- **Read-only observer.** Nothing here may mutate the sim, mutate a drained
  `SimEvent`, draw rng, or import from `src/render|ui|game|net`. Type-only
  imports from `src/sim/` are fine; the recorder runs after `sim.tick()`
  returns and before `routeEvents`.
- **Open before route, close after route.** Segmenters return close decisions
  as `PendingClose` intents; the recorder applies them after routing the tick's
  events so a fight always contains its own killing blow.
- **Never block the loop.** The observe pass is O(events) with Map lookups;
  serialization, gzip, and network live on the shipper's timer. The budget
  breaker (3 consecutive ticks over 5 ms) disables capture rather than ever
  degrading the tick.
- **Telemetry sheds, gameplay never does.** Buffer overflow drops records with
  a counter; the disk spool is bounded with oldest-batch eviction; ship
  failures degrade to the spool without throwing.
- **`contract.ts` is a vendored copy** of woc-parse-service `contract/types.ts`.
  Edit it THERE and re-copy verbatim. Version safety is wire-enforced: every
  batch header carries `v = CONTRACT_VERSION` and the service rejects unknown
  majors, so a drifted copy fails on the first shipped batch, never silently.
- **Identity is `(realm, characterId)`**, never pid (entity ids are per-login
  and reused). Pids appear only as intra-fight actor references.
- **No PII.** Participant snapshots come from `serializeCharacter` (game state
  only); nothing from `accounts` (emails, IPs, hashes) may ever enter a record.

## Env flags
`PARSE_CAPTURE=1` master (default off), `PARSE_INGEST_URL` (https, or http to
loopback or an RFC1918 private IP literal: the VPC-internal push path),
`PARSE_INGEST_TOKEN`,
`PARSE_CAPTURE_SURFACES=arena,battleground,raid,dungeon,rift`,
`PARSE_SPOOL_DIR`, `PARSE_SPOOL_MAX_MB`, `PARSE_ENV_LABEL=prod|qa|pbe|dev`,
`PARSE_CENSUS=0` (census opt-out), `PARSE_CENSUS_HOUR` (UTC hour of the daily
export, default 9). All are wired through the compose env passthrough; capture
stays inert when the URL is unset.

## Layout (`ls server/parse/` for the live set)
`recorder.ts` is the per-tick orchestrator (routing, state joins, the budget
breaker); `index.ts` the factory + barrel. Segmentation is pluggable behind
the `SegmenterHost` seam in `types.ts` (structural read-only views of the sim,
so unit tests script a fake and the real `Sim` satisfies them at the hook
site); a new segmenter implements that seam. The segmenters: `arena.ts` and
`battleground.ts` (matches), `instances.ts` (dungeons and raids: fights are
EVENT-opened, the first player-vs-instance-mob damage opens a boss or trash
fight and per-tick observation only closes them; trash quiets out after
`TRASH_QUIET_TICKS`, deliberately aligned with the in-game damage meter's
`ENCOUNTER_END_SECONDS` in `src/ui/meters.ts`), and `rifts.ts` (one fight per
floor). `boss_casts.ts` synthesizes boss cast timelines from `castingAbility`
transitions, since mobs never emit cast events. `threat_sampler.ts` and
`resource_sampler.ts` are the sampled continuous streams (see below). Around them: `fights.ts`
(open-fight bookkeeping, rollup totals, record emission), `shipper.ts` (batch
+ gzip + POST), `spool.ts` (bounded disk WAL), `flags.ts`, `counters.ts`
(hot-path counters, prom export via collect()), `build_version.ts` (batch
header version stamp), `contract.ts` (vendored wire contract), and the census
exporter below.

## Threat sampling (`threat_sampler.ts`)
The sim keeps a real hate table per mob (`Entity.threat`, `src/sim/threat.ts`)
and nothing ever emitted it, so the dashboard could show what everyone did but
never why the boss turned around. The sampler runs inside `observe`, after
event routing and before the close pass, and emits the contract's
`SampleRecord` with `kind: 'threat'` once a second
(`TICKS_PER_THREAT_SAMPLE`, 1 Hz against the 20 Hz tick), the cadence
`PLAN-combat-parse-service.md` section 5.3 reserves for continuous streams.
- **Wire layout**, one flat number array per sampled mob:
  `[mobId, aggroTargetId, srcA, threatA, srcB, threatB, ...]`, highest threat
  first, capped at `TOP_THREAT_ENTRIES`. `aggroTargetId` is 0 when the mob is
  locked on nobody, so every entry stays a plain number array. Source ids are
  the hate table's OWN keys, so a pet's threat sits under the pet's entity id
  exactly as the sim tracks it; the reader resolves names through the fight's
  actor roster.
- **Bounded on purpose.** At most `MAX_SAMPLED_MOBS` mobs per fight per second,
  bosses first, so a big add wave can never push the boss's table off the wire
  and never puts an unbounded sample on it either. Mobs with an empty table are
  skipped entirely.
- Samples are NOT counted against `MAX_RAW_EVENTS_PER_FIGHT`: they are a fixed
  low rate, so a long fight that truncates its raw event lines still ships a
  complete threat series.

## Resource sampling (`resource_sampler.ts`)
Health and the primary resource pool for everyone in a fight, once a second
(`TICKS_PER_RESOURCE_SAMPLE`, deliberately the same cadence as the threat
sampler so the two series line up sample-for-sample). Emits the contract's
`SampleRecord` with `kind: 'res'`, reserved since v1 and previously unused.
- **Wire layout**, one flat number array per sampled entity:
  `[entityId, hp, maxHp, resource, maxResource, resourceTypeCode]`, where the
  code is 0 for no pool and 1..4 for mana/rage/energy/focus
  (`RESOURCE_TYPE_CODES`). Type is sampled EVERY tick rather than assumed fixed:
  a druid's pool changes with form.
- **Every entry is self-contained**, carrying the maxima. That costs two numbers
  per entity per second and buys a reader that never has to join against a
  roster which may not cover late joiners, the dead, or a stamina buff that
  moved maxHp mid-fight.
- **Participants always sample in full** (raid size is its own bound), including
  dead ones at hp 0: dropping that row would hide the death and any rez. The
  HOSTILE side is capped at `MAX_SAMPLED_MOBS` and restricted to boss templates,
  since boss health over time is the phase-timing and dps-check record while
  trash would multiply the payload for no analytical value.
- **This is the balance-facing stream** and it is not derivable after the fact:
  events carry amounts, never the resulting pools, and the overheal limit below
  means integrating damage minus healing drifts silently.

## The daily census exporter (`census.ts` / `census_db.ts`)
A characters/deeds/playtime snapshot of the realm shipped through the SAME
spool/shipper pipe as fight telemetry. Scheduling: a FIXED UTC hour
(`PARSE_CENSUS_HOUR`) with a day memory, never anchored to process boot, so a
restart loop cannot re-run it every boot and a peak-hour deploy cannot pin the
daily scan to peak; a double run during the export hour is safe because the
service upserts per (realm, day, characterId). PII-safe by construction: the
loader selects from characters and play_sessions durations only (never
`accounts`, never the ip/ua columns), excludes GM characters, reads in
id-keyset batches, and projects only the state sub-paths it needs, never the
whole JSONB blob. Rows enqueue in chunks per event-loop turn so a large realm
never fans a whole snapshot into the shipper on the world-loop thread.

## Known capture limits (v1, deliberate)
- Aura attribution: `Sim.applyAura` gained/displaced events carry
  sourceId/abilityId/stacks; the many scattered FADE emit sites elsewhere in
  the sim are not yet widened, so fades enrich only via the best-effort
  state-join fallback in `recorder.ts`.
- Overheal: a periodic tick that FULLY overheals emits no heal2 at all (those
  sim sites gate on `healed > 0`, unchanged), so overheal totals undercount
  the at-full-health case; direct heals report it exactly.
- Rift fights are per-floor segments; rift boss pulls stay inside their floor's
  fight (boss casts still synthesize via mob tracking).

## Testing
Unit tests script a fake `RecorderSim` (see `tests/parse_recorder.test.ts`):
no sockets, no DB, no real Sim. Golden capture: a seeded scripted run must
produce byte-identical records with an injected id factory.
