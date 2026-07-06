# Mirror World — Asset Brief

Scope: every character, building, and ambience model used by the Mirror World
zone (`src/sim/content/mirror_world.ts`), with its current placeholder and what
a bespoke replacement needs. Engine expectations: glTF **.glb**, one skinned
mesh, animation clips named per the sets below (the manifest maps clip names in
`src/render/characters/manifest.ts`). Style bible: dark, misty, surreal,
moonlit glass — silhouettes must read at night under `#141220` fog.

**Animation sets**
- **BIPED**: `Idle, Walk, Run, Punch (or Weapon), HitReact, Death`
- **FLOATER**: `Flying_Idle, Fast_Flying, Punch, Headbutt, HitReact, Death`
- **QUADRUPED**: `Idle, Walk, Gallop/Run, Attack_*, HitReact(s), Death`
- Extra one-shots welcome (bows, roars) — the engine can trigger any named clip.

---

## A. Belt mobs (combat, seen constantly — high priority)

1. **Poverty Ghost** — `poverty_ghost` · lvl 15 · drops White Sheets
   - Now: `creatures/ghost.glb` (pale tint). Want: ragged bedsheet spirit,
     hollow eyes, frayed hem trailing mist. FLOATER set. Height ~1.5 u.
2. **Spirit Unicorn** — `spirit_unicorn` · lvl 15–16 · drops Spirit Horns
   - Now: `creatures/stag.glb` (pale blue). Want: true unicorn, translucent
     mane, glowing horn (emissive tip). QUADRUPED set. Height ~2.0 u.
3. **Reaper** — `hooded_reaper` · lvl 15–16 · drops Black Hoods
   - Now: `chars/enemies/necromancer.glb` (black). Want: classic black-hooded
     reaper, face in shadow, optional scythe. BIPED set. Height ~2.3 u.
4. **Mistshade Lurker** — `mistshade_lurker` · lvl 16–17
   - Now: ghost.glb dark (SHARED — needs its own body). Want: crouched smoke
     shade, long claws, semi-transparent. FLOATER set. Height ~1.7 u.
5. **Gloomhulk** — `gloomhulk` · lvl 16–17
   - Now: `creatures/yeti.glb` dark. Want: hunched brute of packed shadow and
     glass shards. BIPED set (slow heavy swings). Height ~2.6 u.
6. **Mirrorbound Sentry** — `mirrorbound_sentry` · lvl 15–16
   - Now: `chars/enemies/skeleton_warrior.glb`. Want: armored husk with
     mirror-glass armor plates (reflective material). BIPED set. ~2.1 u.
7. **Palefang Stalker** — `palefang_stalker` · lvl 15
   - Now: `creatures/fox.glb` shadow. Want: gaunt spectral hound, pale fangs,
     wisping tail. QUADRUPED set, fast run cycle. Height ~1.0 u.

## B. Rare & boss

8. **The Gloaming Maw** — `gloaming_maw` · rare elite lvl 18
   - Now: demon-rig fallback (needs own body). Want: a mouth-forward horror —
     void predator, all jaw. QUADRUPED or FLOATER. Height ~2.4 u, scale 1.45.
9. **Gargoyle Statue / Awakened Sentinel** — `gargoyle_sentinel_*`,
   `dread_sentinel_*` (statues) + `gargoyle_awakened` (lvl 99 boss)
   - Now: `creatures/dragonevolved.glb` stone-gray at **7.5 u**, frozen pose.
   - Want: ONE model serving both states — winged gargoyle crouched on an
     integrated plinth. Statue = frame-0 pose (engine freezes it). Boss = full
     FLOATER/BIPED set **plus a `Wake` one-shot** (stone cracking, wings
     unfurling) and a `Yes`-style head-nod for the bow response. This is the
     zone's signature asset — six statues + the boss reuse it.

## C. NPCs (town cast — each needs a unique body)

10. **Nerissa the Unresting** — `keeper_nerissa` · ghost-keeper
    - Want: translucent ghost of a town warden (feminine, keys at belt,
      faint rim-glow). BIPED idle/talk. ~1.9 u. (Placeholder: ghost.glb.)
11. **Veilwright Ollo** — `veilwright_ollo` · shroud-market vendor
    - Current hooded necromancer look is approved — bespoke version optional:
      merchant of dead men's coats, bottles of sighs on his rack. ~2.3 u.
12. **Morwen the Mistwitch** — `mistwitch_morwen` · Deepdream brewer
    - Want: genuinely scary — gaunt translucent hag, near-black shroud, ember
      eyes, kettle-side idle stir animation. BIPED set + `Spellcast`. ~2.3 u.

## D. Player-derived (no asset needed)

13. **The Echo + its mirrored pet** — wears the player's own class model and
    pet template. Optional nice-to-have: a ghost/desaturation shader pass.

## E. Buildings & structures (procedural kit today — bespoke welcome)

14. Mirrorgate Plaza inn + house; three Veiled Market houses + two stalls;
    lift-gardens house; Mistfen-edge house — dark timber, silvered shingles.
15. **The Silent Archive** — chapel; wants a glass-and-bone gothic archive.
16. **The Lumen Well** — dome centerpiece; glowing wellspring.
17. **Standing mirrors** (travel portals) — silver frame on plinth; states:
    lit shimmer / dead-dark (toll-locked). Six around the belt + entrance.
18. **The Sable Mirror** — colossal sealed dungeon gate (~10 u) at the
    causeway's end; obsidian glass, gothic frame.
19. **The dread causeway** — raised stone ribbon; wants railing/arch props,
    broken gothic lamps.

## F. Ambience

20. **Glass dome shell** — silver translucent (procedural; shader polish welcome).
21. **Spirit orbs** — drifting glow-wisps outside the glass (procedural).
22. **Soul-wisp road lights** (incoming) — small hovering flame-wisps along roads.
23. Mirror-biome flora: lavender-tinted trees/rocks; broken-mirror shard
    ground props that glint (new prop request).
24. **Reflective dream disc** — the Deepdream arena floor (procedural mirror).

**Licensing requirement:** all assets must be original or CC0/CC-BY with
attribution recorded in `CREDITS.md` — no material derived from other games.
