# Item Icon Art Style

Status: canonical
Contract id: `woc-item-icon-v1`
Applies to: every image that represents an item in bags, bank, equipment, vendor, loot,
mail, quest rewards, tooltips, action slots, and the guide

This document is the source of truth for new and replacement item paintings. The short form
is:

> Classic dark-fantasy MMORPG painted inventory art; tactile material rendering; opaque dark
> painted ground; top-left key light; centered complete subject; no accidental writing, crop,
> frame, transparency, or watermark.

The objective is one recognizable item catalog, not a collection of source-pack styles. Item
quality borders, slot wells, cooldowns, stack counts, and interaction states belong to the UI and
must never be painted into the asset.

## Visual grammar

### Subject and composition

- Show one tangible inventory subject. A natural pair is allowed for boots, gloves, earrings, or
  another item whose identity depends on being a pair.
- Preserve the item's authored identity: silhouette, material, construction, palette, damage,
  magical school, and lore-specific ornament.
- Read the live item name, description, quest text, recipe, set, and upgrade relationship before
  painting. Items that combine must share one material and ornament language, use visibly
  complementary joins, and make the assembled reward read as those same parts fitted together.
  Tiered siblings should feel related without becoming recolors or duplicate silhouettes.
- Center the complete silhouette with safe padding on all four sides. The subject normally fills
  68 to 76 percent of the square. Long weapons and tools may use a corner-to-corner diagonal but
  must retain their tip, pommel, and a visible margin.
- Prefer a front or readable three-quarter presentation. Do not use extreme perspective,
  mannequin presentation, a hand holding the item, or a distant environmental scene.
- The silhouette must still identify the object at 22px and inside a circular action-slot crop.

### Light, color, and material

- Use a warm key light from the top-left and a cool, deep shadow toward the bottom-right.
- Paint tactile material differences. Metal needs a controlled edge highlight and broad reflected
  value; leather needs grain and warm wear; cloth needs folds and a soft sheen; wood needs grain;
  glass and liquid need a crisp rim, internal value, and a small specular accent.
- Keep the ground low-key: deep charcoal, umber, navy, or a restrained zone tint. It is a painted
  vignette with subtle atmosphere and contact shadow, not a flat black product-photo void.
- Keep the subject brighter and sharper than the perimeter. Reserve the highest contrast for its
  identity-bearing edge, face, blade, opening, label-free seal, or contents.
- Magical light supports the object. It must not erase the silhouette, flood the whole square, or
  become the primary subject unless the item itself is energy.
- Rarity may influence finish and accent richness, but never adds a baked rarity border or changes
  the item's established lore palette.

### Paint treatment

- Use premium hand-painted classic fantasy MMO rendering with crisp focal edges, softer peripheral
  brushwork, and controlled detail density.
- Avoid photographic rendering, raw 3D thumbnails, flat vectors, cel shading, plastic gradients,
  pixel art, sketch lines, and source-pack cartoon outlines.
- Do not add letters, numbers, words, labels, pseudo-writing, UI chrome, a frame, a checkerboard,
  transparency, watermarks, signatures, split sheets, or a collage. A deliberate lore symbol may
  appear only when it is part of the authored item's identity; it must read as one intentional
  emblem, seal, or magical mark rather than accidental generated script or a generic rune
  substitute.
- Do not duplicate an existing painting for a differently named authored item. Generated Heroic
  variants may intentionally inherit their authored base item's art when the data model says so.

## Family composition

| Family | Required read |
| --- | --- |
| One-handed weapon | Full weapon on a strong diagonal, distinct guard or head, grip visible |
| Two-handed weapon or staff | Full long silhouette corner-to-corner, no clipped tip or base |
| Shield or held offhand | Front or slight three-quarter face, construction and rim readable |
| Helmet | One centered headpiece with no head, face, shoulders, or mannequin |
| Chest armor or robe | Front-facing torso garment with no body, head, or floating hands |
| Gloves or boots | One strong item or a compact natural pair, never a scattered pile |
| Legs, belt, shoulders | Slot shape immediately readable, symmetric unless identity requires otherwise |
| Ring, necklace, trinket | One hero object, large enough to read; restrained glow may separate fine metal |
| Bag or container | Three-quarter volume, opening or closure readable, no unrelated loose inventory |
| Tool | Complete working silhouette with material wear and the functional end emphasized |
| Food | One plated serving or compact ingredient group, warm appetizing light, no table scene |
| Drink, potion, elixir | One vessel, liquid level and glass or ceramic material readable |
| Quest item, currency, junk | One lore-specific object or deliberate compact set; honor any live combine/part relationship; never a generic rune substitute |
| Mount collectible | Recognizable three-quarter mount bust or vehicle portrait with tack and personality; do not show only loose reins |

## Approved reference anchors

Reference roles are explicit. A subject reference controls identity only; a style reference controls
lighting, material, brushwork, value range, and composition only. Never copy an unrelated shape from
a style reference.

| Reference | Use |
| --- | --- |
| `public/ui/items/eastbrook_buckler.webp` | Metal, wood, top-left light, readable circular mass |
| `public/ui/items/kingsbane_last_oath.webp` | Long weapon diagonal and safe tip padding |
| `public/ui/items/cinderweave_raiment.webp` | Cloth, garment silhouette, controlled dark values |
| `public/ui/items/linen_pouch.webp` | Soft goods, leather, compact three-quarter volume |
| `public/ui/items/anglers_feast_platter.webp` | Food grouping and small-size separation |
| `public/ui/items/firebottle.webp` | Glass or ceramic vessel, contained glow, readable liquid |
| `public/ui/items/arcanite_mining_pick.webp` | Tool silhouette, hard material, restrained magic |

The machine-readable contract in `public/ui/items/mapping.json` pins the current anchor hashes. A
reference change therefore requires deliberate review and a contract-version decision.

## Reusable generation brief

Use the current item image first as an identity-only reference when repainting, but treat the live
content definition and narrative relationships as authoritative when old art disagrees. For new
items, use the content definition and concept art as identity inputs. Follow with one same-family
approved painting and two global anchors.

```text
Use case: stylized-concept
Asset type: opaque square fantasy MMORPG inventory item icon
Primary request: paint [ITEM NAME] ([ITEM ID]) in the World of ClaudeCraft item style
contract woc-item-icon-v1.
Subject and identity: [EXACT OBJECT, MATERIALS, CONSTRUCTION, LORE PALETTE, DAMAGE OR MAGIC].
Composition: [FAMILY COMPOSITION FROM THIS DOCUMENT].
Scene and backdrop: deep charcoal, umber, navy, or restrained zone-tinted painted vignette;
subtle atmosphere and grounded contact shadow; no transparent exterior or flat black void.
Style: premium hand-painted classic fantasy MMO inventory art; tactile materials; crisp focal
edges; softer peripheral brushwork; restrained magical accents; warm top-left key light and cool
deep shadow.
Framing: square, borderless, centered complete silhouette; about 68 to 76 percent subject fill;
safe padding; readable at 22px, 28px, 40px, and in a 64px circular crop.
Input roles: image 1 controls subject identity only. Remaining images control house style,
lighting, material, and composition only. Do not copy their unrelated objects.
Constraints: one inventory icon only; opaque full-square painted ground; no text, letters,
numbers, label, UI border, rarity frame, watermark, checkerboard, transparency, split sheet,
collage, mannequin, held presentation, or cropped subject.
```

Generate each distinct authored item separately. A contact sheet is a review artifact, never a
generation shortcut.

## Master and shipping contract

1. Retain the original generated result in ignored provenance staging.
2. Normalize a reviewed 512x512 sRGB master. It must be square, single-frame, fully opaque, and
   free of embedded UI chrome.
3. Run `npm run assets:items`. The converter accepts only a source with exactly one current
   provenance owner in `public/ui/items/mapping.json`, then emits a 128x128 sRGB WebP.
4. The shipped WebP must be fully opaque, at most 15 KiB, uniquely hashed, and named exactly
   `public/ui/items/<item-id>.webp`.
5. Commit only the shipping WebP. Preserve the high-resolution result, prompt, references, hashes,
   processing, retries, and review record in the accepted-art evidence for its batch.

## Acceptance review

Review every icon at the 512 master, 128px, 40px, 28px, and 22px. Also inspect 28px grayscale and
a 64px circular crop.

Reject the icon if any answer is no:

- Is the item identity correct without reading its name?
- Do linked parts, assembled rewards, tiers, and set siblings express their authored relationship?
- Is the full silhouette centered, safely padded, and uncropped?
- Does the focal subject remain distinct at 22px and in a circular crop?
- Does material read correctly rather than as plastic or a flat vector?
- Does lighting come from the top-left with a controlled deep shadow?
- Is the background painted, opaque, subdued, and clearly separate from the subject?
- Are glow, particles, and fine decoration subordinate to the object's silhouette?
- Is there no text, pseudo-writing, baked frame, watermark, transparency, mannequin, or hand, and
  is any deliberate lore symbol clearly part of the authored item's identity?
- Does it sit naturally beside the approved same-family and global anchors?
- Do representative bag, bank, vendor, equipment, tooltip, mail, and action-slot captures remain
  legible on desktop and mobile?

## Provenance and replacement policy

- Every current item image has exactly one current owner in `public/ui/items/mapping.json`.
- Generated batches record the generator, owner, license, contract version, exact prompt, ordered
  references and their roles, original result, normalized master, shipping hash, processing,
  retry count, and review evidence.
- Repainting never rewrites historical evidence. A new accepted-art record names the superseded
  owner and old hash, gives the replacement reason, and pins the new hash.
- A source-pack image used only to preserve subject identity remains credited as a reference. The
  generated replacement does not transfer authorship of the source image to the project.
- Changing this style requires a new contract id, updated anchor hashes, representative comparison
  captures, and explicit design review. Quiet drift inside `woc-item-icon-v1` is not allowed.
