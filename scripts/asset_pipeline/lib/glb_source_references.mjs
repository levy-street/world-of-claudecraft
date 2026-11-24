/** Find candidate GLB filenames using the inventory's literal substring rule.
 * Scan source once for the common suffix instead of once per asset. Checking
 * each candidate length preserves overlapping names (sword.glb within
 * long_sword.glb), punctuation, and references inside comments or longer URLs.
 * Callers supply filenames ending in .glb, as the inventory walk already does.
 */
export function findGlbReferences(source, filenames) {
  const candidates = new Set(filenames);
  const lengths = new Set([...candidates].map((name) => name.length));
  const found = new Set();
  if (candidates.size === 0) return found;
  let offset = source.indexOf('.glb');
  while (offset !== -1) {
    const end = offset + 4;
    for (const length of lengths) {
      if (length > end) continue;
      const name = source.slice(end - length, end);
      if (candidates.has(name)) found.add(name);
    }
    offset = source.indexOf('.glb', end);
  }
  return found;
}
