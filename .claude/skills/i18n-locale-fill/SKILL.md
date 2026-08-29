---
name: i18n-locale-fill
description: Fill pending i18n rows across every locale for World of ClaudeCraft, the release-time workflow. Use when the release-tier gate (I18N_RELEASE_TIER=1) fails on pending rows, when asked to translate or fill locales, overlays, or matcher DICTs, or when preparing a release branch whose registry still has pending entries. Covers the worklist generator, where each scope's fills land, the placeholder and glossary contracts, and the known traps (English-in-overlay, shared DICT references, the "todo" guard, reword staleness, native punctuation in overlays).
user-invocable: true
---

# i18n locale fill (release time)

Contributors add ENGLISH only; the maintainer fills every locale at release. This skill is
that fill workflow. The release-tier gate (`I18N_RELEASE_TIER=1`, automatic on `release/**`
branches) hard-fails on any `pending` registry row, so a release is not shippable until the
fill lands.

## 1. Generate the worklist

```
npm run i18n:gen        # refresh the registry first
npm run i18n:worklist   # writes one batch per language under docs/i18n-scaling/worklist/ (gitignored)
```

`scripts/i18n_fill_worklist.mjs` is data-only (no translation): each batch entry carries
`{ scope, key, english, placeholders, siblings }`.

- `main`-scope keys are filled in the matching `src/ui/i18n.locales/<lang>.ts` overlay.
- `sim` / `server` / `admin` scope keys are filled in their matcher DICTs (the worklist
  header in `scripts/i18n_fill_worklist.mjs` names the exact files).
- **The worklist NEVER lists sim-scope keys**: the sim DICT builds every language over
  the English base table, so the scan classifies a sim row `translated` on presence
  alone and `scripts/i18n_fill_worklist.mjs` (which selects `pending` only) cannot see
  a missing fill. The net that does catch them is the release-tier S3 arm
  (`I18N_RELEASE_TIER=1 npx vitest run tests/localization_fixes.test.ts`, the
  `s3_localized` leak list): run it FIRST, and fill every sim key it names in the
  per-language `BASE_DICT` blocks of `src/ui/sim_i18n.newlocales.ts` even though no
  worklist batch mentions them.
- **`humanRequired` entries are blocked by default** (quest narratives, names, lore, SEO
  copy): never machine-fill them; only `autoFillable` entries are fair game for a model pass.

Batches are per-language and independent: fan out one fill agent per language when the
volume is large, then regenerate once at the end.

## 1b. The chunk families OUTSIDE the registry (deeds and reliquary)

The Deeds and Reliquary systems keep their locale tables in lazy per-base-locale chunks
that the registry and `scripts/i18n_fill_worklist.mjs` never see:
`src/ui/deed_i18n.locales/<locale>.ts` and `src/ui/reliquary_i18n.locales/<locale>.ts`
(loader contract pinned by `tests/deed_i18n_lazy.test.ts` and
`tests/reliquary_i18n_lazy.test.ts`). Consequences:

- **Zero pending registry rows does NOT prove full coverage.** A fill pass driven only by
  the worklist ships English deed/reliquary rows while the registry reads clean. Their
  coverage is enforced only by the release-tier arms (`it.runIf(I18N_RELEASE_TIER === '1')`)
  in `tests/deed_i18n.test.ts` and `tests/reliquary_i18n.test.ts`, which walk
  `deedTranslationManifest()` / `reliquaryTranslationManifest()` against every base
  locale table. Run those release-tier to prove this surface, not the pending count.
- Fill every base locale chunk in the family; a chunk carries only real catalog ids (the
  same tests reject a stale id or a title on a deed that rewards none).
- **The overlay punctuation exemption does NOT extend here.** These chunk files sit
  outside the `src/ui/i18n.locales` copy-scan exemption: no em/en dashes or emoji in any
  value, even where the locale would natively use them (the pin tests enforce it).

## 2. The fill contract

- **Translate, never transplant.** The registry counts PRESENCE, not language: pasting the
  English value into an overlay marks the row filled and silently ships English. Do not.
- **Placeholder parity.** Every `{token}` in the English value must appear verbatim in the
  fill (the worklist lists them). The scanner checks parity; a dropped token is a break.
- **Locked terminology.** Classic-MMO terms per locale live in `scripts/i18n_glossary.json`
  and are locked; follow them, and extend the glossary when a new recurring term appears.
- **Matcher DICT values must be literal string copies.** Never alias or share a reference
  between DICT rows; the matcher relies on per-row literals.
- **Native punctuation in overlays is legitimate.** Russian and other locales use real em
  dashes; NEVER strip them. The repo copy scans deliberately exclude `src/ui/i18n.locales`.
- **The placeholder guard flags a bare "todo" value**, which is also a real word in es/pt.
  Phrase such fills differently (for example "por hacer") so the guard does not trip.

## 3. Regenerate, verify

1. `npm run i18n:gen` regenerates the resolved bundles and the status registry.
2. **Biome-format every overlay file the fill touched** in the same change:
   `npx @biomejs/biome check --write src/ui/i18n.locales/<touched>.ts ...`. CJK and other
   wide-glyph fills blow the 100-column lineWidth silently (the line LOOKS short in an
   editor but is over by bytes), and the changed-files biome gate then fails a later round
   on a format diff you never saw (it cost the phase 13 closing gate its first round).
   Note biome SIZE-SKIPS files over 1.0 MiB (ru_RU is there already): gate green is not
   format evidence for those, and that is a known accepted state, not something to fix.
3. **Stage the regenerated artifacts in the SAME commit as the fills.** The freshness gate
   diffs the regenerated output against the staged/committed copies; unstaged artifacts fail it.
4. Prove completion: run the i18n steps release-tier,
   `I18N_RELEASE_TIER=1 npm run gate` (or at minimum `i18n:gen` + the guard tests), and
   confirm zero `pending` rows remain. Zero pending covers the REGISTRY only: the
   deed/reliquary chunk families (section 1b) are proven by their own release-tier test
   arms, not by the pending count.

## 4. Reword staleness (the silent trap)

Rewording an EXISTING English value does not mark its translations pending: every locale
silently keeps the old meaning. After any English copy change, diff the resolved `en` output
between the base branch and HEAD and re-fill the touched keys in the same change.
