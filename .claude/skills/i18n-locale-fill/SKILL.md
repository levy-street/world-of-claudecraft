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
- **`humanRequired` entries are blocked by default** (quest narratives, names, lore, SEO
  copy): never machine-fill them; only `autoFillable` entries are fair game for a model pass.

Batches are per-language and independent: fan out one fill agent per language when the
volume is large, then regenerate once at the end.

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

## 3. Regenerate, re-baseline, verify

1. `npm run i18n:gen` regenerates the resolved bundles and the status registry.
2. **Stage the regenerated artifacts in the SAME commit as the fills.** The freshness gate
   diffs the regenerated output against the staged/committed copies; unstaged artifacts fail it.
3. If the resolved-table hash check fails (`tests/i18n_resolved_equivalence.test.ts`), the
   change was supposed to alter the table: re-baseline with
   `node scripts/i18n_resolved_hash.mjs --write` in the same commit.
4. Prove completion: run the i18n steps release-tier,
   `I18N_RELEASE_TIER=1 npm run gate` (or at minimum `i18n:gen` + the guard tests), and
   confirm zero `pending` rows remain.

## 4. Reword staleness (the silent trap)

Rewording an EXISTING English value does not mark its translations pending: every locale
silently keeps the old meaning. After any English copy change, diff the resolved `en` output
between the base branch and HEAD and re-fill the touched keys in the same change.
