# Demon Tower deed icon provenance

These three Book of Deeds crests were generated with OpenAI's built-in image
generation from project-generated Demon Tower concepts, then keyed and reduced
through the repository's canonical deed-icon pipeline. No third-party reference
art was used.

## Tower Initiate

- Shipping asset: `public/ui/deeds/dgn_demon_tower_initiate.webp`
- Generated result: `exec-1c52d1ba-1925-47c5-8792-a5f36088eeaa.png`
- Generated source: 1,737,044 bytes, SHA-256
  `c509b25633f9aa9dd3669c508f37731a1423dfd64240ca0c5ed10033d2a15ed9`
- Shipping WebP: 5,042 bytes, SHA-256
  `d0764dd2e7e646f5468d5a5f2ebe2a0f4f77080514ab103b2b661cb62d0258ca`
- References, in order: an earlier project-generated tower-key exploration
  (`exec-3fd41...`) for the edit target; `references/bloodforge-concept.png`
  for material, palette, and mood.

Prompt:

> Use case: precise-object-edit
>
> Asset type: 512px source artwork for a 128px fantasy MMORPG achievement crest
>
> Primary request: revise Image 1 into a broad, compact "Tower Initiate" crest that meets a dense square icon silhouette. Remove the long key shaft and teeth entirely. Keep the black-iron crenellated tower gate from Image 1 as the central identity, widen it into a nearly square heraldic tower shield, and place one clearly broken chain horizontally across its lower third. Preserve the ember-lit doorway.
>
> Input images: Image 1 controls the exact hand-painted object style and tower identity; Image 2 controls Bloodforge material, ember palette, and mood only.
>
> Scene/backdrop: perfectly flat uniform solid #00ff00 chroma-key field.
>
> Composition/framing: one complete broad object, centered within 2% tolerance; silhouette width about 72% and height about 72% of canvas; dense painted subject coverage around 45-55%; at least 8% empty padding on all sides; readable at 28px.
>
> Constraints: change the silhouette as requested while preserving premium painted black iron and restrained ember light; uniform #00ff00 only outside the object, no gradient, texture, shadow, floor, reflection, green in subject, cast shadow, text, letters, numbers, border, rarity frame, halo, watermark, checkerboard, transparency, collage, character, face, hands, or scenery.

## Tower Ascendant

- Shipping asset: `public/ui/deeds/dgn_demon_tower_ascendant.webp`
- Generated result: `exec-10ec782a-5c36-4be2-8c1b-6bb278772f07.png`
- Generated source: 1,631,736 bytes, SHA-256
  `6ccce74d964273cf85f6fe91d973224d82c4c613ed426237ec79a4d97c8dc2bb`
- Shipping WebP: 7,386 bytes, SHA-256
  `23848cf4cd33a46dac2a637f42df667bc222488c7dd8256b13cc9c92920835af`
- References, in order: an earlier project-generated tall-reliquary
  exploration (`exec-ac1cff...`) for the edit target;
  `references/ossuary-concept.png` for material, palette, and mood.

Prompt:

> Use case: precise-object-edit
>
> Asset type: 512px source artwork for a 128px fantasy MMORPG achievement crest
>
> Primary request: revise Image 1 into a broad, compact "Tower Ascendant" crest that meets a dense square icon silhouette. Shorten the tall reliquary into a compact central bone tower, then add a large symmetrical pair of outward-curving ivory rib arches and two heavy broken-chain sweeps to fill the left and right sides. Preserve the cyan soul flame, skull crown, black iron bands, and upward-rank identity.
>
> Input images: Image 1 controls exact hand-painted object style and reliquary identity; Image 2 controls Ossuary material, cyan-violet palette, and mood only.
>
> Scene/backdrop: perfectly flat uniform solid #00ff00 chroma-key field.
>
> Composition/framing: one complete broad emblem, centered within 2% tolerance; silhouette width about 74% and height about 72% of canvas; dense painted subject coverage around 45-55%; at least 8% empty padding on all sides; readable at 28px.
>
> Constraints: preserve premium cracked bone, black iron and restrained cyan-violet glow; uniform #00ff00 only outside the object, no gradient, texture, shadow, floor, reflection, green in subject, cast shadow, text, letters, numbers, border, rarity frame, halo, watermark, checkerboard, transparency, collage, character, face, hands, or scenery.

## The Tower Unbound

- Shipping asset: `public/ui/deeds/dgn_demon_tower_unbound.webp`
- Generated result: `exec-fbc4fa30-065f-4226-94ba-10d797c40211.png`
- Generated source: 1,869,064 bytes, SHA-256
  `010b30118982aa19b2900383b8accc26bb700b9f6d865f43e98e475219a74c9e`
- Shipping WebP: 8,722 bytes, SHA-256
  `cb10b4d7c0a2c108c34462b6a09e991776ca825b67de4482bb6804f7adcfba52`
- Reference: `references/void-crown-concept.png`, controlling only palette,
  materials, and summit mood.

Prompt:

> Use case: stylized-concept
>
> Asset type: 512px source artwork for a 128px fantasy MMORPG achievement crest
>
> Primary request: create the painted deed crest for "The Tower Unbound", the final Demon Tower conquest and title reward.
>
> Input image: reference image controls only the Void Crown palette, obsidian architecture, magenta-violet storm light, and apocalyptic summit mood; do not reproduce its wide arena composition.
>
> Subject: one centered shattered obsidian crown whose five tower-like points bend upward around a bright violet rift crystal; a broken black chain opens across the crown's base, with small blue-violet lightning fractures inside the stone. It must read as a supreme final-rank conquest emblem.
>
> Scene/backdrop: a perfectly flat, uniform solid #00ff00 chroma-key field for later background removal.
>
> Style/medium: premium hand-painted classic fantasy MMO achievement art, tactile volcanic glass and dark metal, restrained magenta-blue internal glow, crisp focal edges and softer peripheral brushwork.
>
> Composition/framing: square; one complete crown-and-chain silhouette, centered within 2% tolerance; subject occupies about 50% of canvas area with generous even padding; readable at 28px; no crop.
>
> Lighting/mood: cold top-left storm light with internal violet rift illumination, shadows confined to the object.
>
> Constraints: perfectly uniform #00ff00 background with no gradient, texture, shadow, floor, reflection, or lighting variation; do not use green anywhere in the subject; no cast shadow; no text, letters, numbers, UI border, rarity frame, halo, watermark, checkerboard, transparency, split sheet, collage, character, face, hands, or scenery.

## Processing and review

The generated PNGs used a solid green matte by design. The matte was removed
with the `imagegen` skill helper `remove_chroma_key.py` using `--auto-key
border --soft-matte --transparent-threshold 12 --opaque-threshold 220
--despill`. Sources were exported as centered 512px RGBA PNGs; the Ascendant
source received a centered 1.06x scale before export to satisfy the repository's
coverage floor. `node scripts/convert_deed_icons_webp.mjs <source-directory>`
then produced the 128px lossless-alpha WebPs and regenerated
`src/ui/deed_image_ids.ts`.

All three shipping assets were reviewed at their native 128px size. Their
silhouettes remain distinct, no chroma fringe or accidental crop is visible,
and the progression reads as iron gate, bone reliquary, then shattered crown.
