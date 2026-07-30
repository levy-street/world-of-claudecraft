# New-environment soundtrack (v0.24 world grid + rifts)

Nineteen through-composed cues covering every environment the world-grid and
procedural-rift work added, all synthesized in-engine by `src/game/music.ts`
(no audio files ship; the game builds every note in WebAudio at runtime).

## The cues

Overworld zones (played by `musicZoneForLocation` via the zone's biome, or the
`farshore_isle` zone override):

| Theme | Zone | Title and register |
|---|---|---|
| `farshore` | Farshore Isle | "The Bell of Gullhaven": A minor vigil; harp surf, oboe lament, the warning bell tolling one, two, three across the form |
| `dusk` | Veiled Hollow | "Under the Eldergleam": F lydian hymn; wisp-glimmer dulcimer, corrupted D minor middle for the Sunken Court |
| `ember` | Drakelands | "Ash and Wingbeat": E phrygian dominant gallop; snake-charmer reed, wide horn call over the caldera |
| `frost` | Frostveil Reach | "The Aurora Steps": G lydian hush; piano snowflakes, aurora bells, one heartbeat drum in the reprise |
| `amber` | The Amberfall | "The Leaves That Stay": F major 12/8 harvest pastoral with a relative-minor catch |
| `fen` | The Willowfen | "Dragonfly Morning": E major 12/8 idyll; barcarolle lute, whistled pipe tune, shaker wings |
| `night` | The Nightbloom | "The Realm Is Dreaming": B aeolian nocturne; constellation bells, D major Moonwell lift |
| `haunt` | The Wraithwood | "Do Not Answer": F# phrygian dread; half-step creep, knocks, the hymn that keeps breaking off |
| `jungle` | The Palmreach | "The Emerald Tangle": G mixolydian groove; three-hand percussion, marimba-style dulcimer, bird flourishes |
| `garden` | The Evergarden | "Still Trimmed": A major minuet gone uncanny; F# minor Great Maze middle with shear-snip percussion |
| `gale` | The Galecrest | "The Beacon Never Dies": D mixolydian sea-ballad over an unstopping open-fifth gale |

Rift crawls (played per floor by `riftMusicZoneForTheme` from the floor's
`RiftTheme`):

| Theme | Archetype | Title and register |
|---|---|---|
| `rift_frost` | Frostbound | "Hoarfrost Vault": everything arrives slightly late, like the slow aura |
| `rift_ember` | Emberforge | "The Anvil Below": anvil wood block on a smith's count, bellows drums |
| `rift_venom` | Venomweald | "Broodhollow": skittering staccato legs, chromatic venom drips |
| `rift_bone` | Boneyard | "Ossuary Waltz": a dry dance with bone-click castanets, harmonic-minor grin |
| `rift_brute` | Warcamp | "Skulls for the Warlord": the whole floor is a drum line |
| `rift_void` | Voidscar | "The Unlit Door": an unresolved flat-two drone, a question never answered |
| `rift_storm` | Stormspire | "Spirefall": driving eighths, thunder answering a bar late |
| `rift_tide` | Sunken | "Pressure of the Deep": the lowest drone in the score, sonar bells |

## Listening renders

`docs/music/renders/*.mp3` (gitignored, generated locally) are true-to-game
renders: the exact synth voices and mix chain, loudness-normalized for
listening outside the game. Regenerate with:

```
node scripts/render_music.mjs tmp/music_renders <theme...>
ffmpeg -i tmp/music_renders/<theme>.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 \
  -codec:a libmp3lame -q:a 2 docs/music/renders/<theme>.mp3
```

## Loudness trims

`THEME_TRIM` values are measured, not guessed: render every theme at trim 1,
then `node scripts/music_gated_rms.mjs tmp/music_renders` computes gated
windowed RMS (400ms windows, -15dB gate) against the `town_eastbrook`
reference and prints the trim per theme.
