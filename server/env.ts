// Server env bootstrap: loads .env (and .env.local) into process.env.
//
// Several modules read configuration at IMPORT time (server/realm.ts pins
// REALM_NAME into an exported const, server/db.ts derives DATABASE_URL), so
// the file load must happen before any of them evaluates. Node evaluates a
// module once, in import order, depth-first: the entry point (server/main.ts)
// imports this module FIRST, and db.ts imports it too so non-main entry
// points that only pull the db keep working. Never add an import-time
// process.env read to a module without importing './env' above it.
export function loadServerEnv(): void {
  try {
    process.loadEnvFile?.();
  } catch {
    // .env is optional; production usually injects real env vars directly.
  }
  try {
    // Local-dev convenience: also load .env.local so the server can reuse the
    // client's VITE_* values (e.g. the Solana RPC + $WOC mint) for the
    // in-world holder-tier reads. Existing keys from .env are not overwritten.
    process.loadEnvFile?.('.env.local');
  } catch {
    // .env.local is optional.
  }
}

loadServerEnv();
