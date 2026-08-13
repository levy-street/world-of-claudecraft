// Rotation counters and ready states that last until combat logic consumes them
// or class lifecycle cleanup removes them. They keep a finite backing duration so
// saves and network snapshots remain JSON-safe, but the simulation never ages it.

const PERSISTENT_ENGINE_AURA_IDS: ReadonlySet<string> = new Set([
  'hunter_efficient_rhythm_progress',
  'hunter_efficient_rhythm_ready',
  'hunter_fang_chorus_counter',
  'hunter_overdraw_counter',
  'stampede_ready',
  'shaman_flow_state_progress',
  'shaman_flow_state_ready',
  'shaman_pyrebrand_mastery',
  'shaman_thunder_charges',
  'shaman_warspirit_cadence',
  'moontide',
  'sunwake',
  'old_blood',
  'verdance',
]);

export function isPersistentEngineAura(auraId: string): boolean {
  return PERSISTENT_ENGINE_AURA_IDS.has(auraId);
}
