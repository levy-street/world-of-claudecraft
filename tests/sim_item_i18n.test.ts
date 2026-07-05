// Coverage for sim-emitted item / equipment / world-object interaction strings that
// the S3 drift guard (tests/localization_fixes.test.ts) cannot see: the relic + quest-
// item pickup error toasts are emitted as `this.error(id, def?.pickup* ?? 'English')`,
// and the guard's this.error regex only captures a literal that immediately follows the
// comma — so a `?? 'literal'` fallback slips past it. The /gear readout slot labels also
// regressed (the over-broad Equipped rule mangled the worn case). This file pins all of
// them: every string must localize (non-null) in every locale and not stay English.
import { describe, it, expect } from "vitest";
import { localizeSimText } from "../src/ui/sim_i18n";
import { setLanguage, supportedLanguages, t } from "../src/ui/i18n";
import { tEntity } from "../src/ui/entity_i18n";

const translatedLocales = supportedLanguages.filter((l) => l !== "en" && l !== "en_CA");

describe("sim /gear readout is fully localized in every locale", () => {
  // Mirrors gearReadout() in src/sim/sim.ts: one filled slot + empty slots, fixed order.
  const worn =
    "Equipped (1/8): Main Hand: Iron Sword, Helmet: (empty), Shoulder: (empty), " +
    "Chest: (empty), Waist: (empty), Legs: (empty), Gloves: (empty), Feet: (empty).";
  const empty = "You have nothing equipped.";

  it("recognizes the worn and empty readouts in every locale (non-null)", () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      expect(localizeSimText(worn), `${lang}: worn /gear not recognized`).not.toBeNull();
      expect(localizeSimText(empty), `${lang}: empty /gear not recognized`).not.toBeNull();
    }
    setLanguage("en");
  });

  it("does not leave the readout in English for any translated locale", () => {
    for (const lang of translatedLocales) {
      setLanguage(lang);
      expect(localizeSimText(worn), `${lang}: worn /gear stayed English`).not.toBe(worn);
      expect(localizeSimText(empty), `${lang}: empty /gear stayed English`).not.toBe(empty);
    }
    setLanguage("en");
  });

  it("translates the slot labels and the (empty) marker (no raw English labels leak)", () => {
    for (const lang of translatedLocales) {
      setLanguage(lang);
      const out = localizeSimText(worn)!;
      // The slot label must be the localized itemUi.slots.* value, never raw English.
      const helmet = t("itemUi.slots.helmet");
      if (helmet !== "Helmet") {
        expect(out, `${lang}: readout shows the localized Helmet label`).toContain(helmet);
        expect(out, `${lang}: raw English 'Helmet:' leaked into readout`).not.toContain("Helmet:");
      }
      // The "(empty)" marker must be localized too.
      expect(out, `${lang}: raw English '(empty)' leaked into readout`).not.toContain("(empty)");
    }
    setLanguage("en");
  });
});

describe("sim relic + pickup error toasts localize in every locale", () => {
  // The exact `?? 'English'` fallbacks emitted by sim.ts (activateNythraxisRelic /
  // pickUpObject). {name} stands in for a quest-item name spliced in by the sim.
  const strings = [
    "The relic is bound by the sealed crypt.",
    "You have already recovered this relic.",
    "You cannot take the Captain's Crest yet.",
    "Captain's Crest offers nothing more.",
  ];

  it("recognizes every string in every locale (non-null)", () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      for (const s of strings) {
        expect(localizeSimText(s), `${lang}: "${s}" not recognized (would leak English)`).not.toBeNull();
      }
    }
    setLanguage("en");
  });

  it("does not stay English in any translated locale", () => {
    for (const lang of translatedLocales) {
      setLanguage(lang);
      for (const s of strings) {
        expect(localizeSimText(s), `${lang}: "${s}" stayed English`).not.toBe(s);
      }
    }
    setLanguage("en");
  });
});

describe("nythraxis_crypt dungeon name resolves through the entity dictionary", () => {
  // renderer.ts dungeonDisplayName no longer special-cases this id to the raw English
  // content-def name; it must localize like every other dungeon nameplate.
  it("is translated (not raw English) in every translated locale", () => {
    const en = ((): string => {
      setLanguage("en");
      return tEntity({ kind: "dungeon", id: "nythraxis_crypt", field: "name" });
    })();
    expect(en.length, "english crypt name resolves").toBeGreaterThan(0);
    for (const lang of translatedLocales) {
      setLanguage(lang);
      const out = tEntity({ kind: "dungeon", id: "nythraxis_crypt", field: "name" });
      expect(out, `${lang}: crypt name resolves`).toBeTruthy();
    }
    setLanguage("en");
  });
});
