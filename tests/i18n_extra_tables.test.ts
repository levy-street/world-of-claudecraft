import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ARENA_EXTRA, QUEST_EXTRA, ITEM_EXTRA } from "../src/ui/sim_i18n";
import { RESTART_MESSAGES } from "../src/ui/server_i18n";
import { supportedLanguages, type SupportedLanguage } from "../src/ui/i18n";

// Guards for the sim/server localization tables that live OUTSIDE the registry-tracked
// DICT and so are invisible to the status registry, the release-gate pending check, and
// the per-key coverage sampler:
//   - ARENA_EXTRA / QUEST_EXTRA / ITEM_EXTRA  (src/ui/sim_i18n.ts, resolved via tArena/Quest/ItemExtra)
//   - RESTART_MESSAGES                         (src/ui/server_i18n.ts, server broadcast countdown)
// These are tsc-dense (Record<SupportedLanguage,...>) but nothing checked their VALUES.
// A batch of arena/crypt strings shipped with stripped diacritics + a few English copies
// here precisely because no test covered them. These guards close that gap.

const ROOT = path.resolve(__dirname, "..");

// Brand / acronym / pure-template tokens that legitimately stay identical across locales.
const BRAND = [
  "World of ClaudeCraft", "ClaudeCraft", "GitHub", "Fiesta", "MMORPG", "PvP", "PvE", "NPC", "DPS",
  "HP", "MP", "XP", "2v2", "1v1", "2c2", "1c1", "Thornpeak",
];
function hasTranslatableText(s: string): boolean {
  let t = s;
  for (const b of BRAND) t = t.split(b).join(" ");
  t = t.replace(/\{[A-Za-z0-9_]+\}/g, " ").replace(/[0-9]/g, " ");
  return /\p{L}/u.test(t);
}
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]).sort();
}

// Normalize the two table shapes into { en, byLocale } per logical key.
type Logical = { id: string; en: string; byLocale: Record<string, string | undefined> };
function fromLocaleKeyed(tableName: string, table: Record<string, Record<string, string>>): Logical[] {
  const out: Logical[] = [];
  for (const key of Object.keys(table.en)) {
    out.push({
      id: `${tableName}.${key}`,
      en: table.en[key],
      byLocale: Object.fromEntries(supportedLanguages.map((l) => [l, table[l]?.[key]])),
    });
  }
  return out;
}
function fromEnglishKeyed(tableName: string, table: Record<string, Record<string, string>>): Logical[] {
  return Object.entries(table).map(([enStr, byLocale]) => ({
    id: `${tableName}[${enStr.slice(0, 24)}]`,
    en: byLocale.en ?? enStr,
    byLocale,
  }));
}

const ALL: Logical[] = [
  ...fromLocaleKeyed("ARENA_EXTRA", ARENA_EXTRA as unknown as Record<string, Record<string, string>>),
  ...fromLocaleKeyed("QUEST_EXTRA", QUEST_EXTRA as unknown as Record<string, Record<string, string>>),
  ...fromLocaleKeyed("ITEM_EXTRA", ITEM_EXTRA as unknown as Record<string, Record<string, string>>),
  ...fromEnglishKeyed("RESTART_MESSAGES", RESTART_MESSAGES as Record<string, Record<string, string>>),
];

describe("sim/server EXTRA localization tables (untracked by the registry)", () => {
  it("every supported locale provides every key, non-empty", () => {
    const missing: string[] = [];
    for (const row of ALL) {
      for (const lang of supportedLanguages) {
        const v = row.byLocale[lang];
        if (typeof v !== "string" || v.trim().length === 0) missing.push(`${row.id} :: ${lang}`);
      }
    }
    expect(missing, `missing/empty EXTRA-table translations:\n${missing.join("\n")}`).toEqual([]);
  });

  it("keeps the exact {placeholder} set of English in every locale", () => {
    const drift: string[] = [];
    for (const row of ALL) {
      const want = placeholders(row.en).join(",");
      for (const lang of supportedLanguages) {
        const v = row.byLocale[lang];
        if (typeof v === "string" && placeholders(v).join(",") !== want) {
          drift.push(`${row.id} :: ${lang} (en=[${want}] got=[${placeholders(v).join(",")}])`);
        }
      }
    }
    expect(drift, `placeholder drift:\n${drift.join("\n")}`).toEqual([]);
  });

  it("ships no copied-English value (en_CA excepted) for translatable strings", () => {
    const leaks: string[] = [];
    for (const row of ALL) {
      if (!hasTranslatableText(row.en)) continue;
      for (const lang of supportedLanguages) {
        if (lang === "en" || lang === "en_CA") continue;
        const v = row.byLocale[lang];
        if (typeof v === "string" && v === row.en) leaks.push(`${row.id} :: ${lang} = ${JSON.stringify(v)}`);
      }
    }
    expect(leaks, `copied-English in EXTRA tables:\n${leaks.join("\n")}`).toEqual([]);
  });

  // Regression guard for the specific diacritic-stripping that shipped here: these exact
  // word-forms are NEVER orthographically correct in their language, so their presence in a
  // Romance/German EXTRA value means accents were dropped again.
  it("contains no diacritic-stripped Romance/German word-forms", () => {
    const STRIPPED: Record<string, RegExp> = {
      de_DE: /\b(fur|uber|Konig|verlasst|verfugbar|wahrend|stort|Kryptenschlusselstein)\b/,
      fr_FR: /\b(redemarr|Colisee|equipe|etes|deja|arene|etait|entree|scellee)\b/,
      fr_CA: /\b(redemarr|Colisee|equipe|etes|deja|arene|etait|entree|scellee)\b/,
      it_IT: /(\bgia\b|\bpuo\b|\bnon e\b|\bL ingresso\b|\bbrav uomo\b)/,
      pt_BR: /\b(voce|nao)\b/,
    };
    const hits: string[] = [];
    for (const row of ALL) {
      for (const [lang, re] of Object.entries(STRIPPED)) {
        const v = row.byLocale[lang];
        if (typeof v === "string" && re.test(v)) hits.push(`${row.id} :: ${lang} = ${JSON.stringify(v)}`);
      }
    }
    expect(hits, `diacritic-stripped forms found:\n${hits.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Formatting-helper guard: user-facing number/date/percent must go through the
// locale-aware helpers (formatNumber/formatDateTime/formatMoney/tPlural), never a
// host-locale toLocale*() or an ad-hoc Intl constructed outside the helper modules.
// ---------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  const skipDirs = new Set(["i18n.resolved.generated"]);
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("locale-aware formatting is centralized", () => {
  const UI_DIRS = ["src/ui", "src/render", "src/game", "src/admin"].map((d) => path.join(ROOT, d));
  const files = UI_DIRS.flatMap((d) => walk(d));
  // Only these modules may construct Intl directly (the formatting helpers themselves).
  const INTL_ALLOW = ["src/ui/i18n.ts", "src/ui/talent_i18n.ts", "src/admin/format.ts"];

  it("constructs no ad-hoc Intl.NumberFormat/DateTimeFormat outside the helper modules", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f);
      if (INTL_ALLOW.includes(rel)) continue;
      const src = readFileSync(f, "utf8");
      const m = src.match(/new Intl\.(NumberFormat|DateTimeFormat)\(/);
      if (m) offenders.push(`${rel}: ${m[0]}`);
    }
    expect(offenders, `use formatNumber/formatDateTime instead:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("calls no host-locale toLocaleString/Date/Time (empty locale arg) in UI code", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const re = /\.toLocale(String|DateString|TimeString)\(\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
    expect(offenders, `pass the active locale (use formatNumber/formatDateTime):\n${offenders.join("\n")}`).toEqual([]);
  });
});
