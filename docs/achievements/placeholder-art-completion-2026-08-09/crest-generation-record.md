# Family and status crest imagegen manifest fragment

Mode: built-in `image_gen` tool, one call per distinct asset.

Generated source directory: `/Users/fernando/.codex/generated_images/019fe6f7-7cc5-7f62-95d2-d2b47284b34f`

High-resolution masters are retained under `tmp/imagegen/placeholder-art-completion/crests/masters/`.
Shipping files are 256 by 256 opaque WebP, converted with ImageMagick quality 84 and WebP method 6.

For each family asset except `beast`, the exact submitted prompt was `FAMILY_COMMON`, one newline, then the asset suffix.
For each status asset, the exact submitted prompt was `STATUS_COMMON`, one newline, then the asset suffix.
The complete exact `beast` prompt is recorded independently in its section.

## FAMILY_COMMON

```text
Use case: stylized-concept
Asset type: opaque square game UI family crest icon for a classic dark-fantasy MMORPG
Input images: Image 1 and Image 2 are local style and composition references for the game's existing premium class icons. Use them only for the established visual language, not as content to copy.
Style/medium: high-end hand-painted game UI icon, bold faceted painterly shapes, crisp focal edges, rich materials, classic fantasy inventory art, not photorealistic and not a flat vector.
Composition/framing: one centered emblem, strong simple silhouette, subject fills about 72 percent of the square, generous safe padding on every side, every feature and glow fully contained, readable at 28 to 40 pixels.
Constraints: exactly one coherent crest, opaque square artwork, no transparent exterior, no text, no letters, no runes that resemble letters, no numbers, no watermark, no logo, no UI border, no circular badge frame, no crop.
Avoid: contact sheet, multiple icons, split panels, generic clip art, glossy 3D render, product photography, flat glyph, excessive tiny detail.
```

## STATUS_COMMON

```text
Use case: stylized-concept
Asset type: opaque square game UI status crest icon for a classic dark-fantasy MMORPG
Input images: Image 1 and Image 2 are local style and composition references for the game's existing premium painted icon language. Use them only for visual language, not as content to copy.
Style/medium: high-end hand-painted game UI icon, bold faceted painterly shapes, crisp focal edges, rich materials, classic fantasy inventory art, not photorealistic and not a flat vector.
Composition/framing: one centered emblem, strong simple silhouette, subject fills about 68 to 74 percent of the square, generous safe padding on every side, every feature and glow fully contained, readable at 28 to 40 pixels.
Constraints: exactly one coherent crest, opaque square artwork, no transparent exterior, no text, no letters, no runes that resemble letters, no numbers, no watermark, no logo, no UI border, no circular badge frame, no crop.
Avoid: contact sheet, multiple icons, split panels, generic clip art, glossy 3D render, product photography, flat glyph, excessive tiny detail.
```

## Family prompt suffixes

### beast

References: `public/ui/classes/druid.webp`, `public/ui/classes/hunter.webp`

Built-in result: `exec-7edacce1-4de3-457a-b19c-a165f4ab4681.png`

`beast` was generated before the common family prompt was factored for later calls. This is its complete exact prompt:

```text
Use case: stylized-concept
Asset type: opaque square game UI family crest icon for a classic dark-fantasy MMORPG
Primary request: Create a fresh original painted emblem for the Beast creature family.
Input images: Image 1 is a local style and composition reference for the game's existing premium class icons. Image 2 is a local style reference for the game's hunter icon. Use them only for the established visual language, not as content to copy.
Scene/backdrop: deep near-black forest green and umber painterly ground with restrained atmospheric glow, filling the entire square.
Subject: a fierce golden-brown wolf head in three-quarter view, one curved ivory fang and a claw-mark accent, framed by dark oak leaves; unmistakably a wild beast rather than a person or letter.
Style/medium: high-end hand-painted game UI icon, bold faceted painterly shapes, crisp focal edges, rich materials, classic fantasy inventory art, not photorealistic and not a flat vector.
Composition/framing: one centered emblem, strong simple silhouette, subject fills about 72 percent of the square, generous safe padding on every side, all ears, fangs, leaves and glow fully contained, readable at 28 to 40 pixels.
Lighting/mood: dramatic top-left amber rim light with deep forest shadows, dangerous and primal.
Color palette: burnished gold, warm brown, moss green, ivory, near-black.
Constraints: exactly one coherent crest, opaque square artwork, no transparent exterior, no text, no letters, no runes that resemble letters, no numbers, no watermark, no logo, no UI border, no circular badge frame, no crop, no hands or humanoid face.
Avoid: contact sheet, multiple icons, split panels, generic clip art, glossy 3D render, product photography, flat glyph, excessive tiny detail.
```

### humanoid

References: `public/ui/classes/warrior.webp`, `public/ui/classes/rogue.webp`

Built-in result: `exec-4edb01ab-1810-40ab-9636-bb4957832e0e.png`

```text
Primary request: Create a fresh original painted emblem for the Humanoid creature family.
Scene/backdrop: deep near-black burgundy and slate painterly ground with a restrained amber halo filling the square.
Subject: a weathered steel sentinel helm shaped for a human head, with a narrow face opening and leather gorget, set before one crossed short sword and spear; unmistakably mortal crafted equipment, balanced and noble rather than monstrous.
Lighting/mood: dramatic top-left firelight, resolute and worldly.
Color palette: tempered steel, oxblood red, worn leather, muted gold, near-black.
Materials/textures: hammered metal, nicked blade edges, stitched leather.
Additional constraints: no exposed face, no skull, no demon horns, no floating letter-like marks.
```

### mudfin

References: `public/ui/classes/shaman.webp`, `public/ui/classes/hunter.webp`

Built-in result: `exec-34a8fe7a-0666-481a-805a-faa8b364208f.png`

```text
Primary request: Create a fresh original painted emblem for the Mudfin amphibious fish-folk creature family.
Scene/backdrop: deep marsh teal and midnight-blue painterly ground with submerged reed silhouettes and a soft aquatic glow filling the square.
Subject: a fierce teal fish-man head in three-quarter view with a tall swept fin crest, round amber eye, broad scaled cheek, gill fins, and two small shell ornaments; unmistakably amphibious fish-folk, not an ordinary fish.
Lighting/mood: cool moonlit top-left gleam with warm amber eye light, wet and uncanny.
Color palette: deep teal, turquoise, sea-green, coral orange, shell ivory, midnight blue.
Materials/textures: wet scales, translucent fin edges, worn shell.
Additional constraints: no fishing hook, no trident, no human face, no mascot cuteness.
```

### spider

References: `public/ui/classes/warlock.webp`, `public/ui/classes/rogue.webp`

Built-in result: `exec-cbc9de32-e38a-40ee-8a07-21399e4c772c.png`

```text
Primary request: Create a fresh original painted emblem for the Spider creature family.
Scene/backdrop: velvety near-black violet cavern ground with a faint radial web and restrained crimson mist filling the square.
Subject: one ivory-armored spider seen frontally, broad abdomen and all eight legs arranged into a compact menacing silhouette, four tiny ruby eyes and two clearly visible fangs; a delicate silver web supports the shape without becoming clutter.
Lighting/mood: cold top-left moonlight with pinpoints of red eye glow, sinister and elegant.
Color palette: bone ivory, silver, black plum, deep violet, ruby red.
Materials/textures: chitin plates, taut silk strands, subtle cavern dust.
Additional constraints: show exactly eight legs where readable, no humanoid skull motif, no letters.
```

### burrower

References: `public/ui/classes/druid.webp`, `public/ui/classes/warrior.webp`

Built-in result: `exec-9c5e3085-5b9b-4461-94a3-2c56230fafc6.png`

```text
Primary request: Create a fresh original painted emblem for the Burrower creature family.
Scene/backdrop: deep earthen umber and charcoal tunnel ground with a restrained amber mineral glow filling the square.
Subject: a powerful dark-furred cave mole bursting through a split ring of rock, with oversized ivory digging claws, a blunt snout, one tiny emerald eye, and a small warm lantern-beetle glow tucked below; unmistakably a tunneling creature.
Lighting/mood: top-left golden cave light, secretive and industrious.
Color palette: earthen brown, charcoal, copper, ivory, small emerald and amber accents.
Materials/textures: layered fur, chipped stone, worn claws, mineral dust.
Additional constraints: no miner character, no pickaxe, no candle shaped like a letter, no cute cartoon expression.
```

### undead

References: `public/ui/classes/warlock.webp`, `public/ui/classes/priest.webp`

Built-in result: `exec-d5837613-b373-46db-8a98-b9afb91fa599.png`

```text
Primary request: Create a fresh original painted emblem for the Undead creature family.
Scene/backdrop: deep graveyard blue-black and muted violet painterly ground with restrained spectral mist filling the square.
Subject: one ancient cracked ivory skull in three-quarter view, lower jaw intact, wrapped by a torn burial shroud and backed by two broken grave-iron prongs; cold teal soul-fire glows from the eye sockets without forming symbols.
Lighting/mood: cold top-left moonlight and an eerie inner teal glow, solemn and cursed.
Color palette: aged bone, tarnished iron, midnight blue, muted violet, spectral teal.
Materials/textures: weathered bone, frayed cloth, pitted iron, wispy soul flame.
Additional constraints: no crossed-bones pirate motif, no cute expression, no crown, no red X shape.
```

### troll

References: `public/ui/classes/hunter.webp`, `public/ui/classes/shaman.webp`

Built-in result: `exec-f8e7ae2a-1634-4ad9-9838-ca46f6a20f50.png`

```text
Primary request: Create a fresh original painted emblem for the Troll creature family.
Scene/backdrop: deep jungle jade and midnight indigo painterly ground with restrained sunlit leaf shapes filling the square.
Subject: a fierce blue-green troll head in three-quarter view with a tall swept crimson mane, very long ivory lower tusks, angular cheekbones, pointed ears, and a small carved bone-and-feather temple ornament; unmistakably a powerful jungle troll.
Lighting/mood: dramatic top-left warm sunlight against cool jungle shadow, feral and ritualistic.
Color palette: blue-green skin, crimson mane, ivory, old gold, deep jade, indigo.
Materials/textures: rough skin, coarse hair, carved bone, worn gold.
Additional constraints: no skull face, no ogre bulk, no human proportions, no real-world cultural markings, no mascot grin.
```

### ogre

References: `public/ui/classes/warrior.webp`, `public/ui/classes/druid.webp`

Built-in result: `exec-6ef7dc2d-1854-48f6-8f3c-d3538a97167f.png`

```text
Primary request: Create a fresh original painted emblem for the Ogre creature family.
Scene/backdrop: smoky near-black rust and earthen brown painterly ground with a restrained forge-orange halo filling the square.
Subject: a massive ochre-gray one-eyed ogre face viewed nearly frontally, with a broad broken nose, thick lower tusks, a riveted dark-iron brow guard, one chipped horn, and the top of a crude stone maul behind one shoulder; unmistakably immense and brutal.
Lighting/mood: hard top-left forge light, heavy and intimidating.
Color palette: ochre gray, rust brown, dark iron, ivory, ember orange.
Materials/textures: scarred leathery skin, pitted iron, chipped stone, worn tusk.
Additional constraints: only one visible central eye, no troll mane, no human helmet, no comedy, no exposed gore.
```

### elemental

References: `public/ui/classes/shaman.webp`, `public/ui/classes/mage.webp`

Built-in result: `exec-cfd764ba-2656-4deb-8faf-0fb8c07af19d.png`

```text
Primary request: Create a fresh original painted emblem for the Elemental creature family.
Scene/backdrop: deep storm navy painterly ground with a restrained vortex glow filling the square.
Subject: one stern elemental face assembled from a few large floating obsidian stone shards around a bright diamond-shaped core, with a molten orange flame curling on one side, an icy cyan wave on the other, and one fork of blue lightning crowning the silhouette; the forces merge into one creature, not separate panels.
Lighting/mood: bright inner core light, volatile and ancient.
Color palette: obsidian, molten orange, ice cyan, electric blue, small white-hot core.
Materials/textures: cracked volcanic stone, fire, faceted ice, energized vapor.
Additional constraints: no humanoid skin, no weapon, no yin-yang symbol, no elemental alphabet glyphs.
```

### dragonkin

References: `public/ui/classes/hunter.webp`, `public/ui/classes/warlock.webp`

Built-in result: `exec-449be9bb-841d-4b0a-ac3e-27beac5376e7.png`

```text
Primary request: Create a fresh original painted emblem for the Dragonkin creature family.
Scene/backdrop: deep charcoal and volcanic burgundy painterly ground with restrained ember smoke filling the square.
Subject: a regal crimson drake head and upper neck in three-quarter view, with swept obsidian horns, layered gold-edged scales, one blazing amber eye, and a protective coil around a small cracked dark egg at the base; unmistakably draconic.
Lighting/mood: fierce top-left forge light and soft ember underglow, ancient and sovereign.
Color palette: crimson, obsidian, ember orange, antique gold, charcoal.
Materials/textures: overlapping dragon scales, horn ridges, cracked eggshell, ash.
Additional constraints: no full dragon body, no wings touching the edge, no humanoid armor, no serpent-only silhouette.
```

### reptile

References: `public/ui/classes/druid.webp`, `public/ui/classes/hunter.webp`

Built-in result: `exec-026493f3-7784-4f22-bc0a-24567611789b.png`

```text
Primary request: Create a fresh original painted emblem for the Reptile creature family.
Scene/backdrop: deep swamp green and black-teal painterly ground with restrained moonlit water ripples filling the square.
Subject: an emerald spear-jawed crocodilian head in three-quarter view, long narrow snout, one curved ivory fang, gold slit-pupil eye, armored neck scales, and a subtle curling tail silhouette behind; unmistakably reptilian and not a dragon.
Lighting/mood: cold top-left moonlight with a small warm eye glow, patient and predatory.
Color palette: emerald, black-teal, moss, antique gold, ivory.
Materials/textures: wet plate scales, ridged hide, worn fang, dark water.
Additional constraints: no horns, no wings, no fire, no snake knot, no cute lizard.
```

### demon

References: `public/ui/classes/warlock.webp`, `public/ui/classes/mage.webp`

Built-in result: `exec-a3852542-c22a-47ba-8c7e-5955e026b1a0.png`

```text
Primary request: Create a fresh original painted emblem for the Demon creature family.
Scene/backdrop: abyssal near-black violet painterly ground with restrained green-violet rift flame filling the square.
Subject: one angular obsidian fiend mask with two broad backswept horns, a split crown ridge, glowing acid-green eyes, and a compact violet flame rising from its open fanged mouth; unmistakably demonic but original.
Lighting/mood: harsh violet top-left rim light and poisonous inner glow, alien and menacing.
Color palette: obsidian black, deep violet, acid green, small ember magenta accents.
Materials/textures: cracked volcanic armor, horn striations, supernatural flame.
Additional constraints: no skull face, no pentagram, no occult text, no bat wings, no resemblance to a letter M.
```

### sheep

References: `public/ui/classes/druid.webp`, `public/ui/classes/paladin.webp`

Built-in result: `exec-b15fa2a8-4742-4bcf-a588-3e5e3dee709f.png`

```text
Primary request: Create a fresh original painted emblem for the Sheep creature family.
Scene/backdrop: deep meadow green and twilight blue painterly ground with restrained dawn-gold grass shapes filling the square.
Subject: one proud ivory ram head viewed frontally, dense faceted wool, two large symmetrical curled bronze-gold horns, calm dark eyes, and three simple meadow leaves at the base; sturdy pastoral creature, dignified rather than cute.
Lighting/mood: warm top-left dawn light, gentle and steadfast.
Color palette: warm ivory, bronze gold, meadow green, twilight blue, near-black.
Materials/textures: thick wool curls, ridged horn, soft leaves.
Additional constraints: no halo, no religious symbol, no cartoon smile, no tiny lamb, no bell with lettering.
```

## Status prompt suffixes

### npc

References: `public/ui/classes/paladin.webp`, `public/ui/deeds/soc_civic_duty.webp`

Built-in result: `exec-59192e9c-5711-4f0e-8303-f6bf92462f7f.png`

```text
Primary request: Create a fresh original friendly civic emblem for the NPC status used by townspeople, vendors, bursars, and quest-givers.
Scene/backdrop: deep welcoming midnight blue and warm umber painterly ground with a restrained lamplit town glow filling the square.
Subject: one open unarmored human hand, palm upward, gently presenting a small brass lantern with a bright golden flame; two simple stone town-roof silhouettes and a tiny olive sprig support the emblem without clutter. The open hand and lantern are the unmistakable focus.
Lighting/mood: soft top-left lantern light, trustworthy, welcoming, civic, and helpful.
Color palette: warm brass, golden amber, natural skin, midnight blue, muted olive, dark umber.
Materials/textures: hand-painted skin, aged brass, warm glass, stone silhouette.
Additional constraints: anatomically convincing single hand with five fingers, one lantern, no weapon, no bag, no money symbol, no rune, no letter M, no royal crown, no threatening face.
```

### boss

References: `public/ui/classes/warrior.webp`, `public/ui/classes/warlock.webp`

Built-in result: `exec-87e10f00-927b-44dc-9f4f-5d936f3387ce.png`

```text
Primary request: Create a fresh original emblem for Boss status that instantly communicates a uniquely dangerous elite enemy.
Scene/backdrop: deep near-black crimson and charcoal painterly ground with a restrained furnace glow filling the square.
Subject: one enormous scarred crimson monster eye beneath a jagged black-iron crown, flanked by two short broken horn tips; three heavy crown points form a compact sovereign silhouette without resembling letters.
Lighting/mood: hard top-left red-gold rim light and a fierce inner eye glow, commanding and lethal.
Color palette: black iron, blood crimson, ember orange, small antique-gold highlights, charcoal.
Materials/textures: pitted crown metal, scarred hide, glassy eye, ash sparks.
Additional constraints: exactly one eye and one crown, no humanoid king portrait, no skull, no text, no rank number.
```

### dead

References: `public/ui/classes/priest.webp`, `public/ui/classes/warrior.webp`

Built-in result: `exec-73aa2e65-2581-4c0c-a710-603ccd88c8ec.png`

```text
Primary request: Create a fresh original emblem for Dead status that reads immediately as a fallen unit, distinct from a living undead creature.
Scene/backdrop: deep desaturated blue-gray and charcoal painterly ground with a restrained cold memorial glow filling the square.
Subject: one empty silver battle helm resting on its side, visibly split by a deep crack, beside one extinguished short candle with a thin curl of gray smoke and one wilted ivory lily laid across the foreground; solemn funerary still life with a compact silhouette.
Lighting/mood: cold top-left moonlight, quiet, final, and mournful.
Color palette: tarnished silver, ash gray, midnight blue, candle ivory, muted faded gold.
Materials/textures: scratched steel, cold wax, wilted petals, stone dust.
Additional constraints: no living face, no glowing eyes, no blood, no gore, no red X, no skull, no upright heroic weapon.
```

### combat

References: `public/ui/classes/warrior.webp`, `public/ui/classes/shaman.webp`

Built-in result: `exec-4670288c-13d5-4d34-9ff2-d8960ae62a46.png`

```text
Primary request: Create a fresh original emblem for Combat status that instantly reads as active melee engagement.
Scene/backdrop: deep near-black red and smoky navy painterly ground with a restrained explosive spark burst filling the square.
Subject: one bright steel longsword and one dark bearded battle axe crossing at a strong diagonal, their impact point throwing a compact burst of orange sparks and a single red shockwave arc; no shield and no hands.
Lighting/mood: intense top-left forge light, urgent, forceful, kinetic.
Color palette: bright steel, dark iron, ember orange, crimson, smoky navy, worn leather.
Materials/textures: polished blade edge, pitted axe head, leather grips, sparks.
Additional constraints: exactly two weapons, no character, no skull, no blood, no letter X drawn as a flat symbol; the weapons must remain dimensional painted objects.
```

## Accepted files

| Kind | ID | Master SHA-256 | Master bytes | Master | Shipping SHA-256 | Shipping bytes | Shipping |
|---|---|---|---:|---|---|---:|---|
| family | beast | bd792b5454298c2f7f8899ac777336e26bff5aca16be4a0ed59f12623faa44ca | 2243166 | 1254x1254 RGB | 7e44de6c92073b67eceafef9fc5c4d8a7d86195a02aa0490d5a2ccb779a2bafd | 15984 | `public/ui/crests/families/beast.webp` |
| family | humanoid | d139a94538cde68d5250e2284e4187bdabb946da1c2711a0fa4d85ef2dfae17a | 2166204 | 1254x1254 RGB | 54183bee485e22864b6d5c043005624506c88c4cce312f7bdb92c9755f517e45 | 10758 | `public/ui/crests/families/humanoid.webp` |
| family | mudfin | 8f1d2c1e84f5e136a8d947b4a07c9d403db27ea4eee837d91c0956cdeedb9473 | 2105612 | 1254x1254 RGB | 0e20963e39588da9e1edad4ff76abe041b01f04cc08626cd7f4d6b26c9eaf260 | 14550 | `public/ui/crests/families/mudfin.webp` |
| family | spider | 776b58e45b16ea1a7d6660603aa26c1612be9ff797eb1f6a5702582bb3550f93 | 2183151 | 1254x1254 RGB | f1a1e4f36141b220ff84497083d22cb7e331090bbe052cc98c532c54da7667a4 | 15204 | `public/ui/crests/families/spider.webp` |
| family | burrower | c3096128b6628ef970379786400141a010f6b5e12d408a1a33f0372f3d6aa499 | 2177859 | 1254x1254 RGB | 79a7a50f1faadafe2e4b5b5b7b95391d84551555b8c07c689c1c815bb98bda6c | 14096 | `public/ui/crests/families/burrower.webp` |
| family | undead | ac90c0d1cf2c248d86855d6808d5368ddca326e9b935ac7f2ea9a13879f2c30c | 1756804 | 1254x1254 RGB | 0370dfb13ce6aff2d8094bee6ff2aac408ca245e892d44cb320ed300e3b8657c | 10282 | `public/ui/crests/families/undead.webp` |
| family | troll | 991b27777802aece6fb71f07ad62343c419204d41da5c008005758a6c97774e1 | 2238616 | 1254x1254 RGB | cd65f66de9a0f950d16a8abb10649a0da047d01443cc2b289df4e57f641209e9 | 17032 | `public/ui/crests/families/troll.webp` |
| family | ogre | 8f740e009ec738a2f5d8bb068d78a62ce39729750c517530a182a047654d0d8a | 2370796 | 1254x1254 RGB | 0e26658b8a2e1ad06eeb0a3383fd3b95ab1e6f3f9c2c5e79df5c46b55ddc6334 | 12990 | `public/ui/crests/families/ogre.webp` |
| family | elemental | 1aaad2cb91a9ab0b4fce769552f5862de9d2640b55aa09be6df1681d14c89010 | 2258551 | 1254x1254 RGB | 7b3a681c850728f58332c8569fcc8a3698c9130fe86874ef9a6301330ef2c3f0 | 17494 | `public/ui/crests/families/elemental.webp` |
| family | dragonkin | 63e29b36c420e3fc0309090288bb674429f93fae1d5353a2ad69bd76ea50241b | 2205622 | 1254x1254 RGB | 5c383a41d17f9c3046f9d01954df0bb7cd7752a8c80fbaf2006ae160027a3d72 | 14924 | `public/ui/crests/families/dragonkin.webp` |
| family | reptile | 9662a35e82822e1387f8bed85095a596580b4f4d5e09853d82f9e35d32d51a88 | 1975019 | 1254x1254 RGB | 68e66f31aded138d159066a446557a14faf3d68e1a539a7fce44f83b0fe8b2ab | 12544 | `public/ui/crests/families/reptile.webp` |
| family | demon | 399fa7a0466ac2495f1de58ebb72773b5a5f1863b0831e913cc3517112c1fb3c | 2146994 | 1254x1254 RGB | dff82df1f188898085361c9d18b963f9604ba71114cefdfb5ad9955051c56a64 | 12704 | `public/ui/crests/families/demon.webp` |
| family | sheep | 20351a720410be692171b38caa554ed9996eb616455f98f5a3d268114cf4c345 | 2554007 | 1254x1254 RGB | c37514c6cb2dfae77291371b0905471d65555b124ff882a3b71fb28e47056a6b | 18714 | `public/ui/crests/families/sheep.webp` |
| status | npc | 653fa36a6a90004f50d9f51fb6989417c26a9fcfce9ebe1c2ddd74da2b479c97 | 2155567 | 1254x1254 RGB | 9248c9526a7d8ca2a8c60e80b40c78ce08ee78b3b2270ab5acf71980039d0f77 | 9756 | `public/ui/crests/status/npc.webp` |
| status | boss | 3e665e6ea1906cb023e1bae14b8ba2d0bc59bed82c6154c6869bb9bdcba331c3 | 2032903 | 1254x1254 RGB | 1c954bbc38fe0c647fd570d563b793f02f1ae6a70b0ce3be32ef256da39d4514 | 14370 | `public/ui/crests/status/boss.webp` |
| status | dead | 3406c095459a0e3904c28b179e6ca01d3666c3e39ed7b576c8e247f0ab185ce3 | 2289400 | 1254x1254 RGB | 0cd472550d28417713f8822a91fb91f33a1982abf93dd6335d6b5cb8b51a23d5 | 10444 | `public/ui/crests/status/dead.webp` |
| status | combat | 6e60e1cd677a8844868f1df539049a1e76b1f4e58f5c77e4c6f2560b2dcfc82a | 2098420 | 1254x1254 RGB | 3073dc91ad25e9370d37bec85853dc104f0bc880e05f24f1142afad2bbf0ea0c | 16212 | `public/ui/crests/status/combat.webp` |

## Visual QA

Family contact sheet: `tmp/imagegen/placeholder-art-completion/crests/families-contact.png`

Status contact sheet: `tmp/imagegen/placeholder-art-completion/crests/status-contact.png`

All accepted icons were inspected at master resolution and in the 256 by 256 shipping contact sheets. No regeneration was required.
