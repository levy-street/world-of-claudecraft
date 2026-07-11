---
name: attunement-quest-build
description: State of the in-progress 3-bot Nythraxis attunement-questline automation (attune mode)
metadata:
  type: project
---

The user asked for a 3-bot (ryze5/ryzemage mage, sham2/Shims enh shaman, pala1/Pontius ret paladin — NO dedicated healer) script to autonomously run the **Nythraxis attunement questline** and get attuned (quests 1-4 done → "Scourge's End" in hand). Quest 5 (`q_nythraxis_scourges_end`) is a 10-player raid kill — **out of scope/impossible for 3 bots**.

**The chain** (all accept/turn-in at Brother Aldric, `brother_aldric_highwatch`, world (-10,656)):
1. `q_nythraxis_restless_dead` — collect 10 `runed_bone_shard` from `boneclad_revenant` (open-world camps (-40,830) r28 / (-15,860) r20; 0.7 drop, per-player quest loot).
2. `q_nythraxis_graves` — interact 3 grave objects: `grave_sir_aldren`(138,838), `grave_high_priest_malric`(141,712), `grave_captain_voss`(-139,787).
3. `q_nythraxis_sealed_crypt` — INSTANCE `nythraxis_crypt` (door -152,610): interact 3 relics (`captains_crest`/`priests_sigil`/`royal_seal`), each summons a L20 elite rare, loot the keystone.
4. `q_nythraxis_bound_guardian` — carry `crypt_keystone` to ritual circle `crypt_ritual_circle`(68,800), interact, kill `bound_guardian` (boss + adds + enrage, suggestedPlayers 5), loot `kings_signet`.

**What's built** (`scripts/multibox.attune.json` + `combat.attune` mode in `scripts/multibox_brain.mjs`, function `attuneTick` and helpers near the top of the file, gated by `if (T.attune) { attuneTick(ctx, T); return; }`):
- The chain state machine: reads `qlog`(state active/ready)+`qdone`, accepts/turns-in at Aldric via `{cmd:'interact'}`, advances the chain, declares ATTUNED after quest 4, logs accept/complete to party.md.
- Quest 1 fully: grind with **mob-name filter** (only Boneclad Revenants), party-wide **focus-fire** (`attuneFight`), **off-heal** (paladin holy_light / shaman healing_wave via `tryHeal`, emergency thresholds healLow 0.5), **death recovery** (`{cmd:'release'}` → respawn alive at graveyard, full HP). VERIFIED: they accept q1, kill revenants, survive, loot shards.

**Open issues / TODO to finish:**
- **Shard distribution bug:** only the mage reliably loots shards; the two melee aren't accumulating their own 10 (suspect off-heal/target stickiness keeping pala+shaman off looting, or per-player loot not landing for them). Quest 1 not yet completing for all 3.
- Quests 2-4 are STUBBED (hold at Aldric with "automation pending"). Need: ground-object interaction (target object by `tid` in `b.ents`, then `{cmd:'interact'}`), quest-driven instance entry (`{cmd:'enter_dungeon', dungeon:'nythraxis_crypt'}` at the door, relic→elite→loot loop, `leave_dungeon`), and the bound_guardian boss fight — all hard for a no-healer trio.
- Run: `node scripts/multibox.mjs scripts/multibox.attune.json` (tokens for pala1/sham2/ryze5 in multibox.tokens.json). See [[gravewyrm-farm]] for the farm this borrows infra from.
