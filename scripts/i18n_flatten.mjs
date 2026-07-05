// Flatten/unflatten contract for the i18n locale overlays.
//
// A nested object {a:{b:"x"}} corresponds to the flat dotted-key map {"a.b":"x"}.
// The separator is a literal dot. We recurse into PLAIN objects only; arrays and
// every non-object value are leaves. That object-vs-leaf rule is exactly the one
// scripts/i18n_build.mjs deepMerge uses (`!Array.isArray`), so for a string-leaf
// tree (which `en` and every locale are - all 1925 leaves are strings, max depth
// 6, no arrays/functions) flatten and unflatten round-trip the tree exactly:
// unflatten(flatten(x)) deep-equals x. The build therefore overlays the
// unflattened overlay onto nested `en` and emits the byte-identical dense table.
//
// The encoding is unambiguous only when no key segment contains a literal dot and
// no leaf path is a strict prefix of another (both hold for `en` today). Rather
// than rely on that incidentally, both functions throw if either is ever violated,
// so a future key that breaks the contract fails loud instead of silently dropping
// a translation.
//
// Used by scripts/i18n_build.mjs (flatten + unflatten, at every build), the registry
// scanner (scripts/i18n_scan.mjs), and the fill worklist (scripts/i18n_fill_worklist.mjs).

export function flatten(node, prefix = '', out = {}) {
  for (const key of Object.keys(node)) {
    // A literal dot in a key segment would make the dotted path ambiguous with
    // nesting (flatten and unflatten would disagree). Today no `en` key contains a
    // dot; fail loud if a future key ever does rather than silently corrupting.
    if (key.includes('.')) {
      throw new Error(`i18n flatten: key segment contains a literal '.', unrepresentable in the dotted-key encoding: "${prefix ? `${prefix}.` : ''}${key}"`);
    }
    const value = node[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

export function unflatten(flat) {
  const out = {};
  for (const path of Object.keys(flat)) {
    const parts = path.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = node[part];
      if (existing === undefined) {
        node[part] = {};
      } else if (typeof existing !== 'object' || Array.isArray(existing)) {
        // A leaf already sits here, i.e. some key is a strict prefix of this one
        // ("a.b" and "a.b.c"). The encoding cannot hold both; surface it.
        throw new Error(`i18n unflatten: path collision at "${parts.slice(0, i + 1).join('.')}" while inserting "${path}"`);
      }
      node = node[part];
    }
    const last = parts[parts.length - 1];
    const occupied = node[last];
    if (occupied && typeof occupied === 'object' && !Array.isArray(occupied)) {
      // The reverse collision: a leaf would overwrite an existing nested object.
      throw new Error(`i18n unflatten: path collision at "${path}" (a leaf would overwrite a nested object)`);
    }
    node[last] = flat[path];
  }
  return out;
}
