// The stored-locale modulepreload: the build hook that templates each lazy locale chunk's
// content-hashed URL into dist/index.html for the stored-locale modulepreload. Exercises
// the pure helpers (parse loaders -> resolve manifest -> inject) and pins the contract
// between the committed index.html sentinel and the hook.
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore - shared zero-dep JS build tool (no .d.ts); same pattern as the registry test importing scripts/i18n_hash.mjs.
import { PLACEHOLDER, GENERATED_DIR, parseSupportedLocales, localeChunkMap, injectLocaleChunkMap, templateModulepreload } from "../scripts/i18n_modulepreload.mjs";
import { LOCALE_LOADERS, SUPPORTED_LANGUAGES } from "../src/ui/i18n.resolved.generated/loaders";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("i18n modulepreload build hook", () => {
  describe("parseSupportedLocales", () => {
    it("extracts the non-en locale set from the real generated loaders source", () => {
      const source = readFileSync(path.join(root, GENERATED_DIR, "loaders.ts"), "utf8");
      const locales = parseSupportedLocales(source);
      // Exactly SUPPORTED_LANGUAGES minus 'en' == the lazy-chunked locales (LOCALE_LOADERS keys).
      expect(locales).toEqual(SUPPORTED_LANGUAGES.filter((l) => l !== "en"));
      expect(locales).toEqual(Object.keys(LOCALE_LOADERS));
      expect(locales).not.toContain("en");
      expect(locales).not.toContain("en_XA");
    });

    it("throws when the array cannot be parsed", () => {
      expect(() => parseSupportedLocales("export const NOPE = 1;")).toThrow(/SUPPORTED_LANGUAGES/);
    });
  });

  describe("localeChunkMap", () => {
    const manifest = {
      "index.html": { file: "index.html", isEntry: true },
      "src/main.ts": { file: "assets/main-deadbeef.js", isEntry: true },
      "src/ui/i18n.resolved.generated/es.ts": { file: "assets/es-aaaa1111.js" },
      "src/ui/i18n.resolved.generated/de_DE.ts": { file: "assets/de_DE-bbbb2222.js" },
      // The admin twin must never be matched (admin stays static; no per-locale chunks).
      "src/admin/i18n.resolved.generated/es.ts": { file: "assets/admin-es-cccc.js" },
    };

    it("resolves each locale to its absolute, same-origin hashed chunk URL", () => {
      expect(localeChunkMap(manifest, ["es", "de_DE"])).toEqual({
        es: "/assets/es-aaaa1111.js",
        de_DE: "/assets/de_DE-bbbb2222.js",
      });
    });

    it("honors a non-root base", () => {
      expect(localeChunkMap(manifest, ["es"], "/app/")).toEqual({ es: "/app/assets/es-aaaa1111.js" });
    });

    it("joins a base WITHOUT a trailing slash (Vite base:'/app')", () => {
      // Exercises joinBase's else-branch (the base does not end in '/'), which neither the
      // slash-terminated default nor the '/app/' case ever reaches.
      expect(localeChunkMap(manifest, ["es"], "/app")).toEqual({ es: "/app/assets/es-aaaa1111.js" });
    });

    it("only matches the game generated dir, never the admin twin", () => {
      const map = localeChunkMap(manifest, ["es"]);
      expect(map.es).toBe("/assets/es-aaaa1111.js");
      expect(map.es).not.toContain("admin");
    });

    it("throws (STOP rule) when a locale has no chunk in the manifest", () => {
      expect(() => localeChunkMap(manifest, ["es", "fr_FR"])).toThrow(/fr_FR/);
    });
  });

  describe("injectLocaleChunkMap", () => {
    it("replaces the sentinel with the JSON map literal", () => {
      const html = `<script>var m = ${PLACEHOLDER};</script>`;
      const out = injectLocaleChunkMap(html, { es: "/assets/es-aaaa1111.js" });
      expect(out).toBe(`<script>var m = {"es":"/assets/es-aaaa1111.js"};</script>`);
      expect(out).not.toContain(PLACEHOLDER);
      // Parse the literal extracted from the ACTUAL output (not a fresh object) so the assertion
      // genuinely guards that injection emits parseable JSON the inline script can evaluate.
      const injected = out.slice(out.indexOf("= ") + 2, out.indexOf(";"));
      expect(JSON.parse(injected)).toEqual({ es: "/assets/es-aaaa1111.js" });
    });

    it("throws when the sentinel is absent (silent never-preload guard)", () => {
      expect(() => injectLocaleChunkMap("<head></head>", {})).toThrow(/sentinel/);
    });

    it("escapes '<' so the inline-script JSON cannot break out of </script>", () => {
      const out = injectLocaleChunkMap(`x=${PLACEHOLDER};`, { es: "/assets/</script><x>-h.js" });
      expect(out).not.toContain("</script>");
      expect(out).toContain("\\u003c/script>");
    });
  });

  describe("committed index.html contract", () => {
    const html = readFileSync(path.join(root, "index.html"), "utf8");

    it("carries the sentinel exactly once so the build hook can template it", () => {
      const count = html.split(PLACEHOLDER).length - 1;
      expect(count).toBe(1);
    });

    it("ships the inline modulepreload boot script with a matching crossorigin", () => {
      // Intent-level (whitespace/quote-tolerant) matches: a harmless reformat of the inline
      // script must not break the contract, while a real regression (no localStorage read /
      // wrong rel / missing crossorigin) still fails.
      expect(html).toMatch(/localStorage\.getItem\(\s*['"]locale['"]\s*\)/);
      expect(html).toMatch(/\.rel\s*=\s*['"]modulepreload['"]/);
      expect(html).toMatch(/\.crossOrigin\s*=\s*['"]anonymous['"]/i);
    });
  });

  describe("templateModulepreload (FS orchestrator the Vite closeBundle plugin calls)", () => {
    it("resolves the manifest + loaders source and rewrites dist/index.html in place", () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "i18n-mp-"));
      try {
        const outDir = path.join(tmp, "dist");
        const genDir = path.join(tmp, GENERATED_DIR);
        mkdirSync(path.join(outDir, ".vite"), { recursive: true });
        mkdirSync(genDir, { recursive: true });
        // Minimal loaders source the parser reads (only SUPPORTED_LANGUAGES matters here).
        writeFileSync(path.join(genDir, "loaders.ts"), "export const SUPPORTED_LANGUAGES = ['en', 'es', 'de_DE'] as const;\n");
        writeFileSync(path.join(outDir, ".vite", "manifest.json"), JSON.stringify({
          "src/ui/i18n.resolved.generated/es.ts": { file: "assets/es-aaaa1111.js" },
          "src/ui/i18n.resolved.generated/de_DE.ts": { file: "assets/de_DE-bbbb2222.js" },
          // The admin twin must never be matched (admin stays static; no per-locale chunks).
          "src/admin/i18n.resolved.generated/es.ts": { file: "assets/admin-es-cccc.js" },
        }));
        writeFileSync(path.join(outDir, "index.html"), `<head><script>var m = ${PLACEHOLDER};</script></head>`);

        const { map, htmlPath, manifestPath } = templateModulepreload({ root: tmp, outDir, base: "/" });

        // Exactly the non-en locales, resolved to their hashed same-origin URLs (admin excluded).
        expect(map).toEqual({ es: "/assets/es-aaaa1111.js", de_DE: "/assets/de_DE-bbbb2222.js" });
        // The orchestrator reports the paths it touched.
        expect(htmlPath).toBe(path.join(outDir, "index.html"));
        expect(manifestPath).toBe(path.join(outDir, ".vite", "manifest.json"));
        // index.html is rewritten in place: the sentinel is gone and the JSON map is embedded.
        const rewritten = readFileSync(htmlPath, "utf8");
        expect(rewritten).not.toContain(PLACEHOLDER);
        expect(rewritten).toContain('{"es":"/assets/es-aaaa1111.js","de_DE":"/assets/de_DE-bbbb2222.js"}');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("propagates the fail-closed throw when a locale has no manifest chunk", () => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), "i18n-mp-"));
      try {
        const outDir = path.join(tmp, "dist");
        const genDir = path.join(tmp, GENERATED_DIR);
        mkdirSync(path.join(outDir, ".vite"), { recursive: true });
        mkdirSync(genDir, { recursive: true });
        writeFileSync(path.join(genDir, "loaders.ts"), "export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr_FR'] as const;\n");
        // The manifest is missing fr_FR -> the hook must STOP (hard error), not silently skip it.
        writeFileSync(path.join(outDir, ".vite", "manifest.json"), JSON.stringify({
          "src/ui/i18n.resolved.generated/es.ts": { file: "assets/es-aaaa1111.js" },
        }));
        writeFileSync(path.join(outDir, "index.html"), `<head><script>var m = ${PLACEHOLDER};</script></head>`);
        expect(() => templateModulepreload({ root: tmp, outDir, base: "/" })).toThrow(/fr_FR/);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
