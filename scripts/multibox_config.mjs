// multibox_config.mjs — shared config loader for the multibox tooling.
// A party file may set `"extends": "<relative path>"` to inherit a base config
// (e.g. multibox.world.json — the questing route, grind ladder, account registry).
// Objects deep-merge; arrays + scalars are replaced wholesale, so a party overrides
// only its diffs. Used by both multibox.mjs (the orchestrator) and multibox_fleet.mjs.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function deepMerge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(p, seen = new Set()) {
  const abs = resolve(p);
  if (seen.has(abs)) throw new Error(`circular "extends" at ${abs}`);
  seen.add(abs);
  const raw = JSON.parse(readFileSync(abs, 'utf8'));
  if (!raw.extends) return raw;
  const base = loadConfig(resolve(dirname(abs), raw.extends), seen);
  const { extends: _base, ...over } = raw;
  return deepMerge(base, over);
}

// --- fleet discovery (shared by the monitor + dashboard so they track exactly what
// the fleet launcher runs) ---
import { readdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const NON_PARTY = new Set(['multibox.world.json', 'multibox.fleet.json', 'multibox.config.example.json']);

// Return the active parties as [{ label, members:Set<charname>, tag, path }].
// Source of truth: multibox.fleet.json if present (the fleet roster); otherwise every
// multibox.<party>.json that has bots. extends is resolved, so thin party files work.
export function fleetParties(scriptsDir = SCRIPTS_DIR) {
  let paths = [];
  const fleetFile = resolve(scriptsDir, 'multibox.fleet.json');
  if (existsSync(fleetFile)) {
    try {
      const f = JSON.parse(readFileSync(fleetFile, 'utf8'));
      const list = Array.isArray(f) ? f : (f.parties ?? []);
      paths = list.map((p) => (String(p).includes('/') ? p : resolve(scriptsDir, p)));
    } catch {}
  }
  if (!paths.length) {
    try {
      paths = readdirSync(scriptsDir)
        .filter((f) => /^multibox\..+\.json$/.test(f) && !NON_PARTY.has(f))
        .map((f) => resolve(scriptsDir, f));
    } catch {}
  }
  const out = [];
  for (const path of paths) {
    let cfg;
    try { cfg = loadConfig(path); } catch { continue; }
    const bots = cfg?.bots ?? [];
    if (!bots.length) continue; // skip the spine / non-party files
    const members = new Set(bots.map((b) => String(b.character).toLowerCase()));
    const lower = [...members];
    let prefix = lower[0] ?? '';
    for (const n of lower) while (prefix && !n.startsWith(prefix)) prefix = prefix.slice(0, -1);
    const leaderName = bots.find((b) => String(b.character).toLowerCase() === String(cfg.leader ?? '').toLowerCase())?.character;
    const label = prefix.length >= 3 ? prefix : (leaderName || basename(path).replace(/^multibox\.|\.json$/g, ''));
    out.push({ label, members, tag: cfg.tag ?? '', path });
  }
  return out;
}
