# server/parse/

The combat parse recorder: a host-side, read-only observer at the tick drain in
`server/game.ts` that segments play into fights (arena, battleground, raid,
dungeon, rift), enriches events with capture-time state joins, and ships gzip
NDJSON batches to the external woc-parse-service. Architecture spec:
`PLAN-combat-parse-service.md` beside the repo checkout (decision record in its
section 14).

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
loopback only), `PARSE_INGEST_TOKEN`,
`PARSE_CAPTURE_SURFACES=arena,battleground,raid,dungeon,rift`,
`PARSE_SPOOL_DIR`, `PARSE_SPOOL_MAX_MB`, `PARSE_ENV_LABEL=prod|qa|pbe|dev`,
`PARSE_CENSUS=0` (census opt-out), `PARSE_CENSUS_HOUR` (UTC hour of the daily
export, default 9). All are wired through the compose env passthrough; capture
stays inert when the URL is unset.

## Files
`index.ts` (factory + barrel) - `recorder.ts` (per-tick orchestrator, routing,
budget breaker) - `arena.ts` / `battleground.ts` (match segmenters) -
`fights.ts` (open-fight bookkeeping, rollup totals, record emission) -
`shipper.ts` (batch + gzip + POST, ChatLogger discipline) - `spool.ts`
(bounded disk WAL) - `flags.ts` - `counters.ts` (hot-path counters, prom
export via collect()) - `contract.ts` (vendored wire contract).

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
