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

Most NPCs added after the starter zones carry no `NPC_KEYS` entry at all, so they
render as the shared villager body tinted with their signature colour. For those
the load-bearing grounding is the tint, the title, the zone, and above all the
character's own written dialogue: read the quest text before writing a voice.

One voice serves one character, not one content record. NPCs who recur across
zones under suffixed ids (Brother Aldric, Scout Maren, Brother Halven) map back
to a single designed voice through `VOICE_ALIAS` in
`scripts/voices/npc_voice_prompts.mjs`. Where a first name repeats across zones
(the three Sorrels, the three Pells, the two Eddas, the two Marens, the two
Sauls) those are deliberately DIFFERENT people and each gets its own voice; the
entries below say so explicitly and describe how the pair must differ.

Escortees are voiced too. Escort-quest barks
(`EscortDef.startText`/`successText`/`failText`) ride the same yell channel as
encounter dialogue, so `gen_npc_lines.mjs` derives their clips from the content
bundle and speaks them in a voice designed under the escortee's MobTemplate id.

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

### Bursar Fernando: *The Gilded Strongbox*
**Visual:** `npc_fernando`, bank gold (#c9a227), vault clerk.

Silken, discreet baritone with a faint continental polish, every vowel buffed.
Impeccably courteous, quietly pleased with the strength of his own locks, never
hurried and never quite warm. Age 40s to 50s, male.

**Voice test:** *"Welcome to the Gilded Strongbox. Your goods rest safe behind our locks."*

### Card Master: *Dealer of Chance*
**Visual:** robed villager, deep purple (#7a2f8f), carnival showman.

Sly, theatrical mid-tenor that lifts on every offer, shuffling its own
consonants. Playful, insinuating, delighted either way by how the hand falls.
Age 30s to 40s, male.

**Voice test:** *"Care for a Card Duel? Best of three, winner takes the bragging rights."*

### Saul the Chronicler: *The Vale Chronicle*
**Visual:** `npc_chronicler`, amber (#d08a2e), deeds ledger.

Warm, rounded, avuncular baritone, fireside storyteller cadence, savouring the
shape of a good sentence. Openly proud to write you down. Age 50s, male. (No
relation to Mender Saul of the Farshore: different man, different voice.)

**Voice test:** *"Every deed worth doing is worth writing down twice: once for the ledger and once for the fireside."*

### Cook Marlow: *Master of the Kitchens*
**Visual:** villager, ochre (#c98a4b), flour-dusted.

Hearty, food-warm bass-baritone, half-shouted over pans and then dropping to
confide. Bluff generosity, brisk, feeds you before he answers you. Age 40s to
50s, male.

**Voice test:** *"Nothing leaves my kitchens half-cooked. Sit, eat, then get back out there."*

### Forgemistress Darva: *Master of the Forge*
**Visual:** `npc_smith`, ember orange (#b5541c), work apron.

Strong, iron-hard contralto pitched over a working fire, deliberate as a hammer
stroke, no ornament anywhere in it. Demands an oath before she teaches and means
every clause of it. Age 40s, female.

**Voice test:** *"The forge answers to me. Bring good ore and it will answer to you too."*

### Groundskeeper Bram: *Keeper of the Sowfield*
**Visual:** villager, field green (#3f7d34), sporting field.

Broad, weather-cured country baritone, gruff and grinning: a man who referees a
rough game and enjoys it. Rolling rural vowels, easy laugh, firm on the rules.
Age 40s to 50s, male. (Not Keeper Bram of the Galecrest beacon.)

**Voice test:** *"The truce holds at the Sowfield: boots and shoulders only. Care to play for the Copper Pail?"*

### Tinker Gizzel: *Master of the Toolworks*
**Visual:** `npc_smith`, brass (#b08d57), apron full of things that tick.

Fast, high, crackling voice that trips over itself, doubling words, spiking into
sudden shouted capitals and dropping to a conspiratorial hiss. Giggling,
gleeful, faintly unsafe. Reads small and wiry, age indeterminate, male.

**Voice test:** *"Oh, oh, you want the good stuff, the loud stuff, yes? Listen, listen, before you touch anything that ticks!"*

### Weaver Ottilie: *Master of the Loom*
**Visual:** robed villager, deep violet (#7161a8).

Precise, cool mezzo, unhurried, each phrase measured out to length before it is
spoken. Quietly exacting, faintly maternal to anyone who works carefully,
unimpressed by strength. Age 40s to 50s, female.

**Voice test:** *"Mind the threads. A steady hand at the loom beats a strong one."*

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

### Bursar Petra Vell: *The Gilded Strongbox*
**Visual:** villager, bank gold (#c9a227).

Crisp, prim mezzo, consonants filed clean, the clipped efficiency of someone who
audits for pleasure. Polite, bloodless, faintly proud of how little she says.
Age 30s to 40s, female.

**Voice test:** *"The Gilded Strongbox keeps clean ledgers and cleaner vaults. What shall we stow for you?"*

### Chronicler Osric Fenn: *The Marsh Chronicle*
**Visual:** `npc_chronicler`, damp green (#3fa66b).

Dry, bookish tenor with a resigned wit, sighing slightly on the long vowels.
Fastidious about paper, wry about the fen, never quite dry himself. Age 40s, male.

**Voice test:** *"Mind the damp on the pages. The fen eats more books than readers ever will."*

### Tanner Hesk: *Master of the Tannery*
**Visual:** villager, dark leather brown (#8a5a2a).

Flat, gravelled, extremely terse working voice: sentences of four words, no music
in them at all. Not unfriendly, simply finished talking. Faint rasp of lye and
hide-smoke. Age 40s to 50s, male.

**Voice test:** *"Vats are empty. Bring eight rough hides. Coin when you do."*

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

### Alchemist Verane: *Master of the Apothecary*
**Visual:** robed villager, cold teal (#58b09c).

Clipped, cool, fastidious alto, immaculate diction, faintly condescending in the
way of someone who is usually right about purity. Withholds praise as policy.
Age 30s to 40s, female.

**Voice test:** *"Measure twice and pour once. The apothecary has no patience for spilled reagents."*

### Auctioneer Voss: *Keeper of the World Market*
**Visual:** villager, market violet (#8e5ad6).

Quick, bright, city-slick tenor running auction patter: lighter, younger and more
mercenary than the old crier of the Vale. Practised charm, always mid-pitch.
Age 30s, male.

**Voice test:** *"The World Market is open here too. Buy from every adventurer in the realm, or set out your own wares."*

### Bursar Aldous Crane: *The Gilded Strongbox*
**Visual:** villager, bank gold (#c9a227).

Thin, dry, fussily precise old tenor, narrow vowels, the pace of a man reading a
receipt aloud. Scrupulously polite, mildly pained by imprecision. Age 70s, male.

**Voice test:** *"Every crate, coffer, and trinket is safe with the Gilded Strongbox."*

### Chronicler Zenzie: *The Peaks Chronicle*
**Visual:** `npc_chronicler`, cold blue (#5a6fd6). (Content id `chronicler_edda_hartwell`.)

Brisk, bright, forward-leaning mezzo, quick-tongued and openly eager for a good
story, pen already moving. Sharp memory worn lightly. Age 20s to 30s, female.

**Voice test:** *"The mountain forgets nothing, and neither do I. Let us see what you have done."*

### Quartermaster Vex: *Heroic Quartermaster*
**Visual:** villager, deep purple (#8e44ad).

Low, flat, unimpressed baritone, entirely without warmth: the boredom of someone
who has watched better adventurers fail the same trial. Short sentences, no
encouragement offered. Age 40s, male.

**Voice test:** *"Proof of the heroic depths buys the finest rings and pendants in Highwatch. Show me your marks."*

### Warmarshal Draven Kole: *Master of the Warfare Stores*
**Visual:** knight (helmet, cape, 1H sword), war crimson (#7d2f3f), quartermaster row.

Cold, parade-ground authority: a hard, level baritone that states terms rather
than offers them, every sentence landing like an order already given. Age 40s to
50s, male. **No designed voice of his own yet:** he currently borrows FURY's
through `VOICE_ALIAS`, since he sells the identical WARFARE stock in the same
register, so his lines ship mute until a key is available to design and render
this description. Promote him to his own `VOICE_PROMPTS` entry then, and keep him
audibly colder and more senior than FURY's arena herald.

**Voice test:** *"Honor is the only coin I take, and the Warfare stores are mine to guard."*

### Marla Hitchen: *Stablemaster*
**Visual:** villager, saddle brown (#8b5a2b), riding paddock.

Brisk, weathered horsewoman with a drill instructor bark and real fondness under
it, barking corrections and grinning at the same time. Open-air volume, dust in
the throat. Age 40s, female.

**Voice test:** *"I will not hand you the reins until you can sit the Valorsteed without kissing the dirt."*

---

## Glimmermere Temple

### Ondrel Vane — *Tidewatcher*
**Visual:** rogue, pale-blue tint, unarmed.

Hushed, haunted, faintly hypnotic — quiet awe drifting like tide-water, an eerie
sleepless edge. Slow, lulling, otherworldly. Age 30s–40s.

**Voice test:** *"The mere drinks the moonlight... and gives back the drowned. Thirty nights I've watched that gate — and tonight, it is open."*

---

## Abandoned Crypt raid

### Nythraxis, Scourge of Thornpeak: *the raid boss*
**Visual:** the crypt tyrant-king (see `src/sim/encounters/nythraxis.ts`).

A monstrous undead tyrant-king risen from the crypt: a vast, cavernous bass, slow
and imperious, grinding like a tomb door over stone. Two centuries of grief
twisted into mad, regal cruelty. Commanding, contemptuous, unhurried, with a
guttural rasp of decay. Ancient, male. Encounter dialogue is voiced through
`EXTRA_LINES` rather than an `NpcDef`.

**Voice test:** *"I built a kingdom that should have outlived the stars. Kneel before your king."*

---

## Eldergleam, the Veiled Hollow

### Keeper Saelwyn: *Keeper of the Hollow*
**Visual:** `npc_mage`, pale lilac (#d8c4f0).

Ageless keeper of a sealed elven hollow: a cool, luminous contralto, unhurried to
the point of strangeness, every word placed like a stone in still water.
Courteous, remote, faintly sorrowful, the calm of someone who has outlived
several human centuries and expects to outlive several more. Never raises her
voice. Female, age unreadable.

**Voice test:** *"Few of your kind have stood beneath these boughs. Walk gently, and be welcome."*

### Loremother Bryn: *Voice of the Shrine*
**Visual:** robed villager, parchment (#c4b08a).

Warm, softly worn alto, hushed the way a voice goes hushed inside a chapel.
Patient, kindly, listening even while she speaks. Reverent about small things and
gently insistent that grim work is still mending work. Age 60s to 70s, female.

**Voice test:** *"Every light in this valley remembers something. Help me listen."*

### Provisioner Fenna: *Eldergleam Provisioner*
**Visual:** `npc_villager`, soft green (#8fbf8a).

Bright, generous mezzo with an open smile in it, brisk market cadence, always
half a beat ahead of the customer. Uncomplicated warmth, quick to laugh at her
own sales patter. Age 30s to 40s, female.

**Voice test:** *"Bread still warm, water still sweet. The Hollow provides, and so do I."*

### Huntsman Deral: *Warden of the Herds*
**Visual:** `npc_scout`, moss (#7d9668).

Low, breath-controlled murmur pitched to carry three paces and no further,
consonants soft so nothing spooks. Steady, weathered, reluctant to say a hard
thing aloud and heavier when he does. Age 40s to 50s, male.

**Voice test:** *"Quiet now. The herd knows every sound this valley makes, and so do I."*

### Archivist Tullo: *Reader of Stones*
**Visual:** robed villager, pale violet (#b8a8d8).

Thin, papery, high-set old tenor that cracks upward with delight the instant a
fact clicks into place. Fussy, digressive, gleefully pedantic: two centuries of
dust in the throat and a scholar boy still bouncing underneath it. Age 80s, male.

**Voice test:** *"Look at the striations! Autumn. The Hollow was sealed in autumn."*

### Wardsmith Orun: *Keeper of the Old Forges*
**Visual:** `npc_smith`, dusty violet (#9a86b8).

Deep, quiet, close-mic bass, all chest and no volume: the reverence of a man
working in a room he considers a tomb. Slow, spare, every sentence sounding like
it was decided on years in advance. Age 50s to 60s, male.

**Voice test:** *"These forges cooled centuries ago, but their work still holds an edge."*

---

## Frostveil Reach (Icemantle)

### Warden Kaldra: *Warden of Icemantle*
**Visual:** villager, pale steel blue (#9fb8cc).

Hard, low contralto scoured flat by wind, stoic to the edge of grim, warming
perhaps a quarter-inch when the news is good. Short breaths, cold-tightened
consonants, a grandmother-deep sense of duty to the post. Age 40s to 50s, female.

**Voice test:** *"Mind the benches, stranger. The snow keeps what it takes."*

### Hearthkeeper Maeve: *Keeper of the Hearth-Lodge*
**Visual:** villager, warm amber (#d9a066).

Round, generous, motherly alto with the crackle of woodsmoke in it, pulling you
in out of the cold before she asks your name. Practical kindness, fond
exasperation, never sentimental. Age 50s, female.

**Voice test:** *"Come in off the cold. The lodge fire never goes out, so long as I draw breath."*

### Scout Einna: *Snowline Scout*
**Visual:** villager, frost blue (#8fa8b8), waycamp.

Clipped, cold-bitten young voice, brisk and slightly breathless from the
altitude, clamping down on the vowels to keep the wind out. Blunt, efficient,
quietly impressed. Age 20s, female.

**Voice test:** *"You walked the pass alive. Good. Icemantle should hear of it."*

### Aurorist Veyla: *Reader of the Lights*
**Visual:** villager, pale violet (#b8a2e0).

Hushed, breathy, half-entranced voice, slow and lifted, listening to the sky
between phrases. Otherworldly calm over real fear, shushing you mid-sentence.
Age 30s to 40s, female.

**Voice test:** *"Hush. The lights are speaking tonight, and they do not repeat themselves."*

### Trapper Brosk: *Shiverfen Trapper*
**Visual:** villager, drab olive (#7d8a6a).

Craggy, cold-roughened old voice, laconic, with a short dry laugh that arrives
instead of a sentence. Stubborn, unsentimental, secretly rattled. Age 60s, male.

**Voice test:** *"Fen took three of my lines this week. Fen never took a line in twenty years."*

---

## The Drakelands (Wyrmwatch)

### Gatecaptain Brannoc: *Commander of Wyrmwatch*
**Visual:** villager, brick red (#a84838).

Hard-baked military baritone with ash in the throat, parade-ground projection
held down to a growl, absolutely immovable. Repeats himself for emphasis, never
for doubt. Age 50s, male.

**Voice test:** *"Wyrmwatch holds the gate. Has held it forty years. It will hold it tonight."*

### Quartermaster Sela: *Keeper of the Garrison Stores*
**Visual:** villager, dun gold (#c09858).

Practical, slightly tired mezzo running an inventory cadence, warm underneath the
brusqueness, protective of her drivers. Dust-dry humour about very grim things.
Age 30s to 40s, female.

**Voice test:** *"Every crate in this yard crossed forty miles of ash to get here. Treat them kindly."*

### Scout Yerrin: *Far-Dune Watcher*
**Visual:** villager, dune tan (#8a7a58), a month alone on a ridge.

Low, dry, hyper-alert murmur, sun-cracked lips, breaking off to listen. Speaks in
intelligence, not opinion, and keeps the fear underneath the report. Age 30s,
female.

**Voice test:** *"Keep low. Sound carries strangely off the glass, and the gate below has ears."*

---

## The Wraithwood (Gallowmere)

### Sexton Marrow: *Sexton of Gallowmere*
**Visual:** villager, slate grey (#6a6a72). (Defined in `src/sim/content/dungeons.ts`.)

Deep, measured, sepulchral bass, patient as a tolling bell, kindly in a way that
never stops sounding like a funeral. Takes duty to the buried and the living as
one job. Age 50s to 60s, male.

**Voice test:** *"We bury them deep here, and we ring the bells so they remember to stay down."*

### Lampman Cobb: *Keeper of the Crowgate Lanterns*
**Visual:** villager, lantern gold (#c9a86a).

Soft, kindly, careful old voice, quiet on purpose: someone who has kept a light
burning for thirty years and does not want to attract attention. Gentle warning
under every phrase. Age 60s, male.

**Voice test:** *"Stay in the lamplight, friend. The wood counts everyone who passes the gate."*

### Vicar Creel: *Last Vicar of the Mournstone*
**Visual:** villager, grey-green (#8f9a88).

Weary, hollowed-out clergyman tenor, the liturgy worn out of it, arid gallows
calm where the comfort used to be. Honest, unillusioned, done pretending prayer
will finish the job. Age 50s, male. Deliberately NOT Brother Aldric's warm
sorrowing devotion: Creel has stopped expecting help.

**Voice test:** *"The chapel fell years ago. The dead beneath it did not notice, and so I stayed."*

### Widow Tansy: *Candlewright of Gallowmere*
**Visual:** villager, mourning mauve (#b8a2c8).

Brittle, tremulous old voice that thins upward when she insists, with unbending
iron directly underneath the shake. Ferocious about the candles, tender about the
dead. Age 70s, female.

**Voice test:** *"A candle for every grave, and not one may go out. Not one, do you hear me?"*

---

## The Evergarden (Hedgewick)

### Gatewarden Pell: *Keeper of the Garden Gate*
**Visual:** villager, moss green (#8a9a6a).

Mild, dutiful, slightly nervy voice, polite to a fault, glancing over his
shoulder at the hedges mid-sentence. Reports the same unsettling thing every week
without ever getting used to it. Age 30s to 40s, male. One of three unrelated
Pells: this one is the anxious male gate clerk.

**Voice test:** *"Mind how you go on the lawns. The garden keeps them trimmed, and it likes them tidy."*

### Head Gardener Amaranth: *Head Gardener of the Evergarden*
**Visual:** villager, dusty rose (#b46a7a).

Frayed, soft, over-precise voice worn thin at the edges, drifting and then
catching itself. Exhausted competence, dread kept behind bookkeeping. Age 40s,
female.

**Voice test:** *"Do not mind the shadows under my eyes. Someone has to stay awake while the garden dreams."*

### Wickmother Sorrel: *Keeper of the Hedgewick Inn*
**Visual:** villager, warm terracotta (#c98a5a).

Bustling, hospitable older voice, round and busy, seating you and pouring for you
while she talks. Cheerful indignation at thieving garden gnomes, unbothered by
anything larger. Age 50s, female. One of three unrelated Sorrels: this one is the
innkeeper.

**Voice test:** *"Come in, sit, there is cordial on the fire. Just keep a hand on anything iron."*

### Gardener Yew: *The Last Gardener*
**Visual:** villager, deep green (#556b45), a hundred years on the same lawns.

Very old, earthy, unhurried voice, mossy and low, so calm it becomes uncanny.
Speaks of the garden as a colleague and of his own masterwork as something that
must now be unmade. Age 90s or older, male.

**Voice test:** *"The garden is afraid. In a hundred years I have never once known it afraid."*

---

## The Nightbloom (Moonrest)

### Lamplighter Sorrel: *Keeper of the Nightgate*
**Visual:** villager, lamp gold (#d9b066).

Easy, wry, low voice with a night-shift calm to it, unhurried, quietly amused by
newcomers squinting at a sky that never brightens. Age 40s, male. One of three
unrelated Sorrels: this one is the male lamp keeper.

**Voice test:** *"Mind the lamps, friend. Past this gate the sun gives up and the flowers take over."*

### Lira Dewsong: *Night-Gardener of Moonrest*
**Visual:** villager, pale silver-green (#9fc79a).

Gentle, lilting voice with a silvered evening softness, welcoming and a little
dreamlike, phrases falling like a lullaby without ever losing their sense.
Age 30s, female.

**Voice test:** *"Welcome to Moonrest, where the flowers do our dawning for us."*

### Weaver Amelle: *Moonfleece Weaver*
**Visual:** villager, near-white silver (#e6e9f4).

Soft, breathy young voice that goes delighted and hushed at the feel of good
wool, sensory and close-in, almost confiding. Age 20s to 30s, female.

**Voice test:** *"Feel that? Moonfleece on the loom. Warmer than any fire you have sat beside."*

### Astronomer Cassian: *Watcher at the Vigil*
**Visual:** villager, lavender (#9a8fd0).

Whispering, precise tenor, wonderstruck and increasingly alarmed, shushing you
and then rushing on. Scholarly exactness stretched over a month without proper
sleep. Age 40s, male.

**Voice test:** *"Hush now. The sky never dawns here, so it never stops talking either."*

---

## The Amberfall (Lanternmere)

### Waywatcher Sorrel: *Watcher of the Goldmelt*
**Visual:** villager, tan buckskin (#9a7d5a), pass shrine.

Hardy, laconic voice, wind-worn and level, greeting travellers in short measured
lines. Warm but sparing, used to her own company. Age 30s to 40s, female. One of
three unrelated Sorrels: this one is the pass watcher.

**Voice test:** *"Snow behind you, gold ahead. Few walk the Goldmelt twice, so make the crossing count."*

### Reeve Ottoline: *Reeve of Lanternmere*
**Visual:** villager, lantern amber (#c08848).

Brisk, capable, dryly amused older voice, civic and unflappable, handing out work
like a woman with a list already in hand. Fond of the town, blunt about its
troubles. Age 50s, female.

**Voice test:** *"Welcome to Lanternmere, where the harvest never ends and neither does the work."*

### Orchardist Pomeline: *Keeper of the Gilded Rows*
**Visual:** villager, olive green (#8a9a4a).

Tart, proprietary older voice, clipped and territorial, prickly toward town
officials and grudgingly warm to anyone who does the work. Superstitious respect
for her own trees. Age 50s to 60s, female.

**Voice test:** *"Mind where you step. Every root in these rows is older than the town, and they remember."*

### Ferrymaster Caddow: *Keeper of the Lantern Ferries*
**Visual:** villager, slate blue (#6a7d8a).

Low, damp, careful voice, slow and weighted, dropping quieter for the things the
old ferrymen only say ashore. Practical superstition, real worry underneath the
calm. Age 50s, male.

**Voice test:** *"When the lanterns go out on the water, wise folk stay ashore."*

---

## The Willowfen (Bridgemere)

### Waykeeper Pell: *Keeper of the Amberfen Steps*
**Visual:** villager, pale willow green (#a8b878).

Warm, easy, unhurried voice, hospitable without fuss, keeping a fire lit through
any fog. Gentle caution, no drama. Age 40s, female. One of three unrelated Pells:
this one is the female waycamp keeper.

**Voice test:** *"Down the Steps and into the soft country. Mind where you plant your boots."*

### Bridgewright Alden: *Master of the Fenway*
**Visual:** villager, timber brown (#8a6f4d).

Solid, practical, grumbling-fond baritone with a carpenter rhythm, proprietary
about every plank in town. Complains as a form of affection. Age 40s to 50s, male.

**Voice test:** *"Every plank in this town is mine to keep, and the fen chews on all of them."*

### Netter Maris: *Eel-Netter of Bridgemere*
**Visual:** villager, teal and river grey (#6f9aa0).

Quick, chatty voice with smoke and salt in it, openly proud of what her trade has
bought, counting coin out loud. Cheerful mercantile bustle. Age 30s to 40s,
female.

**Voice test:** *"Smell that? Smoked eel. Half this town stands on stilts I bought with it."*

### Mother Sedge: *Fen-Witch of Willowweep*
**Visual:** villager, drab olive (#7d8a5a).

Slow, papery, sing-song old voice, rustling like dry reeds, drifting off and
returning with the answer. Uncanny certainty, kindly, entirely unbothered by her
own strangeness. Age 70s, female. Distinct from Herbalist Yara of Mirefen: Sedge
is older, thinner and more lilting where Yara is husky and grounded.

**Voice test:** *"The willows told me you were coming before your boots left the bridge."*

---

## The Palmreach (Drifthaven)

### Strandwatcher Pell: *Watcher of the Tanglemouth*
**Visual:** villager, pale sand (#c9b07a).

Relieved, sunny, easy voice, open-throated after the dark trees, welcoming
travellers out into the light. Uncomplicated cheer, faint tropical drawl. Age
30s, male. One of three unrelated Pells: this one is the cheerful strand watcher.

**Voice test:** *"Out of the black trees at last. Breathe, stranger, the sun holds this side of the pass."*

### Salvage-Boss Ryna: *Mistress of the Wreck Line*
**Visual:** villager, rust orange (#b46a3c).

Loud, brassy, commanding voice pitched across a beach, laughing at her own hard
jokes, dockside profanity implied but never said. Genuine care for her crews
under the volume. Age 30s to 40s, female.

**Voice test:** *"The wreck line pays well, if the crabs leave you enough fingers to count it."*

### Pearl-Mother Isha: *Elder of the Divers*
**Visual:** villager, seafoam green (#8fb8b0).

Calm, deep, matriarchal older voice, measured and salt-worn, speaking in proverbs
that are also warnings. Unhurried authority, will not be argued with. Age 60s,
female.

**Voice test:** *"The sea gives, the sand keeps, and the jungle takes. Stay on the strand, stranger."*

### Okku: *The Man Who Went In*
**Visual:** villager, deep jungle green (#6f8a5a), banyan camp.

Hushed, cracked voice, whisper-taut and hyper-attentive, breaking off to count a
sound. The only man who walked toward the drums and came back, and it is audible.
Age 50s to 60s, male.

**Voice test:** *"The drums count everything that walks under the trees, and they have already counted you."*

---

## The Galecrest (Wickharbor)

### Watcher Maren: *The Windway Watch*
**Visual:** villager, grey-blue (#9aa8b4), pass gate.

Hardy voice pitched to be heard over a gale, clipped and wry, half the words
snatched away. Weather-hardened good humour, no patience for questions. Age 30s
to 40s, female. A DIFFERENT woman from Scout Maren of the marshes: older, louder,
blunter, and she gets her own voice.

**Voice test:** *"Mind your footing past the gate. The wind up here takes hats first and questions never."*

### Harbormaster Odile: *Harbormaster of Wickharbor*
**Visual:** villager, deep sea blue (#4a6a8a).

Brisk, salt-worn contralto, commanding and tide-hurried, cutting a greeting short
because the water will not wait. Dry coastal praise, given rarely. Age 40s,
female.

**Voice test:** *"Every boat in this cove owes the Old Beacon its keel. Speak quick, the tide will not wait."*

### Keeper Bram: *Keeper of the Old Beacon*
**Visual:** villager, lamp gold (#c8b06a), lighthouse balcony.

Proud old voice with a gale-roughened rasp and a quaver he refuses to
acknowledge, warm to a visitor who made the climb. Duty spoken as fact, never as
complaint. Age 70s, male. Not Groundskeeper Bram of the Vale, and not Fisher Bram
of the Farshore.

**Voice test:** *"Nine and thirty years this lamp has burned on my watch. It will not go dark on yours."*

### Salvager Edda: *Wreckfield Salvager*
**Visual:** villager, driftwood olive (#7d8a6a).

Dry, hard, sardonic voice, flat and unhurried, quoting salvage law as though she
wrote it, which in practice she did. Unimpressed by the walking dead on her own
beach. Age 40s, female. One of two unrelated Eddas; the Farshore quartermaster is
lower, slower and more tired.

**Voice test:** *"Half of this is yours by law, and by law I mean I say so."*

---

## The Farshore (Gullhaven)

### Bellkeeper Tam: *Watchbell Keeper*
**Visual:** villager, sea green (#4a7b6b).

Steady, kindly older voice, bell-clear and carefully paced when he explains the
tolls, with a thread of dark humour about the third one. Calm because someone has
to be. Age 50s to 60s, male.

**Voice test:** *"One toll for the fields, two for the cliffs, three when it is close enough that running will not help."*

### Warden Coalfast: *Redoubt Commander*
**Visual:** villager, burnt sienna (#8a4b2b).

Grim, exhausted, resolute baritone, siege-worn and gravelled, spending words like
rationed stores. Fierce protectiveness of a small town under real threat. Age 40s
to 50s, male.

**Voice test:** *"We hold this shore, or there is no shore left to hold. Stand with us and I will not forget it."*

### Quartermaster Edda: *Redoubt Armorer*
**Visual:** villager, olive drab (#6b6b3a).

Blunt, weary, soldierly voice, heavy and flat, no ceremony at all. Age 40s to
50s, female. One of two unrelated Eddas; keep her lower, slower and more tired
than the Galecrest salvager.

**Voice test:** *"Steel and salt, it is all I have left to hand out. Steel for steel: it is the only trade the Farshore runs."*

### Mender Saul: *Field Surgeon*
**Visual:** villager, blood red (#9a3b3b).

Tired, gentle, precise voice, clinical wording carried on real compassion,
dropping to a quiet request at the end of a sentence. Age 40s, male. No relation
to Saul the Chronicler of the Vale.

**Voice test:** *"Come back to me whole, if you can manage it. Do me the kindness of not becoming my next patient."*

### Frightened Nell: *Gullhaven Fisher*
**Visual:** villager, pale washed blue (#5a7a9a).

Small, trembling voice, halting, breaking mid-phrase and starting again,
repeating herself the way frightened people do. Turns fierce and tearful with
relief at the end of her chain. Age 30s, female.

**Voice test:** *"It opened right where the nets dry. Right there, where I stood every morning of my life."*

### Riftwatch Ollun: *Breach Scholar*
**Visual:** villager, deep blue (#3f5f8a).

Intense, murmuring voice, rapid then suddenly still, breaking off to listen and
asking you to be quiet too. Precise vocabulary at the edge of raving, entirely
sane and entirely alarming. Age 40s, male.

**Voice test:** *"I can hear three of them stirring on the island right now, and one of them is close."*

---

## Realm services (present in every hub, or at every graveyard)

### Brother Halven: *Reliquary Keeper* (every delve entrance)
**Visual:** `npc_reliquary_keeper`, near-black habit (#2b2620).

Low, hushed, monkish voice with a subterranean calm, unhurried, close-mic quiet
as though the ceiling were low. Steady reassurance, no warmth wasted. Age 40s to
50s, male. `brother_halven_marsh` is the same man and reuses this voice.

**Voice test:** *"Choose your tier, and I'll hold the rope until you return."*

### FURY: *Honor Quartermaster*
**Visual:** knight (helmet, cape, 1H sword), blood red (#b52a2a), arena sands.

Harsh, metallic, half-shouted voice like a herald over a crowd, brutal and
clipped, consonants struck rather than spoken. Every line sounds like the
announcement of a match. Age 30s to 40s, male.

**Voice test:** *"The sands remember every victory. Spend your honor well."*

### The Pale Keeper: *Warden of the Dead* (every graveyard)
**Visual:** robed villager rendered translucent, pale gold (#fff4d0).

Weightless, breathy, faintly doubled whisper that seems to arrive from a little
further away than she stands. Infinitely gentle, sorrowful, entirely without
urgency. Age unreadable, female.

**Voice test:** *"Rest now, spirit. I can return you to your body, but the crossing back leaves you weak."*

---

## Escortees (escort-quest barks)

These four speak only through `EscortDef.startText`/`successText`/`failText`,
broadcast on the yell channel by `emitMobYell`. `gen_npc_lines.mjs` derives the
clips from the content bundle, so a reworded bark must be re-synthesized (there is
no fallback: an unmatched line simply plays nothing).

### Fisher Bram: *Bram Come Home* (the Farshore)
Hoarse, shaken working-man tenor, thin from days on a cold shore, cracking upward
with disbelieving joy and then with grief. Plain speech, deep feeling, no
composure left. Age 30s to 40s, male.

**Voice test:** *"Nell sent you? Then she is alive, oh, thank the tide."*

### Apprentice Wren: *Seeing Wren Home* (Frostveil Reach)
Light, thin, frightened young adult voice, breath short with cold and fear, going
bright and tumbling with relief the moment she is safe. Age early 20s, female.
**Cast adult on purpose:** the text-to-voice design endpoint refuses any prompt
asking for a child or early-teen voice (HTTP 403, `blocked_generation`). The
content only ever calls her "the girl", which a frightened young woman reads as,
so keep any rewrite of this entry adult.

**Voice test:** *"Stay close, please. The wolves have been circling since dusk."*

### Navigator Suli: *The Lost Navigator* (the Palmreach)
Low, rasping voice, exhausted but proud and still giving directions, refusing to
be carried. Wry sailor stubbornness at the end of her strength. Age 30s, female.
(Content id `castaway_navigator`.)

**Voice test:** *"Stay between me and the water, the crabs come from the surf."*

### Gravedigger Mosley: *Walking Mosley Home* (the Wraithwood)
Rattled, prattling older voice, nervous chatter to keep the wood at bay, dropping
to a whisper at the word horn. Comic in daylight, genuinely terrified now.
Age 50s to 60s, male.

**Voice test:** *"Keep between me and the trees, and if you hear a horn, we run."*
