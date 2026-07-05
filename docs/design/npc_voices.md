# NPC Voice Prompts

Voice-direction reference for every named NPC in World of ClaudeCraft.

The NPCs have **no unique portrait/image assets** — they are rendered
procedurally from a small set of shared GLB player models (knight, mage,
barbarian, rogue, classic-mage), each tinted with the NPC's signature color and
given gear (helmet + cape, staff, axe, crossbow). See
`src/render/characters/manifest.ts` (`NPC_KEYS` → `VISUALS`) and the per-zone
content files (`src/sim/content/zone1.ts`, `zone2.ts`, `zone3.ts`, `temple.ts`).

Each entry below grounds the voice in what actually defines that NPC's look —
body archetype, tint color, weapon/silhouette — plus its role and its in-game
greeting line (the strongest signal for personality and cadence). The **voice
test** is a single sentence chosen to exercise the voice's signature timbre,
pacing, and attitude.

There are 17 distinct characters. Brother Aldric appears in all three zones and
Scout Maren in two — the same character each time.

---

## Eastbrook Vale

### The Merchant — *Keeper of the World Market*
**Visual:** rogue body, gold tint, unarmed, merchant poise.

Warm, silver-tongued auctioneer — mid-range, lightly gravelled, perpetually
amused. Rolling crier's cadence that could sell you your own boots; honeyed,
persuasive, each line lifting on a lilt of opportunity. Age 50s, unhurried.

**Voice test:** *"Step right up, friend — buy from every adventurer in the realm, or lay out your wares and let the coin come find you."*

### Marshal Redbrook — *Town Marshal*
**Visual:** knight, bronze tint, helmet + cape, 1H sword.

Weathered military baritone, clipped and grave, gravel under every word. Low,
steady, weary authority — short, hard sentences, no wasted breath. Age 50s,
granite-firm.

**Voice test:** *"Keep your blade close and your eyes open. The Vale is not what it was — and I've buried good men who forgot it."*

### Trader Wilkes — *Provisioner*
**Visual:** rogue, green tint, unarmed.

Bright, chatty everyman tenor — friendly, quick, faintly nasal. Cheerful
grocer's patter, open vowels, easy laugh in the throat. Age 40s.

**Voice test:** *"Fresh bread, clean water, fair prices — now what can I get for you today, eh?"*

### Apothecary Lin — *Herbalist*
**Visual:** robed mage, purple tint, unarmed.

Soft, careful alto — precise, slightly hushed, measuring both herbs and words.
Cool, smooth, faint cautionary edge. Age 30s–40s.

**Voice test:** *"Tread carefully in the eastern woods... not everything that blooms there means you well."*

### Brother Aldric — *Priest of the Vale* (all three zones)
**Visual:** classic-mage, warm-linen robe tint, wooden staff.

Resonant, sorrowful clergyman — warm baritone, worn and reverent, carrying old
grief. Measured, compassionate. Across the quest chain let dread tighten the
hush. Age 60s, devout, haunted.

**Voice test:** *"The Light keep you, child. Even the dead find no rest here of late — and I fear the mountain is listening."*

### Smith Haldren — *Armorer & Weaponsmith*
**Visual:** barbarian (burly), gray tint, 1H axe.

Big, booming, smoke-roughened bass — chest-deep, half-shouted over a forge.
Blunt warmth, consonants hammered like hot steel. Age 40s–50s.

**Voice test:** *"Mind the sparks! Good steel's the difference between a scar and a grave — so don't skimp, eh?"*

### Fisherman Brandt — *Old Salt*
**Visual:** rogue, blue tint, unarmed.

Creaky, salt-cured old sailor — raspy, sing-song, wandering. Quavering with age
and sea-wind, muttering odd gurgling asides. Slow, briny. Age 70s.

**Voice test:** *"Grlmurlgrl— ahh, sorry, lad, been listenin' to them fish-men too long down by the water."*

### Foreman Odell — *Mine Foreman*
**Visual:** barbarian, orange-brown tint, 1H axe.

Gruff, dust-choked working-man's growl — loud, exasperated, blunt. Flattened
vowels, short temper. Age 50s.

**Voice test:** *"The whole dig's crawlin' with those candle-headed vermin — and I want 'em GONE, you hear?"*

---

## Mirefen Marsh

### Warden Fenwick — *Warden of Fenbridge*
**Visual:** knight, brown tint, helmet + cape, 1H sword.

Low, watchful baritone — slow, deliberate, damp-cool and grim. Dry survivor's
humor underneath. Age 40s–50s.

**Voice test:** *"Hold at the gate. Past those reeds, the fen does the killing for us — and it's never short of work."*

### Provisioner Hale — *Provisioner*
**Visual:** rogue, green tint, unarmed.

Wry, rough-and-ready quartermaster's tenor — practical, dry-witted, worn at the
edges. Brisk, sardonic. Age 40s.

**Voice test:** *"Dry boots, dry bread, dry powder — and at Fenbridge, you get two of the three on a good day."*

### Herbalist Yara — *Herbalist*
**Visual:** robed mage, purple tint, unarmed.

Low, earthy contralto — slow, knowing, a marsh-witch reading the thicket. Husky,
grounded, faintly ominous. Age 40s–50s.

**Voice test:** *"Mind the thicket west of the road... the webs hang thick as sailcloth this season."*

### Scout Maren — *Marshal's Scout* (Mirefen + Thornpeak)
**Visual:** rogue, tan/dark-green tint, cape, crossbow.

Quick, low, hushed — a ranger just above a whisper, clipped and urgent,
half-listening to the treeline. Taut, breathless. Age 20s–30s.

**Voice test:** *"Quiet feet, short blade — that's what keeps you breathing out here. Speak quick, I'm due back in the reeds."*

---

## Thornpeak Heights

### Captain Thessaly — *Highwatch Captain*
**Visual:** knight, gray-blue tint, helmet + cape, 1H sword.

Commanding, wind-scoured baritone/contralto — proud, resolute, two centuries of
duty in the tone. Cold air, steel resolve, a faint tremor beneath. Age 40s.

**Voice test:** *"Two hundred years this wall has held — and it will not break on my watch, though I feel it groan."*

### Quartermaster Bree — *Highwatch Quartermaster*
**Visual:** rogue, gold-brown tint, unarmed.

Brisk, no-nonsense mezzo — overworked, dryly funny, rattling off inventory like
a sergeant. Tired smirk behind the words. Age 30s–40s.

**Voice test:** *"Wool, hardtack, steel-shod boots — Highwatch runs on all three, and I'm short of every blessed one."*

### Armorer Hode — *Master Armorer*
**Visual:** barbarian, dark-gray tint, 1H axe.

Deep, curt, forge-hardened bass — fewer words, harder edges. Cold-mountain
gruffness over banked heat. Age 50s.

**Voice test:** *"Forge is hot, grindstone's turning. If it cuts — I sell it. Simple as that."*

### Loremaster Caddis — *Loremaster*
**Visual:** mage, dark-blue tint, staff.

Dry, curious scholar's tenor — precise, slightly distracted, alight with
intellectual hunger and a thread of unease. Age 50s–60s.

**Voice test:** *"Mind the loose shale. The mountain has been... restless of late — and I intend to learn precisely why."*

---

## Glimmermere Temple

### Ondrel Vane — *Tidewatcher*
**Visual:** rogue, pale-blue tint, unarmed.

Hushed, haunted, faintly hypnotic — quiet awe drifting like tide-water, an eerie
sleepless edge. Slow, lulling, otherworldly. Age 30s–40s.

**Voice test:** *"The mere drinks the moonlight... and gives back the drowned. Thirty nights I've watched that gate — and tonight, it is open."*
