# Fenbridge image-generation prompts

Quality craft standards for turning these references into shipping GLBs live in
`quality-bar.md` (Crooked Reed Inn is the reference asset).

The exact prompts and outputs are recorded here before procedural reconstruction. Generated
references are admitted only after visual review and the img2threejs intake gates.

## Master settlement concept

Status: accepted for town mood, layout language, silhouettes, and asset-family derivation.

Input reference:

- Role: user-supplied mood, palette, weather, material-language, and elevated composition
  inspiration only.
- SHA-256: `d862111df98a99974fe26eee64d460a4a91ea875fad236fe7bd098a846992e21`
- The input is not checked into the repository.

Output:

- `references/fenbridge-master-concept.png`
- SHA-256: `dc384b16e7b44ac47ccaa7f1897044101ebdfd22733b7319b62af38361a878e7`
- Dimensions: `1672 x 941`
- Generator: OpenAI image generation tool. The tool did not expose a model version.

Exact prompt:

```text
Create a wholly original, high-end MMORPG environment concept painting for the town of Fenbridge in World of ClaudeCraft.

Reference role: Image 1 is mood, palette, weather, material-language, and elevated three-quarter composition inspiration only. Do not copy its exact town plan, building silhouettes, ornaments, logos, banners, symbols, or individual props. Invent a distinct Fenbridge design.

Scene: an expanded fortified swamp settlement centered near a dry raised civic square in a dark rainy fen. Readable, generous paths and service aprons are essential. A timber palisade has four visibly open route gates: a broad south causeway gate, east and west marsh-road gates, and a north fen gate. Weathered boardwalk segments bridge only wet margins while the central circulation stays broad and walkable.

Show seven clearly different exterior-only service buildings arranged around the square:
1) a tall asymmetrical Fenwarden gatehouse and watchtower beside the south gate, with horn, lantern cage, guard balcony, and teal shingle roof;
2) the Crooked Reed inn and provision counter, broad and welcoming, with deep porch, hanging reed-bundle sign shape but no readable text, warm amber windows, chimney, crates and rain awning;
3) a marsh chapel and chronicle archive near a small graveyard, with bell gable, lancet windows, wax lanterns, shelves visible only as exterior display cues, no interior modeling implication;
4) a Moonwort apothecary hut with crooked roof, drying herbs, potion bottles, mushroom planters and subtle witchy violet accents;
5) a sturdy Gilded Strongbox bank office with ironbound exterior vault cues, ledger counter window, barred amber windows, and waterside piling foundations;
6) Hesk's tannery workshop at the downwind northwestern edge, with open-sided exterior work awning, hide frames, vats, barrels, drains, leather rolls and a highly legible work station apron;
7) a compact Fenwatch scout lodge and barracks near the north gate, with map table under an exterior lean-to, weapon racks, lookout perch, and patrol banners with abstract blank emblems.

At the center place a distinctive mirelight cistern and covered brazier with low warm fire, stone ring, hanging kettle and teal-green magical fenlight accents. Add one compact provision market stall, a dedicated muster-order notice board on the inner south gatepost, palisade wall modules, rope rails, piles, fishing nets, rain barrels, reeds, lily water, dead swamp trees, mud, puddles, and sparse violet fungus. Keep all entrances visibly accessible and the open gates/path network unmistakable.

Style: beautiful stylized 3D MMORPG concept art, premium hand-painted material feel, believable construction, chunky readable forms, layered timber and stone, dark brown wood, oxidized teal shingles and cloth, warm amber emissive windows, subdued moss green and violet accents, rainy volumetric atmosphere. Exterior detail is rich from gameplay camera distance, but silhouettes remain practical for performant low-poly procedural Three.js reconstruction. No building interiors. No dense micro-clutter in walk lanes.

Camera: elevated three-quarter isometric gameplay view, entire settlement visible, landscape orientation, strong central composition, enough breathing room around the palisade to understand all four exits.

Avoid: readable text, letters, numbers, logos, watermarks, franchise symbols, copied emblems, exact duplication of Image 1, photorealism, flat orthographic map, inaccessible doorways, sealed gates, overly dense clutter, interior cutaways, modern objects, bright daylight, snow.
```

Acceptance notes:

- Accepted: readable four-gate ring, broad circulation, original seven-building family,
  distinct service silhouettes, teal roofs, amber windows, wet palisade edge, civic fire, and
  clear exterior-only construction language.
- Do not reproduce literally: incidental banners, exact fence cadence, cemetery count,
  small prop placement, or painterly geometry that would inflate triangles.
- Reconstruction must follow `master-plan.md` coordinates and gameplay clearances, not the
  concept painting's perspective layout.

## Isolated asset turnarounds

All runs below used `references/fenbridge-master-concept.png` as Image 1. The reference role
was approved project art direction only. Each output was visually reviewed before intake.

### Warden gatehouse

- Output: `references/warden-gatehouse-turnaround.png`
- SHA-256: `3487ea1742fb36de9416e965623475fad91099ecee6a451181a758fbb144b1af`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: the Fenbridge Warden Gatehouse and Watchtower.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark rainy-swamp material language, oxidized teal shingles, dark timber, warm amber lighting, and handcrafted low-poly proportions. Derive the same asset identity, but show only this isolated building.

Asset: an asymmetrical tall timber gatehouse/watchtower that stands beside, not across, a town gate. Exterior-only closed shell, approximately 7.8 yards wide, 10.5 yards tall, 7 yards deep. Local front is +Z. Main forms: stout piling-and-stone foundation; narrow two-story guard house; offset open lookout balcony; steep teal shingle roof; small horn under a roof eave; hanging iron lantern cage; exterior stair/ladder cues; guard rail; rope and rain gutter; a clearly readable front service apron and doorway. Include subtle fen-moss, iron braces and one abstract blank teal banner with no emblem. Silhouette must remain readable from an elevated gameplay camera and feasible as a 4,400-triangle procedural Three.js model. Do not model any interior or hidden backface detail.

Output as a single professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Views are evenly spaced, consistent scale, orthographic-like, full object uncropped, floor seated, neutral light gray studio background, soft contact shadow only. Neutral white lighting must expose construction and color; no rain, fog, scenery, characters, props detached from the building, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Crooked Reed inn

- Output: `references/crooked-reed-inn-turnaround.png`
- SHA-256: `f2cbdacec972b549c663c3d8a1009e9fe231b47ced3d07ed18a7cd3b7facb097`
- Status: whole sheet rejected for fragmented-mask coherence; all four isolated view crops
  admitted and used as evidence.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: the Fenbridge Crooked Reed Inn and Provision House.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark rainy-swamp material language, oxidized teal shingles, dark timber, warm amber windows, and handcrafted low-poly proportions. Derive the same asset identity, but show only this isolated building.

Asset: a broad welcoming marsh inn, exterior-only closed shell, approximately 9 yards wide, 8.8 yards tall, 8 yards deep. Local front is +Z. Main forms: stone-and-piling foundation; two-story crooked timber body; layered teal shingle roof with one distinctive bent ridge; deep covered front porch; exterior provision counter and rain awning on one side; broad accessible doorway; warm amber windows; chunky chimney; reed-bundle hanging sign shape with no letters or symbol; rain barrels, two attached crates, bundled fishing nets, rope rail and a small dormer. All clutter must be attached within the footprint or clearly part of the exterior shell. Silhouette must read from gameplay distance and be feasible as a 4,000-triangle procedural Three.js model. Do not model any interior, furniture behind doors, or hidden backface detail.

Output as a single professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Views are evenly spaced, consistent scale, orthographic-like, full object uncropped, floor seated, neutral light gray studio background, soft contact shadow only. Neutral white lighting must expose construction and color; no rain, fog, scenery, characters, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Lantern Chapel

- Output: `references/lantern-chapel-turnaround.png`
- SHA-256: `6ff5f54502791f095e7825aaea5297c3396b24eed8432c5213476c697e1ee1ce`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: the Fenbridge Lantern Chapel and Marsh Chronicle Archive.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, oxidized teal roof accents, warm amber lighting, damp stone, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated building.

Asset: a compact solemn marsh chapel and exterior chronicle archive, exterior-only closed shell, approximately 7 yards wide, 8.6 yards tall, 7 yards deep. Local front is +Z. Main forms: low damp-stone foundation; timber nave; steep asymmetric teal-shingle roof; narrow bell gable and small weathered bell; pointed accessible front doorway; three chunky lancet windows glowing amber; protected exterior archive display niche with closed ledgers and rolled maps visible as attached facade props; wax-lantern brackets; grave-lamp finials; rain chains; moss at the footing. Use abstract geometric trim only, no religious franchise icon, readable writing, or copied symbol. The silhouette must be distinctive beside a graveyard, readable from an elevated gameplay camera, and feasible as a 3,400-triangle procedural Three.js model. No interior, open cutaway, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full building uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, cemetery, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Moonwort apothecary

- Output: `references/moonwort-apothecary-turnaround.png`
- SHA-256: `19f598b541502590af62e1fe8e2ebe425e6589413ee7beca0d0c68a910f9172d`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: the Fenbridge Moonwort Apothecary.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, oxidized teal shingles, amber windows, subdued violet magic accents, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated building.

Asset: a crooked but practical apothecary hut, exterior-only closed shell, approximately 7 yards wide, 7.2 yards tall, 6 yards deep. Local front is +Z. Main forms: short piling-and-stone foundation; offset timber body; bent teal-shingle roof with one curled ridge and small vent chimney; clearly accessible porch and doorway; exterior potion sales window; drying herb bundles and reed racks; attached shelves of chunky colored bottles; two attached mushroom planters; a small copper alembic silhouette; one restrained violet glowing crystal or fungus cluster; rain barrel and drainage gutter. It should feel witch-adjacent and swampwise without being evil, unsafe, or cluttered across the player apron. The silhouette must read from gameplay distance and be feasible as a 3,200-triangle procedural Three.js model. No interior, open cutaway, hanging readable sign, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full building uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, characters, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Gilded Strongbox

- Output: `references/gilded-strongbox-turnaround.png`
- SHA-256: `53319c0acca7273e3f78204a42493ee9c44005f4589d06e7dbbbce3f8d0c43eb`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: the Fenbridge Gilded Strongbox Bank Office.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, damp stone, oxidized teal roof, warm amber windows, iron hardware, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated building.

Asset: a compact sturdy marsh bank and ledger office, exterior-only closed shell, approximately 7.5 yards wide, 7.4 yards tall, 6.5 yards deep. Local front is +Z. Main forms: heavy stone-and-piling foundation; squared timber body; restrained teal hipped/gabled roof; protected accessible front porch; highly readable exterior teller counter/window with brass grille; broad ironbound door; barred amber windows; exterior vault-wheel and reinforced iron strap cues that communicate bank without showing an interior; ledger box, one attached locked chest silhouette, drainage pipe and rain barrel; a small blank shield-shaped brass sign with no mark. More orderly and fortified than the other Fenbridge buildings, but still swamp-built. Silhouette must read from gameplay distance and be feasible as a 2,900-triangle procedural Three.js model. No interior, open vault, readable writing, coin symbols, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full building uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, characters, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Hesk tannery

- Output: `references/hesk-tannery-turnaround.png`
- SHA-256: `480c6e5a1942d8135eac64c73ea66ffd289110a355cb0f9cd1cb2508fbe2e5eb`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: Hesk's Fenbridge Tannery Workshop.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, damp stone, oxidized teal roof accents, warm amber work lights, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated building.

Asset: a wide downwind tannery and leather workshop, exterior-only main shell with an open-sided exterior work awning, approximately 9 yards wide, 7.2 yards tall, 7 yards deep. Local front is +Z. Main forms: piling-and-stone base; stout one-and-a-half-story timber workshop; broad sloped teal-shingle roof and smokestack; accessible dry front work apron; attached open awning that clearly displays two hide-stretching frames, one shallow tanning vat, two barrels, drainage trough, hanging leather strips and rolled hides; workbench, hooks and a warm lantern. Everything under the awning is exterior service scenery, with no walk-in interior. Keep the central player approach clear and make the tannery function unmistakable without gore. Silhouette must read from gameplay distance and be feasible as a 3,800-triangle procedural Three.js model. No interior cutaway, characters, readable sign, loose clutter across the service lane, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full building uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, people, detached props, labels, text, dimensions, arrows, logos, watermark, blood, gore, or franchise symbols.
```

### Fenwatch scout lodge

- Output: `references/scout-lodge-turnaround.png`
- SHA-256: `d0c72266fcf953e7b5a98f1e629631d1b55a740dd5b6ecef92fa8dff59de7e0f`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG building: the Fenbridge Fenwatch Scout Lodge and Barracks.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, oxidized teal shingles, damp stone, warm amber lights, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated building.

Asset: a compact north-gate patrol lodge, exterior-only closed shell, approximately 8 yards wide, 7.6 yards tall, 6.5 yards deep. Local front is +Z. Main forms: piling-and-stone foundation; low sturdy timber lodge; steep teal gable roof; offset narrow lookout perch above one corner; broad accessible porch; attached exterior lean-to containing a map table with abstract blank map shapes, weapon rack with simple spear and bow silhouettes, patrol packs and rope; one warm lantern; shuttered amber windows; rain gutter; a short signal mast and two blank teal cloth streamers with no emblem. Keep the player approach and map-table service apron open. Silhouette must read from gameplay distance and be feasible as a 3,000-triangle procedural Three.js model. No interior cutaway, characters, readable writing, detailed weapons, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full building uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Mirelight cistern

- Output: `references/mirelight-cistern-turnaround.png`
- SHA-256: `27237dc2e28dbac7270ef0e6722e5cdad6b0438c69ca0f88099d3e6a149c63f2`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG civic prop: the Fenbridge Mirelight Cistern and Covered Brazier.

Reference role: Image 1 is the approved Fenbridge master concept. Use its damp stone, dark swamp timber, oxidized teal metal, warm amber firelight, restrained teal-green fenlight, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated prop.

Asset: a distinctive central-town water cistern and low covered brazier, approximately 4.8 yards wide, 4.5 yards tall, and 4.2 yards deep. Local front is +Z. Main forms: broad low octagonal damp-stone water ring; four stout timber canopy posts; compact oxidized teal shingle cap that leaves the basin readable; a low central iron brazier with warm coals; hanging kettle on a simple hook; hand pump and short spout; two attached buckets; rope coil; drainage channel; moss and a few restrained teal-green magical fenlight crystals or fungi at the base. Keep every side approachable and the silhouette open enough to read through from an elevated gameplay camera. The prop must be feasible as a 1,600-triangle procedural Three.js model. No interior volume beneath the water surface, characters, readable text, loose clutter in the approach, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Provision stall

- Output: `references/provision-stall-turnaround.png`
- SHA-256: `856f3d0c86ca81f6fcaeeb892cafd1a671ff566e463c87443c8cc129557d25fb`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG market prop: the Fenbridge Provision Stall.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, oxidized teal cloth, warm amber lanterns, rope, reeds, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated prop.

Asset: a compact open-front provision market stall, approximately 4.8 yards wide, 4 yards tall, and 3.2 yards deep. Local front is +Z. Main forms: raised timber platform; four crooked posts; layered teal waterproof awning with tied corners; clear player-facing counter; attached shelves and baskets holding chunky silhouettes of roots, mushrooms, wrapped rations, bottles, rope, and one fish crate; hanging balance scale; small amber lantern; rain gutter and barrel; blank oval hanging sign with no mark. Keep goods grouped into a few readable clusters and leave the full counter approach unobstructed. The silhouette must read from gameplay distance and be feasible as a 1,350-triangle procedural Three.js model. No enclosed interior, merchant, readable text, detached ground clutter, tiny individual produce, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Palisade wing

- Output: `references/palisade-wing-turnaround.png`
- SHA-256: `31995cb0fb8a869e5272e5256f7896c7d005171f3a8148fe62547a897eacfa34`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG modular environment prop: the Fenbridge Palisade Wing.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark rain-soaked timber, moss, iron bindings, rope, teal cloth accents, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated wall module.

Asset: one reusable slightly curved swamp-town palisade wall wing, approximately 7.5 yards long, 4.8 yards tall, and 1.6 yards deep. Local front is +Z and the long axis is X. Main forms: nine to eleven irregular pointed timber stakes with a deliberately chunky shared silhouette; two heavy horizontal braces; three rear support struts; short piling feet; sparse iron straps and rope lashings; one small blank torn teal cloth marker; modest moss at the base. End profiles must visually overlap adjacent copies without a gap. Preserve a simple collision-friendly footprint and make the module feasible as a 650-triangle procedural Three.js model that can be repeated at least sixteen times. No walkway, gate opening, characters, readable marks, individual high-poly bark, loose scenery, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, landscape, other wall pieces, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Gate arch

- Output: `references/gate-arch-turnaround.png`
- SHA-256: `e1073bbcbcfd4fa705d56aa24280b13fb1336c801a71253c375b326a81625c2c`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG modular environment prop: the Fenbridge Open Gate Arch.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark rain-soaked timber, oxidized teal roof accents, iron hardware, rope, warm lanterns, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated gate module.

Asset: one visibly open palisade gate arch for a swamp-town route, approximately 8 yards wide, 6.8 yards tall, and 2 yards deep. Local front is +Z. Main forms: two thick timber jamb towers set far enough apart for a broad unobstructed route; heavy overhead beam with a shallow teal shingle rain cap; short outward braces; iron bands; rope lashings; one hanging warm lantern on each jamb; raised portcullis teeth or lashed-open door panels held entirely above or beside the route; two blank teal streamers with no emblem. The empty opening is the dominant shape and must remain at least 5 yards wide. Design for two simple jamb colliders, not one blocking box. The prop must be feasible as a 750-triangle procedural Three.js model and be reusable at four rotations. No closed door, crossbar at player height, characters, readable sign, loose clutter, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, wall extensions, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Boardwalk

- Output: `references/boardwalk-turnaround.png`
- SHA-256: `be9e4eb013f90a89f526e74e2f14dc1df7099c83e7c786d90ccb7f581a30faad`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG modular environment prop: the Fenbridge Marsh Boardwalk.

Reference role: Image 1 is the approved Fenbridge master concept. Use its rain-dark timber, rope, moss, reeds, iron nails, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated boardwalk module.

Asset: one reusable raised marsh boardwalk segment, approximately 6 yards long, 2.8 yards wide, and 1.5 yards tall. Local front is +Z and travel runs along Z. Main forms: six to eight broad irregular planks forming a flat collision-friendly deck; four stout support piles; two low rope-rail posts per side with open ends for seamless continuation; a short optional side step integrated at one end; chunky iron nail heads; restrained moss and one attached reed cluster below deck level. Keep the walk surface broad, uncluttered, and nearly level. End profiles must connect cleanly to repeated copies. The prop must be feasible as a 420-triangle procedural Three.js model repeated at least ten times. No characters, water plane, loose cargo, broken walk gaps, high rail that obscures play, readable marks, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, landscape, other boardwalk pieces, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Muster board

- Output: `references/muster-board-turnaround.png`
- SHA-256: `8beb0bb0d8749c62149c9061b595861f664fe08e198be5d208085f2034b77483`
- Status: front, rear, and hero crops accepted; side crop rejected for fragmented-mask
  coherence and excluded from reconstruction evidence.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG civic prop: the Fenbridge Muster Notice Board.

Reference role: Image 1 is the approved Fenbridge master concept. Use its dark swamp timber, oxidized teal rain cap, iron hardware, wax seals, warm lantern light, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated prop.

Asset: a freestanding guarded notice board for the inner south gate, approximately 3.8 yards wide, 4.2 yards tall, and 1.2 yards deep. Local front is +Z. Main forms: two heavy timber posts on compact stone feet; wide framed board under a small teal shingle rain cap; three large blank parchment shapes pinned to the face with abstract lines only; one attached sealed order envelope shape; iron corner brackets; shallow shelf; small warm hooded lantern; short rope queue rail attached to one side; restrained moss at the feet. Keep the player-facing apron clear and make the notice surface readable from an elevated gameplay camera. The prop must be feasible as a 420-triangle procedural Three.js model. No readable words, letters, numbers, faction logo, characters, detached papers, scenery, or hidden backface detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```

### Muster order quest pickup

- Output: `references/muster-order-turnaround.png`
- SHA-256: `cd31b40d8cab27e99eb560e9dbc30f6befba6f2a71961f6104e321fc5d3c29d3`
- Status: accepted; all four view crops admitted.

```text
Create a clean model-sheet turnaround for one original stylized MMORPG quest pickup prop: the Fenbridge Sealed Muster Order.

Reference role: Image 1 is the approved Fenbridge master concept. Use its damp parchment, dark teal cloth, aged leather, brass, red-brown wax, and handcrafted low-poly material language. Derive the same asset identity, but show only this isolated pickup.

Asset: a compact highly legible sealed dispatch bundle, approximately 0.75 yards wide, 0.22 yards tall, and 0.55 yards deep. Local front is +Z. Main forms: one thick folded parchment packet with uneven but closed edges; crossed dark teal cord; large raised red-brown wax seal bearing only an abstract three-notch geometric impression; one short rolled map tucked beneath; tiny brass corner clip; one narrow attached leather backing board so the item reads when placed on a notice shelf or crate. Parchment surfaces may have a few abstract ink strokes but no readable language. The silhouette and color blocks must remain recognizable from gameplay distance and be feasible as a 180-triangle procedural Three.js model. No loose pages, open book, readable text, letters, numbers, logos, scenery, characters, or hidden underside detail.

Output as one professional four-view turnaround sheet of the exact same object: front, left side, rear, and front three-quarter hero. Even spacing, consistent scale, orthographic-like, full object uncropped and floor seated on a neutral light gray studio background with soft contact shadow. Neutral white lighting exposes construction and color. No rain, fog, scenery, people, detached props, labels, text, dimensions, arrows, logos, watermark, or franchise symbols.
```
