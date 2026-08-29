# The Proving Shore: candidate zone themes

Three candidate cues for the tutorial island (PR 3467, The Proving Shore), composed in the
project's procedural score (`src/game/music_themes_proving_shore.ts`), rendered through the
authoring chain (`scripts/render_music.mjs`), and mastered to the catalog standard the shipped
remasters use (single seamless loop, about -15.5 LUFS integrated, 48 kHz stereo, 192 kbps mp3).

All three state the same five-note leitmotif, "the Proving call" (scale degrees 1, 5, 6, 5, 3:
a rising fifth for the adventure ahead, a lift to the sixth for hope, a settle on the third for
safety), so the island keeps one musical identity whichever candidate ships. They differ in
form, tempo, and temperament:

| File | Title | Feel |
|---|---|---|
| `proving-shore-a-first-light-at-dawnrest.mp3` | First Light at Dawnrest | D major, 76 bpm, A B A' coda. Harp tide, flute call, horn promise across the strait, ferry-bell tolls at every turn of the form. The wired default. |
| `proving-shore-b-the-gauntlet-at-sunrise.mp3` | The Gauntlet at Sunrise | G major, 100 bpm march. Bugle reveille, lute strum and oom-pah bass, woodblock drill cadence, an E minor drillmaster's eight with brass-stab strikes. |
| `proving-shore-c-across-the-morning-water.mp3` | Across the Morning Water | D major, 63 bpm in a 12/8 lilt. Piano barcarolle, string swells, choir mid-crossing, the island bell answered by the vale strand's twin. |

Candidate A ships as the live zone cue (`public/audio/music/proving_shore.mp3`, routed by
`ZONE_STREAM_URLS` in `src/game/music_tracks.ts`). To ship B or C instead: copy its file over
`public/audio/music/proving_shore.mp3`, recompute the URL hash
(`node scripts/render_music.mjs --hash public/audio/music/proving_shore.mp3`), paste it into the
`proving_shore` entry of `ZONE_STREAM_URLS`, and (for the in-editor synth path) point the
`proving_shore` key in `buildMusicThemes()` at the matching compose function. The note data for
all three stays registered in `buildMusicThemes()` (keys `proving_shore`, `proving_shore_b`,
`proving_shore_c`), so the music editor and the offline render pipeline can audition and evolve
every candidate.
