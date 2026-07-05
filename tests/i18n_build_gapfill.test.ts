import { describe, it, expect } from "vitest";
import { en, es, es_ES, en_CA } from "../src/ui/i18n.resolved.generated";

// Build gap-fill semantics, asserted on the GENERATED resolved table
// (the per-locale slices under src/ui/i18n.resolved.generated/). scripts/i18n_build.mjs overlays each locale
// onto a deep copy of nested `en` (deepMerge), so a leaf the overlay OMITS keeps the
// English value (fill-from-English) and a leaf the overlay PROVIDES is preserved.
// Every emitted locale is therefore DENSE (the full en leaf set, no gaps). The
// byte-equivalence SHA gate locks these values too, but only as an opaque hash; this
// names the fill/preserve behavior on representative keys so a gap-fill regression
// reports as a readable assertion failure rather than a re-baseline-able hash drift.

function get(obj: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

// Collect every leaf path (recurse objects AND arrays; a non-object value is a leaf).
function leafPaths(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      leafPaths((obj as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.push(prefix);
  }
  return out;
}

describe("i18n build gap-fill (fill-from-English / preserve-present)", () => {
  it("fills a leaf omitted by a sparse overlay from the English value", () => {
    // en_CA is a 3-key divergence-only overlay; nav.home is omitted, so the build
    // fills it from en.
    expect(get(en_CA, "nav.home")).toBe(get(en, "nav.home"));
    expect(get(en_CA, "nav.home")).toBe("Home");
  });

  it("preserves a present translated leaf rather than overwriting it with English", () => {
    // es is a dense locale; its real translation must survive the overlay-onto-en merge.
    expect(get(es, "nav.home")).toBe("Inicio");
    expect(get(es, "nav.home")).not.toBe(get(en, "nav.home"));
  });

  it("preserves a present divergent override over the English base value", () => {
    expect(get(en_CA, "classDetails.labels.armor")).toBe("Armour");
    expect(get(en, "classDetails.labels.armor")).toBe("Armor");
  });

  it("emits a dense table: a sparse overlay resolves to the full English leaf set (no gaps)", () => {
    const enLeaves = leafPaths(en).sort();
    expect(enLeaves.length).toBeGreaterThan(1000);
    // en_CA (3-key overlay) and es_ES (divergence-only overlay) both fill out to the
    // exact en leaf set, proving the fill-from-English path produces dense output.
    expect(leafPaths(en_CA).sort()).toEqual(enLeaves);
    expect(leafPaths(es_ES).sort()).toEqual(enLeaves);
  });
});
