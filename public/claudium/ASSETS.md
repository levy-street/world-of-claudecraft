# Claudium visual asset set

Generated via the Higgsfield MCP connector (Recraft V4.1), then composited and
web-optimized locally. Identity is pinned in
[CLAUDIUM_VISUAL_ID.md](CLAUDIUM_VISUAL_ID.md): a platinum coin with a hexagonal
bezel and a blue-essence-to-cyan arcane gem core, distinct from the gold $WOC token.

Only still assets referenced by the current Claudium storefront ship in the game
bundle. Unused animation and gift-card media are deliberately excluded to avoid
inflating web and native downloads.

## 1. Icons  (`icons/`)

Transparent WebP. Ladder sizes 512/256/128/64; the unsuffixed file is the 1024
master. `claudium_coin_master.png` is a PNG convenience copy of the coin.

| File (base) | Use in UI | Format / sizes |
|---|---|---|
| `claudium_coin` | The Claudium mark. Balance readout, any "Claudium" amount, currency chip. | WebP 1024/512/256/128/64 (+ PNG master) |
| `icon_wallet` | Balance / wallet entry point. | WebP 1024/512/256/128/64 |
| `icon_buy` | "Buy Claudium" action (coin + plus badge). | WebP 1024/512/256/128/64 |
| `icon_history` | Transaction history tab (coin in a circular arrow). | WebP 1024/512/256/128/64 |
| `icon_store` | Cosmetic store / spend entry (market awning). | WebP 1024/512/256/128/64 |
| `solana-icon` | SOL purchase rail brand mark in the buy flow. Third-party, see below. | WebP single size |
| `usdc-icon` | USDC purchase rail brand mark in the buy flow. Third-party, see below. | WebP single size |
| `stack_single` | Value tier: small amount. Composited from the real coin. | WebP 1024/512/256/128 |
| `stack_small` | Value tier: medium amount (3 coins). | WebP 1024/512/256/128 |
| `stack_large` | Value tier: large amount (coin pile). | WebP 1024/512/256/128 |
| `../claudium_coin_hero_3q` | Hero / marketing 3-4 angle of the coin. | WebP 1400w |

Light + dark: the icons are transparent, so they sit on either theme. No baked
background variant is needed; place them on the theme surface token directly.

`solana-icon` and `usdc-icon` are the one exception to the provenance above:
they are third-party brand marks for the crypto purchase rails
(`src/ui/claudium_window.ts`), not Recraft output, and ship as single-size
files with no ladder. Attribution lives in the repo-root `CREDITS.md`.

## Final vs. human-polish

Final and ready to wire:
- Coin, all four action icons, the three denomination tiers, the size ladders.

Would benefit from a human/artist pass (not blocking):
- `icon_history` and `icon_store` coins carry a slightly simpler sigil than the
  master coin's crescent-and-gem; a pass could unify the face exactly.
- The denomination `stack_large` is coins composited flat, not a true isometric
  heap; an artist could rebuild it as a 3D pile.

## Reviewer must check
- Formats/paths assume Vite static serving from `public/` (see `public/CLAUDE.md`);
  `icons/` assets are referenced by raw logical path, not the media manifest,
  matching how `ui/` assets are served.
