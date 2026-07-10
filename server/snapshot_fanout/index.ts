// Public surface of the snapshot-fanout subsystem. GameServer consumes only
// this barrel; worker_main.ts is a thread ENTRY POINT (bundled separately to
// dist-server/snapshot_worker.cjs by scripts/build_server.mjs), never an
// import target.
export {
  decideKnownRecord,
  INTEREST_QUERY_RADIUS,
  INTEREST_RADIUS,
  type SentEntityVersions,
  withinInterest,
} from './interest_rules';
export { type DispatchResult, type FanoutHost, SnapshotFanoutPool } from './pool';
export {
  F64_PER_SLOT,
  FLAG_NPC,
  FLAG_STEALTHED_PLAYER,
  FLAG_VALE_BALL,
  I32_PER_SLOT,
  type SessionJob,
} from './protocol';
