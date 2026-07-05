import { describe, it, expect } from "vitest";
import { en, es, es_ES, fr_FR, fr_CA, en_CA } from "../src/ui/i18n.resolved.generated";
import { es as esOverlay } from "../src/ui/i18n.locales/es";
import { es_ES as esESOverlay } from "../src/ui/i18n.locales/es_ES";
import { fr_CA as frCAOverlay } from "../src/ui/i18n.locales/fr_CA";
import { en_CA as enCAOverlay } from "../src/ui/i18n.locales/en_CA";

// Declared-base dialect resolution, asserted on the GENERATED resolved
// table (the per-locale slices under src/ui/i18n.resolved.generated/). The dialects are divergence-only
// overlays (es_ES over es, fr_CA over fr_FR, en_CA over en) and the build
// (scripts/i18n_build.mjs DIALECT_BASE + base-then-overlay deepMerge) resolves a
// dialect as nested en -> base overlay -> dialect overlay. Two semantics this pins
// that the byte-equivalence SHA gate only protects INDIRECTLY (an opaque hash
// mismatch, not a readable "expected JcJ got PvP"):
//   1. a dialect overlay key OVERRIDES the base value, and
//   2. a key the dialect OMITS falls through to the BASE value, never to en
//      directly when the base itself diverges from en.
// A dropped or reversed base merge in scripts/i18n_build.mjs would silently ship
// the base-locale strings as English; these assertions fail loudly instead.

// The dense leaf-key universe. `es` is a dense flat overlay carrying every leaf,
// so its key set is the full set of dotted leaf paths.
const LEAF_KEYS = Object.keys(esOverlay);

function get(obj: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

const DIALECTS = [
  { name: "es_ES", base: "es", overlay: esESOverlay, resolved: es_ES, resolvedBase: es },
  { name: "fr_CA", base: "fr_FR", overlay: frCAOverlay, resolved: fr_CA, resolvedBase: fr_FR },
  { name: "en_CA", base: "en", overlay: enCAOverlay, resolved: en_CA, resolvedBase: en },
] as const;

describe("i18n dialect declared-base resolution (resolved table)", () => {
  for (const d of DIALECTS) {
    describe(`${d.name} over ${d.base}`, () => {
      it("applies every overlay key on top of the base (override wins, diverges from base)", () => {
        const keys = Object.keys(d.overlay);
        expect(keys.length).toBeGreaterThan(0);
        for (const k of keys) {
          const overlayValue = (d.overlay as Record<string, string>)[k];
          expect(get(d.resolved, k), `${d.name} overlay key ${k} must win in the resolved table`).toBe(
            overlayValue,
          );
          expect(
            get(d.resolved, k),
            `${d.name} overlay key ${k} must diverge from its ${d.base} base value`,
          ).not.toBe(get(d.resolvedBase, k));
        }
      });

      it("falls through every omitted key to the base value, never to en directly", () => {
        const overlayKeys = new Set(Object.keys(d.overlay));
        const omitted = LEAF_KEYS.filter((k) => !overlayKeys.has(k));
        let baseDivergesFromEn = 0;
        for (const k of omitted) {
          const resolved = get(d.resolved, k);
          const baseVal = get(d.resolvedBase, k);
          expect(resolved, `${d.name} omitted key ${k} must resolve to its ${d.base} base value`).toBe(
            baseVal,
          );
          if (baseVal !== get(en, k)) {
            baseDivergesFromEn++;
            expect(
              resolved,
              `${d.name} omitted key ${k} must fall through to ${d.base}, not en, when the base diverges`,
            ).not.toBe(get(en, k));
          }
        }
        // Non-vacuous: for a non-en base, the base genuinely diverges from en on many
        // omitted keys, so the "base, not en" distinction is actually exercised.
        if (d.base !== "en") {
          expect(baseDivergesFromEn).toBeGreaterThan(100);
        }
      });
    });
  }

  it("pins representative base-fallthrough and override anchors", () => {
    // realmTypes.pvp: base diverges from en (es/fr_FR "JcJ" vs en "PvP") and the
    // dialect overlay omits it -> must resolve to the base value, not en.
    expect(get(es_ES, "realmTypes.pvp")).toBe("JcJ");
    expect(get(es_ES, "realmTypes.pvp")).not.toBe("PvP");
    expect(get(fr_CA, "realmTypes.pvp")).toBe("JcJ");
    expect(get(fr_CA, "realmTypes.pvp")).not.toBe("PvP");
    expect(get(es_ES, "nav.home")).toBe("Inicio");

    // en_CA carries a real divergence over en (Commonwealth spelling) that must win,
    // while every key it omits falls through to en.
    expect(get(en_CA, "classDetails.labels.armor")).toBe("Armour");
    expect(get(en, "classDetails.labels.armor")).toBe("Armor");
    expect(get(en_CA, "nav.home")).toBe("Home");
  });
});
