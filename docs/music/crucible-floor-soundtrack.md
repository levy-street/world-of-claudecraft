# Crucible floor soundtrack

The raid streams the final owner-provided Suno exports below. The MP3 bytes are
preserved; only their filenames are cleaned for shipping. These productions are
independent of the earlier in-game procedural raid suite.

| Floor | Dungeon ID | Track | Shipped asset |
|---|---|---|---|
| 1 | `ignivar_forge_approach` | A Way Through the Embers | `a_way_through_the_embers.mp3` |
| 2 - first boss | `ignivar_raid_arena` | Even Iron Must Yield | `even_iron_must_yield.mp3` |
| 3 | `ignivar_molten_assembly` | A Fate Still Unwritten | `a_fate_still_unwritten.mp3` |
| 4 - second boss | `ignivar_inner_crucible` | The Future Is Not Yours to Keep | `the_future_is_not_yours_to_keep.mp3` |

The entrance lift shares floor one. Room identity comes from the actual dungeon
ID, including private instances, rather than dungeon index order or shared
interior artwork.

## Playback

`src/game/crucible_music.ts` owns the file catalog and dungeon-to-floor mapping.
`InstanceMusicController` passes the floor to `MusicDirector`; the dedicated
stream replaces both the previous zone cue and generic combat music. Damage,
aggro, and unrelated Nythraxis events cannot interrupt it. HUD combat state still
reflects the fight.

Each new floor starts at the beginning and loops its entire file, allowing a
boss cue to tell its complete musical story. Backtracking and reentry restart
the destination cue. Combat starting or ending on the same floor does not
restart it. Floor changes crossfade, and leaving the raid restores normal
location/combat playback.

Streams load on demand, reuse at most four raid audio elements, and share the
existing music volume, mute, menu pause, autoplay recovery, and WebAudio path.
The old procedural scores remain available to the authoring tools; the raid
runtime uses these final files.

## Source identity

Source downloads supplied on 2026-09-05. The numbered filenames identify the
final exports, whereas similarly named unnumbered files can be earlier demos.
Source downloads are preserved outside the repository.

| Source download | SHA-256 |
|---|---|
| `A Way Through the Embers (1).mp3` | `14a001b98e5bdba3df555c2576c9b369906022fa39e8002bde82f038ff826037` |
| `Even Iron Must Yield (3).mp3` | `ebd0f6c6b99d10c082deebb4f11427633f5a4e644a5c429feddc0501ddbd9623` |
| `A Fate Still Unwritten (1).mp3` | `78d0bc42726ae55fe0f8b55f072f44286a2963cd86db29a8399ded40e191b8b8` |
| `The Future Is Not Yours to Keep (1).mp3` | `a6e896149cb04b730f8859356694d9b4a200e96765b66d90da2a5866f210ccb7` |

URL cache keys use the first 12 hexadecimal characters of each file SHA-256.
The asset test verifies clean filenames, four distinct files, and matching
cache keys. Update the source record and cache key when replacing a production.
