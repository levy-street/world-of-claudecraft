# Map and Minimap Marker Art Style

Status: living visual and interaction contract
Applies to: the zone map, minimap, delve and rift schematics, and future map legends

## Goal

World of ClaudeCraft markers should feel like small pieces of dark-fantasy heraldry. They
must be beautiful at their 64px source size, but they are accepted only when their meaning
survives the actual map and minimap sizes on desktop and touch layouts.

The hierarchy is:

1. Silhouette identifies the family.
2. The central object identifies the place or activity.
3. A simple interior or edge motif identifies state.
4. A separate ring or pulse identifies tracking and focus.

Color supports those cues. Color never owns a gameplay distinction by itself.

## Visual language

- Use one centered, optically balanced subject on transparency.
- Fill most of the source square with one bold outer silhouette and keep a transparent
  perimeter for downsampling and the runtime keyline.
- Use two or three broad value groups, a near-black painted contour, restrained material
  texture, warm upper-left light, and cool lower-right shadow.
- Prefer tactile parchment, forged metal, stone, leather, timber, glass, cloth, and arcane
  light. The finish should feel hand-painted rather than flat-vector or photorealistic.
- The shared raster cache adds a crisp pale exterior keyline. Do not bake that keyline,
  selection rings, tracking pulses, labels, or terrain shadows into the 64px source.
- Avoid micro-writing, thin filigree, tiny tools, multiple examples, scenic backgrounds,
  medallion frames, bloom that eats the silhouette, and state-like diagonal highlights.

## Semantic families

Quest markers keep classic punctuation while giving every state its own silhouette:

| State | Required cues |
| --- | --- |
| Available | Gold parchment, dominant exclamation mark, ruby seal |
| Ready to turn in | Pale-gold parchment, dominant question mark, emerald completion tab |
| Repeatable | Blue broken return ribbon around a gold quest center |
| Cooldown | Full-opacity neutral parchment with a broken corner and time motif |
| Neutral NPC | Low-salience procedural hollow ring, never a gold quest painting |

Gathering markers preserve the resource identity in every state:

| Available | Tool locked | Required treatment |
| --- | --- | --- |
| Yes | No | Full-color resource, full alpha, warm keyline, map ready halo |
| Yes | Yes | Full-color resource with a bronze padlock, no ready halo |
| No | No | Smaller grayscale resource inside a broken neutral cooldown arc |
| No | Yes | Cooldown arc plus the independent bronze padlock |

Never use a diagonal strike for gathering availability or access. It damages the object
silhouette and cannot explain whether the resource is depleted, tool-locked, or disabled.

Navigation transitions use distinct silhouettes for entrance, descent, return, and surface
exit. Rewards use chest or reliquary silhouettes whose available, opened, locked, and jammed
states remain different without hue. Dungeon, delve, and rift objects must never silently
fall through to a generic loot sparkle.

Dynamic combat and social markers remain procedural. Shape carries the primary distinction:
friend circle versus guild diamond, calm enemy circle versus aggro diamond, loose-loot
sparkle versus corpse-loot hollow square, and a visible dead cue on party markers.

## Scale and responsive profiles

The source asset is a 64px sRGB WebP with alpha. The one HUD-owned marker cache decodes it
once and pre-rasterizes only the exact sizes used by the painters.

Two fixed profiles are permitted:

- Standard is restrained for desktop and ordinary touch portrait layouts.
- Compact uses larger backing-space rasters for touch landscape and compact HUD layouts,
  whose CSS scales the map surfaces down much further.

The active profile is selected once per redraw from managed body classes. Never read layout
geometry, computed style, or viewport state inside a marker loop. Never resize, filter,
desaturate, add a shadow, rasterize text, or allocate a canvas per marker.

Painted state variants, including cooldown arcs, grayscale resources, lock badges, rank
badges, and Bountiful treatments, are derived once in the bounded cache. The normal hot path
is one exact-size lookup and one whole-pixel `drawImage` call per painted marker.

## Layering and placement

The default information stack is:

1. Terrain and noninteractive cartography.
2. Static resources, crafting stations, and civic services.
3. Ordinary live entities and loose loot.
4. Rewards.
5. Navigation transitions and tracked destinations.
6. Corpses and party markers.
7. Quest markers.
8. The local player.

Stable landmark badges may be displaced through the shared deterministic collision allocator.
Gathering nodes and live entities stay on their true coordinates. A marker outside the visible
map rectangle is omitted rather than clamped into a false edge location. Tooltip hit testing
uses the same painted locations and resolves the globally nearest point marker, with explicit
paint-order ties.

## Accessibility and interaction

- Every state must remain identifiable in grayscale.
- Every actionable icon gets a dark inner contour and pale exterior separation cue so it
  survives both forest and sand terrain.
- Mouse hit areas may stay precise. Touch hit areas use a physical-size floor converted back
  into canvas coordinates, independent of the visual raster size.
- Map and minimap use the same semantic identity and state. Responsive sizing may change, but
  meaning must not.
- Tracking is redundant: retain the base icon while adding a ring, route, pulse, compass, or
  other focus cue. Do not replace the base identity with the tracking cue.

## Review gates

An icon family is not accepted from a source-size preview alone. Review must include:

- exact-size rasters over representative dark and light game terrain;
- standard desktop, standard touch, and compact touch landscape rendering;
- every state and every family identity on both map surfaces where it appears;
- collision scenes with quest NPCs, enemies, party members, services, and dense resources;
- grayscale and perimeter checks, unique shipping hashes, byte budgets, and provenance;
- one-image decode, bounded canvas count, repeat-preload stability, and no redraw allocation;
- graphics-tier parity and fail-soft procedural fallbacks.

## External design evidence

The contract is informed by current first-party MMORPG practice, then adapted to World of
ClaudeCraft rather than copied literally:

- Blizzard distinguishes repeatable, in-progress, and turn-in quest states and uses zoom
  disclosure for quest hubs in [World of Warcraft UI and Quest Updates](https://news.blizzard.com/en-us/article/24117139/user-interface-and-quest-updates-in-the-war-withintm).
- Blizzard treats distinct minimap identities, cross-surface icon consistency, missing dungeon
  exits, and overlap fixes as product issues in the [Diablo IV 3.0 notes](https://news.blizzard.com/en-us/article/24271857/diablo-iv-patch-notes-3-0) and [Diablo IV 1.3 to 1.5 notes](https://news.blizzard.com/en-us/article/24140806/diablo-iv-patch-notes-1-3-1-5).
- Jagex uses a selectable map key that flashes matching icons and explicit dungeon links in
  [Old School RuneScape world map changes](https://secure.runescape.com/m=news/world-map--balancing-changes?oldschool=1).
- Jagex emphasizes polished icons, stronger visibility, easier navigation, and less visual
  noise in [A New Era for RuneScape](https://secure.runescape.com/m=news/a-new-era-for-runescape-begins-january-19-2026).

No reviewed first-party source prescribes a canonical depleted gathering-node marker. The
grayscale resource with a broken cooldown arc is a World of ClaudeCraft design inference,
selected through actual-size comparison rather than copied from another game.
