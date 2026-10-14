# Future Hunter ability icons

Approved art prepared for the future Bear Trap and Molotov Cocktail abilities in
PR #4488. These abilities do not exist yet. The images are retained here until
their implementation, outside the shipped skill directory and icon registry.

| Intended ability | Ready-to-use image | Subject |
|---|---|---|
| Bear Trap | [bear_trap.webp](bear_trap.webp) | Open steel bear trap |
| Molotov Cocktail | [molotov_cocktail.webp](molotov_cocktail.webp) | Flaming green glass bottle |

Both images are opaque 128x128 sRGB WebP, below the 15 KiB intake cap. They were
generated with OpenAI built-in image generation, approved by Reuben, and converted
with `scripts/convert_skill_icons_webp.mjs`. Owner: World of ClaudeCraft.
License: project-generated art, project asset, rights reserved.

When the abilities are implemented:

1. Move each WebP to `public/ui/skills/hunter/<actual-ability-id>.webp`.
2. Add its provenance to `public/ui/skills/hunter/mapping.json` and its actual
   ability ID to `ABILITY_IMAGE_IDS` in `src/ui/icons.ts`.
3. Remove any matching `ABILITY_ART_PENDING` entry and update this note and
   `CREDITS.md` to point to the shipping location.
4. Run `tests/skill_icons.test.ts` and `tests/ability_icons.test.ts`.

These paintings are reserved for the new abilities. Frostjaw Trap and Shrapnel
Charge retain their existing art.
