// Unit teeth for the release-fill worklist tool's PURE logic
// (scripts/i18n_fill_worklist.mjs). The end-to-end round-trip (introduce a
// pending key -> worklist -> fill -> scan -> pending shrinks) is proven by the
// implementer against the real registry; here we lock the load-bearing
// invariants that the full pipeline rests on, so a regression reports as a
// readable assertion rather than a leaked-prose batch:
//   - the STOPPING RULE: no prose key can ever be classified auto-fillable
//     (blocked-by-default; only recognised mechanical chrome is fillable);
//   - glossary pattern expansion is single-segment and deterministic;
//   - sibling selection is deterministic, excludes self, and is capped.
//
// Imports the .mjs the same way tests/i18n_status_registry.test.ts imports
// scripts/i18n_hash.mjs (pure helpers; the script's main() only runs as a CLI).

import { describe, it, expect } from "vitest";
// @ts-ignore - shared zero-dep JS tool (no .d.ts); same pattern as the registry test importing scripts/i18n_hash.mjs. We exercise its exported pure helpers.
import { classify, siblingKeys, expandGlossaryTerms, patternToRegExp, buildWorklistOutputs, assertAutoFillableHasNoProse } from "../scripts/i18n_fill_worklist.mjs";

type GlossaryTerm = { category: string; key: string };

describe("worklist classification (blocked-by-default; the stopping rule)", () => {
  // Real prose namespaces from the en key space (entities.* = 920 keys, plus
  // class names, class lore, and SEO marketing). NONE may be auto-fillable.
  const PROSE_MAIN = [
    "entities.quests.q_wolves.title",
    "entities.quests.q_wolves.objectives.0.label",
    "entities.abilities.fireball.name",
    "entities.abilities.fireball.description",
    "entities.items.worn_sword.name",
    "entities.mobs.forest_wolf.name",
    "entities.npcs.brother_aldric.name",
    "entities.zones.eastbrook_vale.name",
    "entities.dungeons.hollow_crypt.name",
    "classes.warrior",
    "classes.mageAria",
    "classDetails.lore.warrior",
    "seo.title",
    "seo.description",
  ];

  it("never marks a prose key auto-fillable", () => {
    for (const key of PROSE_MAIN) {
      const { fillable, reason } = classify("main", key);
      expect(fillable, `prose key must be human-required: ${key}`).toBe(false);
      expect(reason).toMatch(/human-required/);
    }
  });

  it("auto-fills recognised mechanical UI chrome", () => {
    const CHROME_MAIN = [
      "loading.worldProgress",
      "game.xp.suffix",
      "hud.target.level",
      "itemUi.bindOnPickup",
      "questUi.accept",
      "abilityUi.cooldown",
      "errors.noEnemyNearby",
      "nav.home",
      "a11y.characterActions",
      "classDetails.roles.warrior", // chrome, even though classDetails.lore.* is prose
      "realmTypes.pvp",
    ];
    for (const key of CHROME_MAIN) {
      expect(classify("main", key).fillable, `chrome key must be fillable: ${key}`).toBe(true);
    }
  });

  it("treats sim/server/admin DICT scopes as chrome", () => {
    expect(classify("sim", "anything.goes").fillable).toBe(true);
    expect(classify("server", "who.statusCombat").fillable).toBe(true);
    expect(classify("admin", "app.title").fillable).toBe(true);
  });

  it("defaults an unrecognised main-scope namespace to human-required", () => {
    // worldContent / wiki / news / comingSoon are not on the chrome allow-list:
    // blocked-by-default routes them to a human rather than guessing.
    for (const key of ["worldContent.intro", "wiki.title", "news.headline", "comingSoon.body", "totally.unknown.namespace"]) {
      expect(classify("main", key).fillable, `unclassified must default to human: ${key}`).toBe(false);
    }
  });

  it("classDetails.lore is prose but the rest of classDetails is chrome (prefix order matters)", () => {
    expect(classify("main", "classDetails.lore.druid").fillable).toBe(false);
    expect(classify("main", "classDetails.labels.strength").fillable).toBe(true);
    expect(classify("main", "classDetails.sections.equipment").fillable).toBe(true);
  });
});

describe("glossary pattern expansion (single-segment, deterministic)", () => {
  it("`*` matches exactly one dotted segment", () => {
    const re = patternToRegExp("entities.abilities.*.name");
    expect(re.test("entities.abilities.fireball.name")).toBe(true);
    expect(re.test("entities.abilities.fireball.description")).toBe(false);
    expect(re.test("entities.abilities.a.b.name")).toBe(false); // two segments for `*`
    expect(re.test("entities.abilities.name")).toBe(false); // missing the id segment
  });

  it("expands patterns against the en key set, sorted and de-duplicated", () => {
    const enKeys = [
      "classes.warrior",
      "classes.mage",
      "entities.abilities.fireball.name",
      "entities.abilities.fireball.description",
      "entities.abilities.frostbolt.name",
      "entities.zones.eastbrook_vale.name",
      "entities.zones.eastbrook_vale.welcome",
      "hud.unrelated",
    ].sort();
    const glossary = {
      categories: {
        classNames: { keyPatterns: ["classes.warrior", "classes.mage"] },
        abilityNames: { keyPatterns: ["entities.abilities.*.name"] },
        zoneNames: { keyPatterns: ["entities.zones.*.name"] },
      },
    };
    const terms: GlossaryTerm[] = expandGlossaryTerms(glossary, enKeys);
    expect(terms).toEqual([
      { category: "classNames", key: "classes.mage" },
      { category: "classNames", key: "classes.warrior" },
      { category: "abilityNames", key: "entities.abilities.fireball.name" },
      { category: "abilityNames", key: "entities.abilities.frostbolt.name" },
      { category: "zoneNames", key: "entities.zones.eastbrook_vale.name" },
    ]);
    // Deterministic: a second expansion is identical.
    expect(expandGlossaryTerms(glossary, enKeys)).toEqual(terms);
    // The description/welcome keys (not name) are not pulled in by the *.name patterns.
    expect(terms.some((t) => t.key.endsWith(".description") || t.key.endsWith(".welcome"))).toBe(false);
  });
});

describe("sibling selection (deterministic context)", () => {
  const scopeKeys = [
    "loading.world",
    "loading.worldProgress",
    "loading.enteringWorld",
    "loading.connectingRealm",
    "loading.assetsFailed",
    "loading.rendererFailed",
    "loading.enterTimeout",
    "loading.connectionLost",
    "loading.connectionRejected",
    "game.xp.suffix",
  ].sort();

  it("returns neighbours sharing the parent prefix, excluding self, capped", () => {
    const sibs = siblingKeys("loading.worldProgress", scopeKeys, 6);
    expect(sibs.length).toBeLessThanOrEqual(6);
    expect(sibs).not.toContain("loading.worldProgress"); // never itself
    for (const k of sibs) expect(k.startsWith("loading.")).toBe(true); // same namespace
    expect(sibs).not.toContain("game.xp.suffix"); // a different namespace
  });

  it("is deterministic across calls", () => {
    const a = siblingKeys("loading.worldProgress", scopeKeys, 6);
    const b = siblingKeys("loading.worldProgress", scopeKeys, 6);
    expect(a).toEqual(b);
  });

  it("returns no siblings for a lone key with no namespace family", () => {
    expect(siblingKeys("solo.lonely", ["solo.lonely"], 6)).toEqual([]);
  });
});

// End-to-end assembly teeth: drive the PURE core buildWorklistOutputs against a
// fixture registry (no fs, no esbuild, no CLI). This locks the two invariants the
// QA spec names that the pure-helper tests above do NOT reach:
//   (a) the output is DETERMINISTIC / byte-stable on unchanged inputs (the no-op),
//       and the inputHash actually moves when an English value changes (teeth);
//   (b) a pending PROSE key routes to humanRequired and is ABSENT from autoFillable
//       end to end (not just at the classify() unit level), plus the glossary ships
//       in every batch and resolves each term per-locale.
describe("worklist assembly (deterministic + blocked-prose segregation, end to end)", () => {
  // A minimal but representative in-memory registry + sources. de_DE has 3 pending
  // keys: one chrome (loading.worldProgress, with {done}/{total}), two prose
  // (classes.mage, entities.quests.q_wolves.title). es is fully translated (no work).
  const enFlat: Record<string, string> = {
    "loading.world": "Loading world...",
    "loading.worldProgress": "Loading world... {done}/{total}",
    "loading.enteringWorld": "Entering world...",
    "classes.mage": "Mage",
    "classes.warrior": "Warrior",
    "entities.quests.q_wolves.title": "Wolves at the Door",
    "nav.home": "Home",
  };
  const dictEn = {
    sim: { "combat.miss": "Miss" },
    server: { "who.online": "Online" },
    admin: { "app.title": "Admin" },
  };
  // de_DE has translated the glossary term classes.warrior (own overlay) but not mage.
  const overlays: Record<string, Record<string, string>> = { de_DE: { "classes.warrior": "Krieger" }, es: {} };
  const glossarySrc = {
    verbatim: [{ term: "World of ClaudeCraft", note: "brand" }],
    categories: { classNames: { keyPatterns: ["classes.mage", "classes.warrior"] } },
  };
  const P = { state: "pending" };
  const T = { state: "translated" };
  const row = (scope: string, de: typeof P | typeof T) => ({ scope, enHash: "h", locales: { de_DE: de, es: T } });
  const makeFixture = () => ({
    registry: {
      hashAlgo: "sha256(enText + sortedPlaceholders).slice(0,16)",
      locales: ["de_DE", "es"],
      keys: {
        "main:loading.world": row("main", T),
        "main:loading.worldProgress": row("main", P), // chrome -> autoFillable
        "main:loading.enteringWorld": row("main", T),
        "main:classes.mage": row("main", P), // prose -> humanRequired
        "main:classes.warrior": row("main", T),
        "main:entities.quests.q_wolves.title": row("main", P), // prose -> humanRequired
        "main:nav.home": row("main", T),
      },
    },
    enFlat: { ...enFlat },
    dictEn,
    overlays,
    glossarySrc,
    targetLocales: ["de_DE", "es"],
    scope: "all-locales" as const,
  });

  it("(a) is deterministic: identical inputs produce byte-identical fileEntries + inputHash", () => {
    const a = buildWorklistOutputs(makeFixture());
    const b = buildWorklistOutputs(makeFixture());
    expect(JSON.stringify(a.fileEntries)).toBe(JSON.stringify(b.fileEntries));
    expect(a.inputHash).toBe(b.inputHash);
    // The no-op cache rests on inputHash; prove it is NOT a constant by changing one
    // English value and asserting the hash moves (otherwise the cache could never
    // detect a real change, and the no-op claim would be vacuous).
    const fx = makeFixture();
    fx.enFlat["loading.worldProgress"] = "Loading world... {done}/{total}!";
    expect(buildWorklistOutputs(fx).inputHash).not.toBe(a.inputHash);
  });

  it("(b) routes a pending prose key to humanRequired and NEVER to autoFillable, end to end", () => {
    const { batchObjs, fileEntries } = buildWorklistOutputs(makeFixture());
    const de = batchObjs.get("de_DE");
    expect(de, "de_DE has pending work, so it gets a batch").not.toBeNull();

    // chrome key lands in autoFillable with placeholders + siblings
    const wp = de.autoFillable.find((e: any) => e.key === "loading.worldProgress");
    expect(wp, "chrome key must be auto-fillable").toBeTruthy();
    expect(wp.placeholders).toEqual(["done", "total"]);
    expect(wp.siblings.length).toBeGreaterThan(0);
    expect(wp.siblings.every((s: any) => s.key.startsWith("loading."))).toBe(true);

    // both prose keys land in humanRequired and are ABSENT from autoFillable
    for (const pk of ["classes.mage", "entities.quests.q_wolves.title"]) {
      expect(de.humanRequired.some((e: any) => e.key === pk), `prose ${pk} in humanRequired`).toBe(true);
      expect(de.autoFillable.some((e: any) => e.key === pk), `prose ${pk} not in autoFillable`).toBe(false);
    }
    // stopping rule across the WHOLE batch: no autoFillable entry is prose
    const PROSE = ["entities.", "classes.", "classDetails.lore.", "seo."];
    expect(de.autoFillable.every((e: any) => e.scope !== "main" || !PROSE.some((p) => e.key.startsWith(p)))).toBe(true);

    // a fully-translated language produces no batch and no file entry
    expect(batchObjs.get("es")).toBeNull();
    expect(fileEntries.map(([name]: [string, unknown]) => name)).toEqual(["de_DE.json"]);
  });

  it("ships the glossary in every batch and resolves each term per-locale (own overlay -> English)", () => {
    const { batchObjs } = buildWorklistOutputs(makeFixture());
    const de = batchObjs.get("de_DE");
    expect(de.glossary.verbatim.map((v: any) => v.term)).toContain("World of ClaudeCraft");
    expect(de.glossary.terms.length).toBeGreaterThan(0);
    // classes.warrior is translated in the de_DE overlay -> established localized form
    expect(de.glossary.terms.find((t: any) => t.key === "classes.warrior").localized).toBe("Krieger");
    // classes.mage has no de_DE overlay value -> falls through to English (not invented)
    expect(de.glossary.terms.find((t: any) => t.key === "classes.mage").localized).toBe("Mage");
  });

  it("the belt-and-suspenders stopping-rule assertion bites if a prose key is in autoFillable", () => {
    // Independent of the (correct) classifier: a forced prose entry must throw.
    expect(() => assertAutoFillableHasNoProse([{ scope: "main", key: "classes.mage" }])).toThrow(/leaked into autoFillable/);
    expect(() => assertAutoFillableHasNoProse([{ scope: "main", key: "entities.quests.q_wolves.title" }])).toThrow(/leaked into autoFillable/);
    // A genuinely chrome-only autoFillable list does not throw (no false positive).
    expect(() =>
      assertAutoFillableHasNoProse([
        { scope: "main", key: "loading.worldProgress" },
        { scope: "sim", key: "combat.miss" },
      ]),
    ).not.toThrow();
  });
});
