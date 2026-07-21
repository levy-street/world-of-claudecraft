// The t() miss / pending policy and its release-vs-non-release split.
//
// Locked decision #4: on a miss, t() THROWS for an untracked key in dev/test,
// renders English for a registry-`pending` key on a non-release build only, and
// HARD-FAILS for a pending key on a release build. Release is detected via
// I18N_RELEASE=1 (tests/build) or import.meta.env.PROD (the real Vite build).
//
// These are permanent regression guards with real teeth: the untracked cases run
// against the real table; the pending cases inject a synthetic pending key through
// the generated module so the ACTUAL t() pending branch is exercised in both
// release and non-release modes (the real `pending` set is empty while overlays
// stay dense, so it cannot be triggered from committed data alone).

import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { en } from "../src/ui/i18n.catalog";
import { pending as realPending } from "../src/ui/i18n.resolved.generated";
import { t, setLanguage, type TranslationKey } from "../src/ui/i18n";

// Call t() with an arbitrary string (bypassing the TranslationKey compile-time
// type) so we can exercise the runtime untracked path.
const tRaw = t as unknown as (key: string, values?: Record<string, string | number>) => string;

// The two-tier gate (see .github/workflows/ci.yml): an empty pending set is a
// RELEASE guarantee, not a PR one - an English-only PR legitimately leaves keys
// pending - so that assertion runs release-only.
const RELEASE_TIER = process.env.I18N_RELEASE_TIER === "1";

afterEach(() => {
  delete process.env.I18N_RELEASE;
  setLanguage("en");
});

describe("t(): untracked key (absent from the table and from en)", () => {
  it("throws in dev/test (no release flag)", () => {
    delete process.env.I18N_RELEASE;
    setLanguage("en");
    expect(() => tRaw("totally.bogus.untracked.key")).toThrow(/untracked key/);
    // A real key still resolves normally, so the guard is not blanket-throwing.
    expect(tRaw("nav.home")).toBe("Home");
  });

  it("degrades to the raw key on a release build (never crashes a player's client)", () => {
    process.env.I18N_RELEASE = "1";
    setLanguage("en");
    expect(tRaw("totally.bogus.untracked.key")).toBe("totally.bogus.untracked.key");
    // A real key still resolves on release.
    expect(tRaw("nav.home")).toBe("Home");
  });
});

describe("t(): pending key (untranslated; the dense table English-fills it)", () => {
  // After the lazy locale flip the runtime no longer reads the barrel's `translations`
  // map; it reads the eager `en` slice plus a `resident.es` that ensureLocaleLoaded("es")
  // populates from LOCALE_LOADERS.es() (a dynamic import of ./es), plus the static
  // `pending` set. So inject the synthetic pending key at THOSE seams: add it to the es
  // slice (so resident.es carries it after the await) and list it in pending.es (so the
  // release hard-fail fires). Mocking the old barrel `translations` would no longer feed
  // the table the runtime reads - the lookup would miss and throw an UNTRACKED error, a
  // different throw - so the assertion below would silently test the wrong thing.
  const ES = "../src/ui/i18n.resolved.generated/es";
  const PENDING = "../src/ui/i18n.resolved.generated/pending";
  const SAMPLE = "__samplePendingKey";
  const FILL = "English fill {name}";

  async function loadWithPending() {
    vi.resetModules();
    vi.doMock(ES, async () => {
      const actual = await vi.importActual<typeof import("../src/ui/i18n.resolved.generated/es")>(ES);
      const table = { ...actual.es, [SAMPLE]: FILL };
      // Expose both `es` (the source named export) and `default` (the production-chunk
      // shape) so the loader's shape-tolerant `mod.default ?? mod.es` read resolves without
      // the vitest mock proxy throwing on an undefined `default` access.
      return { es: table, default: table };
    });
    vi.doMock(PENDING, async () => {
      const actual = await vi.importActual<typeof import("../src/ui/i18n.resolved.generated/pending")>(PENDING);
      return { pending: { ...actual.pending, es: [...(actual.pending.es ?? []), SAMPLE] } };
    });
    return await import("../src/ui/i18n");
  }

  afterEach(() => {
    vi.doUnmock(ES);
    vi.doUnmock(PENDING);
    vi.resetModules();
  });

  it("renders the English fill on a non-release build", async () => {
    delete process.env.I18N_RELEASE;
    const mod = await loadWithPending();
    mod.setLanguage("es");
    await mod.ensureLocaleLoaded("es"); // make resident.es carry the synthetic key
    const tm = mod.t as unknown as (k: string, v?: Record<string, string | number>) => string;
    expect(tm("__samplePendingKey", { name: "Aki" })).toBe("English fill Aki");
  });

  it("hard-fails on a release build (English must never ship to a translated player)", async () => {
    process.env.I18N_RELEASE = "1";
    const mod = await loadWithPending();
    mod.setLanguage("es");
    await mod.ensureLocaleLoaded("es");
    const tm = mod.t as unknown as (k: string) => string;
    expect(() => tm("__samplePendingKey")).toThrow(/pending/);
  });
});

// The release gate's empty-pending assertion, factored into one helper so the
// real-data check below and its teeth test run the SAME logic and cannot drift.
function assertNoPending(pendingByLang: Record<string, readonly string[]>) {
  for (const [lang, keys] of Object.entries(pendingByLang)) {
    expect(keys, `${lang} has unexpected pending keys`).toEqual([]);
  }
}

// RELEASE-TIER ONLY: a pending key is legal on a PR (the dense table English-fills
// it); the release gate is where the pending set must be empty.
describe.runIf(RELEASE_TIER)("t(): the committed pending set is empty (release tier)", () => {
  it("every locale's generated pending list is empty", () => {
    // Non-vacuous floor: the gate must actually enumerate the non-en locales, so a
    // future regression that collapsed `pending` to `{}` cannot pass by iterating
    // zero times.
    expect(Object.keys(realPending).length, "pending must enumerate the non-en locales").toBeGreaterThan(10);
    assertNoPending(realPending);
  });
});

// Teeth for the empty-pending GATE itself (runs at BOTH tiers; uses synthetic data,
// not the real/empty committed set). The check above only proves today's data is
// clean - it would still pass if the assertion were ever weakened or the data shape
// went to {}. Feeding the SAME assertNoPending() a non-empty map proves it FAILS, so
// the load-bearing "a pending key blocks the release gate" guarantee is asserted,
// not assumed. (The t() runtime hard-fail on a release build is the separate backstop
// covered by the doMock test above.)
describe("t(): the empty-pending gate has teeth (a non-empty pending set fails)", () => {
  it("throws when any locale carries a pending key", () => {
    const synthetic: Record<string, readonly string[]> = { es: [], de_DE: ["some.untranslated.key"], fr_FR: [] };
    expect(() => assertNoPending(synthetic)).toThrow(/de_DE has unexpected pending keys/);
  });
  it("does not false-positive on a clean all-empty map", () => {
    expect(() => assertNoPending({ es: [], de_DE: [], fr_FR: [] })).not.toThrow();
  });
});

// The throw-on-untracked path is reachable in production only through
// translatePage() in src/main.ts, which feeds index.html `data-i18n*` attribute
// values straight into t(). If any of those keys were not a real `en` leaf, the
// live client would throw mid-render (dev) or show a raw key (release). Pin every
// such key to the en leaf set so a typo'd attribute fails CI here instead.
describe("index.html data-i18n keys are all real en leaves", () => {
  function flatten(node: unknown, prefix = "", out = new Set<string>()): Set<string> {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const value = (node as Record<string, unknown>)[key];
      const p = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, p, out);
      else out.add(p);
    }
    return out;
  }
  const enLeaves = flatten(en);

  it("resolve via t() (no untracked attribute key)", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf8");
    const keys = new Set<string>();
    const re = /\bdata-i18n(?:-aria|-placeholder|-title|-alt|-content)?="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) keys.add(m[1]);
    expect(keys.size, "sanity: index.html should carry many data-i18n keys").toBeGreaterThan(50);
    const notLeaf = [...keys].filter((k) => !enLeaves.has(k)).sort();
    expect(notLeaf, "index.html data-i18n keys not present in en (would throw/leak in the client)").toEqual([]);
  });
});
