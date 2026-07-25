# World of ClaudeCraft v0.28.0 Release Notes

**Release:** v0.28.0
**Date:** 2026-07-20
**Previous release:** v0.27.2

Version 0.28.0 completes the current Professions 2.0 progression loop and adds a broad set of
combat, interface, reliability, performance, and social improvements.

## Highlights

- Professions 2.0 now spans gathering materials and rare events, the professions wheel and
  crafting surfaces, masterwork items, guild onboarding, world stations and masters, recipe
  training, and complete recipe ladders.
- Artisan Row and profession stations have dedicated world props, map markers, and interaction
  feedback.
- The HUD regains a third action bar and adds landscape layouts for the Spellbook and Social
  windows.
- Player hover tooltips, class-colored chat names, verified-streamer badges, and clearer ready
  checks improve group awareness.
- Reconnect progress, retry timing, slow-connection guidance, and transient asset-load retries
  make interrupted or slow sessions easier to recover.

## Professions 2.0

- Gathering nodes now yield real profession materials, including pristine veins and rare gather
  events with deterministic simulation and online coverage (#2123, #2140).
- The professions wheel and crafting window expose profession identity, recipe requirements,
  masterwork results, maker attribution, and celebration feedback (#2145, #2148, #2150, #2151).
- New guild onboarding introduces the Professions Guild through an in-world letter (#2158,
  #2160).
- Profession stations and masters are present in the world, including mobile-station behavior,
  map markers, and station-specific interaction rules (#2162, #2166).
- Trainers teach recipes through tier requirements, with grandfathering for characters that
  already know eligible recipes (#2171, #2173).
- Recipe ladders, component materials, consumables, bags, and the supporting economy complete
  the current crafting progression pass (#2178, #2182).

## Classes, combat, and encounters

- Restored specialization power floors across the class roster so passive spec identity remains
  meaningful after the Talents 2.0 transition (#2163).
- Reduced stacked Frost Mage proc multipliers and adjusted barriers, Icebind, and Frozen Orb
  behavior (#2115, #2154).
- Battle Rhythm is now a resource effect without an additional damage multiplier (#2117).
- Scripted encounter control can no longer be broken by normal crowd-control removal, preserving
  Nythraxis transition behavior (#2113).
- Frost Nova break handling, aura classification, casting lifecycle, resurrection offers, and
  several combat-effect dispatch paths received regression coverage.

## Interface and social

- A third action bar is available on desktop and through the expanded mobile action pages
  (#2155).
- Spellbook and Social windows use wider landscape layouts with mobile-specific handling (#2102,
  #2099).
- Hovering another player now shows a player tooltip with identity and character details (#2186).
- Chat displays class-colored player names and a verified-streamer badge where applicable
  (#2153).
- Spirit-healer revival and Delve Mark purchases require confirmation before an irreversible or
  costly action (#2181).
- Ready-check summaries identify the members who have not responded or are not ready (#2183).
- World Market rarity filtering now includes Legendary items (#2109).

## Reliability and performance

- Ambient audio and nameplate updates avoid repeated work, reducing client-side hot-path writes
  (#2143).
- The simulation reclaims empty spatial-grid cells and uses spatial queries for nearby
  mob-mechanic allies (#2122, #2179).
- Boot-time glTF, HDR, and texture loads retry transient failures (#2095).
- Firefox camera rotation recovers after a forced pointer-lock release (#2131).
- Reconnect overlays show attempt counts and retry timing, while slow world entry presents a
  connection hint (#2106).
- Test worker limits and timeout handling reduce false failures on loaded runners (#2120).

## Rendering and audio

- Artisan Row and profession stations have dedicated decorative models and placement rules
  (#2096, #2162).
- Previously unmapped weapons now use the correct held-model variants (#2180).
- Card Duel has dedicated shuffle, reveal, play, round, and result sound effects (#2149).
- Training Dummies keep the critical-hit cue without using normal creature hurt barks (#2135).

## Discord integration

- The Discord bot repairs compounded level suffixes in synchronized nicknames (#2111).

## Compatibility and upgrade notes

- The retired `deedCount` snapshot field has been removed after its compatibility period
  (#2118). Clients that still depend on that field must update before connecting to a v0.28.0
  server.
- Android and iOS build numbers advance with the v0.28.0 version surfaces.
- Desktop download links now target v0.28.0 artifacts. Publish matching macOS, Windows, and Linux
  files before announcing the desktop release.

## Verification

- The release branch includes focused unit, integration, parity, browser, and mobile-layout
  coverage for the systems above.
- The full release gate, release locale fill, version check, and malware audit are required to
  pass before merge.
