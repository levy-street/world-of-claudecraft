export function decodeActiveWorldBossIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}
