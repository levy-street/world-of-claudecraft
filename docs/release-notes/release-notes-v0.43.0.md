# World of ClaudeCraft v0.43.0 Release Notes

**Release:** v0.43.0
**Date:** 2026-09-17
**Previous release:** v0.42.2 (2026-09-11)

Version 0.43.0 is the interface release. Every HUD frame and every window is rebuilt on one shared
library, so the game reads as a single system while keeping the classic look it has always had.
Around that sit the two changes you will feel fastest: the Book of Deeds and the Reliquary become
account-wide, and every item of uncommon quality and above now carries a stamina baseline, so a
caster's health no longer depends on which tier they happened to wear. The druid's feral form gets
its own authored cat and a real mobility kit, Nythraxis's Bone Storm is retuned from live parses,
the World Market learns to buy across many listings at once, and a long run of performance work
targets integrated GPUs and four-core laptops. This release also carries everything from the
v0.42.1 and v0.42.2 hotfix lines, which were forward-merged into it.

## Highlights

- The whole interface is rebuilt on one shared token and primitive library.
- The Book of Deeds and the Reliquary are account-wide, with every card naming the earner.
- Every item of uncommon quality and above carries a stamina baseline, and every class gains more
  health per level, so cloth wearers stop being made of paper.
- Cat Form gets its own authored cat, plus passive speed, a control break, and a new Wildfang kit.
- Nythraxis's Bone Storm drops its mid-storm Bone Spike, and its opening slam is a third softer.
- Market Sweep buys across many sellers in one command, cheapest per unit first, and the $WOC
  Exchange gains a Sales History tab.
- Watched Spells gives any known self-buff its own aura overlay, with optional sound, hotbar glow,
  reticle tick and rumble.
- Action bars are remembered per specialization.
- /who becomes a searchable, sortable Who tab in the Social window.

## Interface and options

The redesign keeps the classic look (gold, warm borders, Cinzel titles, the painted art) and
rebuilds everything on one shared library.

- **HUD.** Unbacked action bars with a floating page control and left-hanging stance discs, a quiet
  XP rail twelve sockets wide, plateless unit frames with portrait medals and cast ribbons, party
  panels with a Party N disclosure that remembers its state, and the Talking Head.
- **Windows.** Character, bags, spellbook, talents, quest log, options, vendor, mailbox, trade, bank
  and vaults, crafting, professions, World Market, dungeon finder, arena, leaderboard and the rest
  adopt one window grammar, with every row and control kept. The cross hotbar, controller strip and
  touch HUD follow the same library, and every theme preset keeps its contrast.
- **Watched Spells.** Any known spell that parks an aura on you can take its own overlay, so the
  Auras panel is no longer a dead end for a class with no talent proc. Every proc also gains four
  channels, off by default: an Alert Sound, a Hotbar Glow, a Reticle Tick, and rumble.
- **Action bars per specialization**, and a talent swapped for its alternative on the same choice
  row inherits the slot the old one vacated.
- **New and rebindable controls.** Hide Interface on Alt+Z (Escape always restores the HUD first),
  friendly nameplates on Ctrl+V, Target Self on F1 with party members on F2 to F10, and the mouse
  wheel as a bindable key, which makes camera zoom an ordinary rebindable action. Unlock Interface
  leads the Esc menu, and a zoom-out on an instance floor plan now opens the zone map.
- **Absorb shields stop striping the health bar**, your target's raid marker shows on the target
  frame, and the meters count damage dealt to players in duels, arena and battlegrounds.
- **The leaderboard is a ledger** with a podium for the top three on every tab, an Unclaimed plinth
  for a place nobody holds, and a Your Standing pill at the foot of the board.
- **Enter confirms again** after a mouse click opened a dialog, Confirm Sales From Quality sells
  anything below a chosen quality in one click, and elixirs go on the action bar.
- **Graphics settings survive a reload**: an Advanced mix seeded from Low no longer returns with its
  view distance, water, bloom and anti-aliasing silently raised.

## Classes and abilities

- **Cat Form has its own cat.** The druid's feral form is now Cat Form in name and body, with an
  authored quadruped replacing the tinted wolf it shared with the world wolves.
- **Cat Form mobility.** Cat Form moves 15% faster on its own, Fleet Form breaks breakable roots and
  slows on cast as a baseline (30 mana, no cooldown), and Dash is learned at 12 instead of 18.
- **Wildfang kit pass 2.** Loping Stride is baseline on every form shift (60% for 3 sec, once per 20
  sec) and row 5 becomes Longstride (5 sec, 12 sec cooldown). Pin gives a 3 sec window after Bruin
  Rush in which Cat Form is free and pins the target (50% slow for 4 sec). Stalk moves at full
  speed, Lunge is the out-of-stealth Slinkstrike, and Hamstring Bite stuns for 0.5 sec plus 0.5 sec
  per combo point.
- **Chronomancer rework.** Excess healing from Temporal Echo becomes a Temporal Aegis absorb capped
  at 20% of maximum health, Temporal Cascade reaches 5 targets, and Aether Darts deal 20% more
  damage under Perfect Moment. Chronomancy buffs also finally appear on the aura tracks.
- **Warlock.** Possess the Evil Eye and Hour of Judgment no longer need an enemy carrying the
  primary Evil Eye, so opening with Needle of Fate or switching to an add stops refusing the cast.
- **A cast you cannot make is refused, not eaten.** Pressing a cast-time or channelled spell while
  already holding movement is denied with a toast instead of arming the global cooldown for nothing.
- **Rogue poisons** stop reapplying after a duel-winning hit, refreshes are credited to the right
  rogue in parses, and Festering Venom tooltips stop rounding Knifework's per-stack damage away.
- **Hexcraft's spec card** lists four abilities the spec can actually cast, and Cat Form druids sort
  with the damage dealers in role-sorted raid frames instead of with the tanks.

## Raids and dungeons

- **Nythraxis's Bone Storm.** The storm no longer casts a Bone Spike 6 seconds in: its counter
  ("leave 9 yards and spread") and the spike's ("stand still while others free you") contradicted
  each other. The first landed Bone Slam now deals 23% of maximum health on Normal and 37% on
  Heroic; every later slam keeps its 35% and 55%.
- **Dread Curse cannot be faked away.** The boss refuses to settle back onto a raider still carrying
  a live stack while the raider who took it over is clean, so a decoy taunt no longer works.
- **The Dungeon Finder knows two more pieces of content**: the Crucible of the Last Spring raid
  (Ignivar, then Varkhul), 10-player Normal and Heroic on a weekly lockout, and The Wildheart Basin,
  a level-cap five-man on Normal and Heroic.
- **Heroic loot previews stop lying**: a chance-only heroic row, such as Heroic Nythraxis's mount
  reins, is no longer headed "one of these always drops".
- **Your pet stops body-pulling bosses** while every deliberate order still engages, and Ignivar and
  Varkhul pick the highest-threat living player when aggro falls through.
- **Line of sight is clear on clear ground**: invisible floor clutter on rift and delve floors
  blocks walking only now, and a raised rift sanctum deck spans the room instead of leaving a gap.

## World and quests

- **Eastbrook's first-quest handoff.** Marshal Redbrook now stands beside the noticeboard rather
  than a fifty-yard walk inland, with Apothecary Lin, Trader Wilkes, Fisherman Brandt and Foreman
  Odell on their own stands around the civic square. Every crossing by a character who has not
  finished Wolves at the Door offers optional golden guidance in the ferry dialog: a glow on the
  giver and a trail to the objective and back. It defaults to on and can be turned off.
- **Profession trainers carry a Profession Trainer subtitle**, and profession onboarding quests no
  longer paint exclamation marks on nameplates, the minimap or the map.
- **NPC nameplates say what an NPC does**: Armor Vendor, Weapon Vendor, Potion Vendor, General
  Goods, Stable Master, Auctioneer, Banker, PvP Vendor, Quartermaster, Rift Forgemaster, and more.
- **Four sunken quest pickups are back on dry land.** The first Sunken Toll-Chest sat in the centre
  of a Bridgemere moat pool, invisible and unclickable, which stuck Toll and Tangle at 2 of 3.
- **The Last Keep churchyard works**: a real graveyard with its own spirit healer 41 yards from the
  door, instead of a walk back from the Wyrmwatch cairns nearly 300 yards away.

## Professions and crafting

- **Farming tools.** Upgrading a hoe no longer bricks farming: an unearned land tool degrades to the
  best tier your skill allows instead of vanishing from the bag scan, which covers picks, axes and
  sickles too. Hoes align to the crop bands they actually unlock, and planting is instant.
- **Harvesting a body works from the interact key** for a Field Kit carrier, instead of answering
  "Nothing to interact with" to keyboard, gamepad and mobile players.
- **A fine-only reagent explains itself.** A recipe that wants Fine Vale Wheat while you hold plain
  Vale Wheat says so on the line, in the tooltip and to a screen reader.
- **The charm recipes are affordable again.** Gatherer's Cache and Artisan's Eye now cost 1 Chime
  Shard, 14 Chime Essence and 10 Chime Dust instead of 5, 4 and 6: one epic disenchant, not five.
- **Pin a recipe** (up to five per character) to an always-on Recipes tracker listing every
  reagent's carried and needed count, so you can see what is left to farm while you are out.
- **Gatherers get the profession explainer**, which used to fire for craft skills only.

## Items and economy

- **Health, rebuilt.** Every item of uncommon quality and above carries a free stamina baseline of a
  third of its primary-stat budget, so a caster piece gives the same health as the physical piece
  from the same place. Every class also gains 2 Stamina per level, cloth classes and priest 15 HP.
- **Market Sweep.** Buy a wanted quantity of one item across many sellers' listings in one command,
  cheapest per unit first, with a live quote before you commit.
- **Sales History on the $WOC Exchange.** A fourth tab listing every completed sale on the realm,
  most recent first, with item, seller, buyer, sold-at, sale price and sale type.
- **The Materials Vault packs one row per material.** On desktop, right-click a row for the
  exact-source withdraw picker, or a sourced bag stack for the deposit picker; the Sources button
  stays on touch, and quantity prompts step by bag stacks.
- **A held award waits five minutes** on the corpse instead of about a minute, so winning a roll
  with full bags no longer loses the item while you walk back.
- **Mail.** Mergeable signed potions stage as one parcel with a quantity stepper instead of burning
  a slot each. Letters age out on a read and unread model: 30 sim-days unread, 90 for an unread
  Exchange Broker notice, 3 after you read one. Real escrow is never swept.
- **Riftbound bands take ring enchants** at every rung, essenced or gemmed, and the enchant survives
  further upgrades, gem sockets and relogs.
- **An offhand weapon wears its Armory skin**, which unsticks every rogue, Fury warrior and
  Enhancement shaman whose only weapon of that type sits in the offhand.
- **Try a mount skin before you buy it**: a Machine Stable card opens a live preview of your own
  character seated on the mount, and the Cosmetics window gains Preview on every skin row.

## Accounts and social

- **The Book of Deeds and the Reliquary are account-wide.** Cards show Earned by and Found by with
  each earner's date, a title or border a deed rewards is wearable on every character, and the
  Reliquary's deeds, Curator rank bridges and Illumination are decided over the whole account.
- **The Who tab.** /who becomes a searchable, sortable table: search by name, zone or guild (capped
  at 200 rows, with the true match count), sort by any column, narrow by class chip, whisper on
  click. Only zone and status ship with it, never positions.
- **The guild signpost.** Guilds can tick a New player friendly box in the recruiting editor, boards
  carry a filter strip for it, and a green dot marks a guild with an officer online right now.
- **Guild gold movements are announced** to every online member the moment an officer deposits or
  withdraws, and **character select** now shows where each character is parked.

## Performance

Most of this work targets the machines that need it: integrated GPUs and four-core laptops.

- The HUD no longer re-styles all of itself on every frame, which cost 6.5 ms per frame (31% of the
  frame) on a four-core Intel HD 530 machine.
- Forest trunks are drawn from lighter meshes, the Willowfen's dressing is culled per cell, and
  gather node batches beyond the scenery reach stop drawing.
- The renderer stops walking every character rig for raid telegraphs outside an encounter, stops
  sampling terrain under every remote body each frame, and stops running readouts nobody is reading.
- The adaptive governor no longer mistakes a GPU-bound frame for a display capped at 30 Hz, so
  integrated-GPU players get the quality relief it exists to provide.
- The long freezes are gone: the shader record after world entry is spread across background units,
  and the Wildheart caldera no longer relinks every material drawn after a visit.

## Mobile and desktop

- **Desktop and native app fixes.** Four REST calls never reached the server from the desktop shell,
  so the Arena and Battleground all-time ladders were blank. The same fix covers Android and iOS.
- **The class engine indicators drag with one finger again on touch**, and a spot parked before they
  joined the Unlock Interface registry comes back.
- **Crafting reagent text is legible on a phone**, and long-press tooltips survive finger jitter on
  iOS instead of being cancelled before the tooltip appears.

## Fixes

- Teleports are instant on screen: leaving a dungeon, hearthing, releasing to a graveyard or
  pressing Delve could draw your character flying across the map instead of arriving. Vaulting
  Charge also arcs visibly through the air again.
- Buff visuals that attach to your body (absorb shells, the Ascension crown, the mage barrier,
  Avenging Wrath wings, Ice Block) ride with you while mounted instead of wrapping the horse.
- Veilbound March's Ascension pull no longer drags the Highwatch practice dummies off their marks,
  and a player whose position goes non-finite holds their last valid pose instead of freezing.

## Compatibility and upgrade notes

- **Your frames are locked by default this patch**; Unlock Interface is the first row of the Esc
  menu. A frame you had dragged to a custom width also comes back narrower until you drag it again.
- **The Book of Deeds and the Reliquary become account-wide on first login**, so you will see deeds
  and relics earned by your other characters, each card naming who earned it and when.
- **Your health changes** as soon as you log in, from the item stamina baseline and the new class
  health table; casters gain the most.
- **Action bars start remembering specs**: a single saved layout seeds the active spec on first
  load. A Materials Vault with bag-capped rows folds to one row per material, totals unchanged.
- **Mail clocks change at once.** Letters stored under the old flat 14-day window are re-read at
  boot, and a countdown is only ever shortened. The welcome letter and Marshal Redbrook's wolves
  quest letter carry pocket change, so both now age out unread after 30 days.
- **Pure gatherers get one popup**: a character already at the first profession tier through
  gathering alone receives the profession explainer once, retroactively, on next login.
- **Update your app.** The desktop, Android and iOS shells need this build for the Arena and
  Battleground ladders to load.

## Release plumbing

Version surfaces move to 0.43.0 (Android versionCode 58, iOS build 65). Every new English string
added this cycle is filled across all supported locales, and the player wiki seed is regenerated to
match.
