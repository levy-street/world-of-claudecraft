// The one shipped world seed. World of ClaudeCraft is a persistent place:
// every host that builds THE world (the offline client in src/main.ts, the
// online mirror's pre-hello placeholder in src/net/online.ts, the
// authoritative server in server/game.ts and server/main.ts, the map-doc
// default in map_doc.ts) and every test that asserts world geometry against
// it must use the same number, so it lives here once. Private copies of this
// literal used to be scattered across those hosts and suites, which is
// exactly how one host's world could have silently diverged from another's.
export const WORLD_SEED = 20061;
