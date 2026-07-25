# Eastbrook Vale rebuild: img2threejs intake

This is the pre-code reconstruction contract for the nine new Eastbrook town GLBs. It follows
the installed `img2threejs` 1.3.0 sequence: admit references, assess complexity, classify
topology, lock a strict sculpt specification, build one pass at a time, and approve only from
rendered comparisons.

The intended use is a set of static, real-time browser landmarks. They are stylized procedural
reconstructions, not exact mesh extraction. The accepted sheets provide several views, but they
are AI-generated visual targets and can contain small cross-panel inconsistencies. Hidden
geometry remains an authored inference. No source image establishes manufacturing dimensions or
exact PBR values.

## Reference admission

Admission combines visual inspection with the technical dimensions recorded in
`imagegen-provenance.md`. The master is a scene and therefore cannot be used as a geometry
extractor. It is admitted only for composition, palette, hierarchy, and gameplay-scale intent.

| Reference | Admission | Permitted evidence | Limits and routing |
|---|---|---|---|
| `concepts/master-concept.png` | Conditional | Town composition, cobalt-roof palette, circular wall rhythm, relative service hierarchy, open civic center | Full scene, perspective view, occlusion, and no exact dimensions. Never score a standalone model against its pixel alignment. |
| `turnarounds/bank.png` | Pass | Front, rear, sides, three-quarter silhouette, entrance, teller opening, side canopy, banner, vault cue | Small accessory placement varies between panels. Use the component contract below. |
| `turnarounds/smithy.png` | Pass | Main gable, open forge bay, chimney, anvil, tool and log racks | Fire brightness and loose props are look-development evidence, not geometry dimensions. |
| `turnarounds/inn.png` | Pass | Two-story mass, deep front portico, dormer, side hood and provision table | Side service clutter varies slightly. Preserve the dominant mass and service cue. |
| `turnarounds/chapel.png` | Pass | Pointed front entry, lancet-window rhythm, buttresses, flower boxes, roof crystal | Rear door and flower-box distribution are supporting details, not silhouette anchors. |
| `turnarounds/weaving-workshop.png` | Pass | Low workshop mass, open loom bay, rolls, dye barrel, front and rear elevations | The runtime loom station owns the service anchor. Avoid a coincident duplicate. |
| `turnarounds/toolworks.png` | Pass | Low workshop, covered tool display, workbench, crate and barrel rhythm | Individual hand tools are approximate, not branding or exact product shapes. |
| `turnarounds/civic-well-beacon.png` | Pass | Masonry well, water basin, central crystal, radial seating cues, player scale | Bench spacing varies by panel. Benches are layout context rendered from the existing bench asset, not part of this GLB. Shipping uses three cardinal benches, leaves the east arrival lane open, and keeps well collision at radius `1.5`. |
| `turnarounds/market-stall-fence.png` | Conditional | Market stall front, side, rear, canopy, counter goods; fence style only | The sheet contains two target families. This program outputs only `market_stall`; the small fence is style evidence because old town fences are removed. |
| `turnarounds/wall-wing.png` | Pass | One complete wall wing, masonry courses, end pillars, rail caps, watch lantern, banded leaf; shallow curvature only at assembled-ring scale | The serialized module is a straight bounded chord. Layout chains chord placements into the ring and preserves each symmetric five-yard opening. |

All reference paths in this table are below
`docs/screenshots/eastbrook-vale-rebuild/`. Reference admission is rejected if a future file is
empty, undecodable, hash-mismatched, cropped below a complete silhouette, or replaced with an
unreviewed image.

## Object and complexity assessment

Axes are scored from `0` to `3`: silhouette (`S`), visible component count (`C`), hierarchy
depth (`H`), repetition (`R`), material layers (`M`), local detail (`D`), occlusion risk (`O`),
and action-readiness need (`A`). `Target details` is the minimum mapped detail inventory required
before strict validation.

| Asset | Form and structure | S | C | H | R | M | D | O | A | Total | Tier | Target details |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| Bank | Architectural, compound hard-surface building | 2 | 3 | 2 | 2 | 3 | 3 | 1 | 1 | 17 | Complex | 10 |
| Smithy | Architectural and mechanical service assembly | 3 | 3 | 3 | 2 | 3 | 3 | 1 | 2 | 20 | Complex | 10 |
| Inn | Architectural, layered two-story shell | 3 | 3 | 2 | 2 | 3 | 3 | 1 | 1 | 18 | Complex | 10 |
| Chapel | Architectural hall with repeated buttresses and windows | 2 | 2 | 2 | 2 | 3 | 2 | 1 | 1 | 15 | Moderate | 6 |
| Weaving workshop | Architectural workshop plus exposed craft assembly | 2 | 3 | 2 | 2 | 3 | 3 | 1 | 1 | 17 | Complex | 10 |
| Toolworks | Architectural workshop plus exposed tool assembly | 2 | 3 | 2 | 2 | 3 | 3 | 1 | 1 | 17 | Complex | 10 |
| Civic well beacon | Repeated masonry ring and radial furniture | 2 | 2 | 2 | 3 | 3 | 2 | 1 | 1 | 16 | Complex | 10 |
| Market stall | Open frame, conforming canopy, repeated goods | 2 | 2 | 2 | 3 | 3 | 3 | 1 | 1 | 17 | Complex | 10 |
| Wall wing | Modular architectural assembly with repeated courses and joins | 2 | 3 | 2 | 3 | 2 | 2 | 1 | 2 | 17 | Complex | 10 |

`objectClass.primaryDomain` is `object` for all nine outputs. None uses the character track.
Motion potential is `static prop`; the wall and service buildings still require stable sockets
and semantic metadata so layout and effects do not depend on anonymous mesh order.

## Shared strict sculpt contract

### Coordinate, bounds, and runtime hierarchy

- Root coordinates are `+Y` up, `+Z` front, `+X` right, in world yards.
- Every root is centered on `X/Z`, floor-seated at `minY = 0`, deterministic, and has no hidden
  global scale.
- Building visual bounds must fit their authored lot. Overhanging roof trim must not silently
  outgrow collision or camera-hide sampling.
- Each output exposes `root.userData.sculptRuntime` with stable asset ID, coordinate frame,
  native bounds, service cues, named socket map, `interactive: false`, no shipping collision
  mesh, and no breakable or detachable parts.
- Interaction, building collision, rest behavior, station proximity, and mailbox behavior remain
  simulation-authored. A GLB is not a click target and does not create gameplay authority.
- No skins and no animation clips. No imported light. Emissive windows, forge, lantern, and
  crystal surfaces remain decorative and encode no gameplay state.

### Shared palette and material systems

The master and turnarounds support a shared material language: charcoal-gray masonry, warm gray
plaster, dark brown timber, cobalt-blue roof courses, restrained iron and gold fittings, warm
amber windows, and sparse cyan crystal accents. These colors are visual evidence. Exact scalar
PBR recovery from the generated images is not claimed.

Each shipping GLB remains embedded-texture-free vertex color, merged into at most two primitives
and two materials: one opaque material and one emissive material. Runtime binds exactly one shared
external `512 x 512` Eastbrook detail atlas defined by
`scripts/assets/specs/eastbrook_town_surface_atlas.json` across all nine GLBs, the preserved Grand
Armoury, and the banker chest. It is never embedded in or duplicated across those assets. The
lossless WebP is a neutral RGB, high-key grayscale multiplier, while `COLOR_0` remains the palette
authority. Runtime generates semantic UVs only on cloned loader-owned geometry, and every graphics
preset consumes the same atlas through either the Standard or Lambert-compatible material path.
The full-color accepted atlas source is rights-reserved evidence only and must never be loaded as
the multiplicative runtime map. The material pass must still prove:

- stone, plaster, timber, roof, iron, and gold remain separable through geometry, value, bevel
  response, and vertex-color zones;
- roughness does not turn the whole asset into uniformly smooth plastic;
- cavity and contact darkening is localized rather than baked as indiscriminate noise;
- warm and cyan emissive regions stay legible on Low and Ultra without adding point lights;
- no albedo channel is aliased into a normal, roughness, or AO channel;
- the shared atlas adds only mid-frequency value and grain; it may not shift the semantic color
  zones or introduce a third GLB material;
- all runtime UVs stay within the selected `128 x 128` semantic cell so filtering cannot select a
  neighboring material family.

### Performance ceilings

These are pre-build ceilings, not targets to fill. Shipping tests replace estimates with parsed
artifact measurements.

| Asset class | Triangle ceiling | GLB byte ceiling | Primitive/material ceiling | Embedded textures | Skins/animations |
|---|---:|---:|---:|---:|---:|
| Six service buildings | `6,000` each | `350 KiB` each | `2 / 2` | `0` | `0 / 0` |
| Civic well, market stall, wall wing | `3,000` each | `180 KiB` each | `2 / 2` | `0` | `0 / 0` |

Every mesh keeps `COLOR_0`. The optimized GLB uses the repository asset pipeline and
`EXT_meshopt_compression`, with no Draco. Repeated wall geometry is instanced or shared at
runtime rather than baked as one unique town-sized mesh.

## Per-asset strict sculpt specifications

The component names below are semantic systems. Each listed detail must map to a component
`localFeature`, a material local override, or a runtime socket. A prose-only detail does not
satisfy the inventory.

### Bank

- **Bounds:** `X 7`, `Z 5.5`, `Y 7.8` yards. Output `eastbrook_bank.glb`.
- **Hierarchy:** root; foundation and main hall; front gabled portico; teller bay; right service
  canopy; roof system; facade system; service-cue system; sockets.
- **Topology:** hall, portico, steps, posts, and trim are `assembled-solid`; roof and awnings are
  `conforming-shell`; arched openings, masonry joints, muntins, and sign face are
  `surface-relief`; hanging banner is a shallow `conforming-shell`.
- **Silhouette lock:** broad main gable, lower front portico, asymmetric teller opening and right
  canopy, readable stepped entry. Do not turn it into a tower or a generic house.
- **Mapped details, minimum 10:** roof-course seams to `roof.localFeatures`; timber corner
  chamfers to `frame.localFeatures`; stone entry voussoirs to `entry.localFeatures`; step bevels
  to `steps.localFeatures`; window muntins to `windows.localFeatures`; warm glazing to
  `warmWindows.localOverrides`; gold post caps to `metal.localOverrides`; banner panel and rod to
  `banner.localFeatures`; teller ledge to `tellerBay.localFeatures`; foundation contact dirt to
  `stone.localOverrides`; plaster cracks to `plaster.localOverrides`; vault cue to
  `serviceCues`.
- **Sockets:** `Socket_FrontEntry` and `Socket_TellerWindow`. Keep the runtime banker and banker
  chest clear of any authored vault cue. A second coincident chest blocks acceptance.
- **Feature targets:** critical `bank-mass-and-gables`, `arched-entry`, `teller-window`,
  `service-canopy-and-vault-cue`; important `banner-and-gold-trim`, `warm-window-rhythm`.

### Smithy

- **Bounds:** `X 7`, `Z 5.5`, `Y 7.5` yards. Output `eastbrook_smithy.glb`.
- **Hierarchy:** root; cottage mass; roof and dormer; chimney; open forge lean-to; hearth; log
  storage; tool display; station sockets.
- **Topology:** cottage, chimney, hearth, anvil base, and racks are `assembled-solid`; roof and
  lean-to cover are `conforming-shell`; fire face and soot are `material-only`; tool silhouettes
  and masonry courses are `surface-relief` or small `assembled-solid` parts.
- **Silhouette lock:** tall offset chimney, compact gabled cottage, low open-sided forge bay, and
  a clearly recessed fire opening.
- **Mapped details, minimum 10:** chimney cap bevel; roof courses; dormer; arched entry stones;
  forge surround; fire emissive region; cavity soot; tool hooks; anvil horn; log rounds; barrel
  bands; foundation contact dirt, each mapped to its owning component or material.
- **Sockets:** `Socket_FrontEntry` and `Socket_Forge`. The gameplay forge cluster stays separately
  placed. Either the GLB anvil is omitted at that socket or layout proves the two anvils do not
  duplicate or intersect.
- **Feature targets:** critical `smithy-gabled-mass`, `open-forge-bay`, `chimney-system`,
  `forge-and-anvil-service-read`; important `tool-rack`, `log-and-barrel-dressing`.

### Inn

- **Bounds:** `X 7.5`, `Z 6`, `Y 8.5` yards. Output `eastbrook_inn.glb`.
- **Hierarchy:** root; stone lower floor; timber upper floor; steep roof; front portico; dormer;
  side hood; provision apron; sockets.
- **Topology:** wall masses, columns, doors, steps, and tables are `assembled-solid`; roof,
  portico, and hood are `conforming-shell`; half-timber pattern and masonry joints are
  `surface-relief`.
- **Silhouette lock:** tallest non-Armoury service roof, deep front awning, central dormer, and
  asymmetric side hood. Preserve two-story massing.
- **Mapped details, minimum 10:** roof courses; ridge and eave chamfers; dormer frame; portico
  posts and brackets; arched door; half-timber diagonals; stone course joints; warm window
  muntins; side chimney hood; provision sacks; barrel hoops; foundation wear.
- **Sockets:** `Socket_FrontEntry` and `Socket_Provisions`. The kitchens cluster may occupy the
  service apron; its campfire, crate, and barrel must not be baked twice at the same coordinates.
- **Feature targets:** critical `two-story-inn-mass`, `deep-front-portico`, `upper-dormer`,
  `side-hood-and-provision-apron`; important `half-timber-rhythm`, `warm-windows`.

### Chapel

- **Bounds:** `X 5.5`, `Z 6`, `Y 7` yards. Output `eastbrook_chapel.glb`.
- **Hierarchy:** root; nave mass; steep roof; front entry; buttress system; lancet-window system;
  flower boxes; crystal finial; sockets.
- **Topology:** nave, entry, buttresses, and steps are `assembled-solid`; roof is
  `conforming-shell`; lancet surrounds, shield, timber braces, and masonry seams are
  `surface-relief`; crystal is `continuous-sculpt` with faceted low-poly normals.
- **Silhouette lock:** compact steep gable, pointed central entry, repeated side buttresses, and
  one small roof crystal. Do not reuse the old bell-tower silhouette.
- **Mapped details, minimum 6:** pointed voussoirs; lancet muntins; buttress cap bevels; flower
  boxes; shield relief; roof seams; timber cross-bracing; crystal emissive local override;
  masonry contact dirt.
- **Sockets:** `Socket_FrontEntry` and `Socket_AltarAxis`.
- **Feature targets:** critical `chapel-gable-and-entry`, `lancet-window-rhythm`,
  `buttress-system`, `crystal-finial`; important `flower-boxes`, `shield-and-timber-trim`.

### Weaving workshop

- **Bounds:** `X 5.5`, `Z 4.5`, `Y 5.8` yards. Output
  `eastbrook_weaving_workshop.glb`.
- **Hierarchy:** root; low workshop shell; roof; open loom bay; fabric-roll system; dye barrel;
  doors and windows; sockets.
- **Topology:** shell, posts, steps, barrel, and roll rack are `assembled-solid`; roof and any
  hanging fabric are `conforming-shell`; threads are a restrained `fiber-strand` system; timber
  pattern and seams are `surface-relief`.
- **Silhouette lock:** long low roof with one visibly open craft bay. It must not read as a second
  generic house.
- **Mapped details, minimum 10:** roof course seams; gable braces; post chamfers; open-bay
  negative space; loom frame; warp threads; fabric roll spirals; roll color variation; barrel
  hoops; window muntins; foundation course; contact wear.
- **Sockets:** `Socket_FrontEntry` and `Socket_Loom`. Preserve the runtime station loom as the
  interaction anchor and prevent a coincident duplicate.
- **Feature targets:** critical `low-workshop-mass`, `open-loom-bay`, `loom-and-thread-read`,
  `fabric-roll-system`; important `dye-barrel`, `timber-and-window-rhythm`.

### Toolworks

- **Bounds:** `X 5.5`, `Z 4.5`, `Y 5.8` yards. Output `eastbrook_toolworks.glb`.
- **Hierarchy:** root; workshop shell; roof; covered display porch; tool rack; workbench; crate
  and barrel; sockets.
- **Topology:** shell, porch, bench, crate, and barrel are `assembled-solid`; roof and porch cover
  are `conforming-shell`; individual tool heads and wall rack are `surface-relief` with only
  silhouette-relevant tools promoted to geometry.
- **Silhouette lock:** broad low roof and open front display recess. Maintain the simpler,
  utilitarian read relative to the smithy.
- **Mapped details, minimum 10:** roof courses; post and sill chamfers; stone foundation blocks;
  display recess; tool rack; hammer, saw, tongs, and square silhouettes; bench edge wear; door
  bands; crate slats; barrel hoops; window muntins.
- **Sockets:** `Socket_FrontEntry` and `Socket_ToolDisplay`. The runtime workbench remains the
  station anchor and must not overlap a baked copy.
- **Feature targets:** critical `toolworks-low-mass`, `covered-display-recess`,
  `tool-silhouette-system`, `workbench-service-read`; important `crate-and-barrel`,
  `door-and-window-trim`.

### Civic well beacon

- **Bounds:** canonical world placement `(-0.75, 2)`, collision radius `1.5`, visual height no more
  than `3.5`. Target GLB visual is `3.2 x 3.2 x 3.1`, excluding the three separately placed
  benches. Output
  `eastbrook_civic_well_beacon.glb`.
- **Hierarchy:** root; lower masonry ring; upper block ring; water basin; beacon stem and gold
  collar; crystal; sockets.
- **Topology:** ring blocks, stem, and collar are repeated `assembled-solid`; water is
  `material-only`; the crystal is a faceted `continuous-sculpt`; stone joints are
  `surface-relief`.
- **Silhouette lock:** low circular well and one slender diamond crystal. The beacon cannot become
  a tall tower or obscure normal camera sightlines.
- **Mapped details, minimum 10:** twelve-block ring rhythm; alternating stone values; block
  bevels; cavity-dark joints; water inset; stem taper; gold collar; faceted cyan crystal; crystal
  base facets; ring top course; lower plinth; ground contact wear.
- **Sockets:** `Socket_CivicCenter` and `Socket_Beacon`. The layout owns three cosmetic bench
  instances outside this asset and outside the well collider.
- **Feature targets:** critical `masonry-well-ring`, `water-basin`, `crystal-beacon`; important
  `gold-collar`, `stone-value-variation`. The three-bench cardinal system and open east arrival
  quadrant are layout-level targets.

### Market stall

- **Bounds:** `X 2.8`, `Z 2.2`, target `Y 2.7` yards. Output `eastbrook_market_stall.glb`.
- **Hierarchy:** root; four-post frame; counter and shelves; three-panel canopy; goods system;
  crate and barrel; lantern and crystal accents; sockets.
- **Topology:** frame, counter, crate, barrel, and shelf are `assembled-solid`; canopy is a
  `conforming-shell`; sacks are `continuous-sculpt`; canopy stripes are `material-only` zones;
  small goods are an `instanced-cluster` or merged repeated system.
- **Silhouette lock:** open four-post booth, shallow pitched canopy, full-width counter, and clear
  vendor opening. The red, cream, and blue canopy order remains readable from the civic center.
- **Mapped details, minimum 10:** post cap bevels; canopy three-color zones; canopy edge sag;
  counter wear; shelf seams; four sack colors; crate slats; barrel hoops; lantern; cyan crystal;
  gold caps; rear bracing.
- **Sockets:** `Socket_Vendor` and `Socket_Counter`.
- **Feature targets:** critical `stall-frame-and-opening`, `striped-canopy`,
  `counter-and-goods-system`, `vendor-scale`; important `crate-and-barrel`,
  `lantern-and-crystal-accents`.

The fence shown on the sheet is not a tenth output. It informs timber, stone-foot, and gold-cap
language only; the four selective layout runs reuse `/models/props/fence.glb`.

### Wall chord wing

- **Bounds:** one reusable straight chord wing is `X 6.5`, `Z 0.65`, `Y 2.7` yards. Output
  `eastbrook_wall_wing.glb`. Layout places bounded chords on radius `28.4`; the placements
  collectively form the concentric ring and terminate around each five-yard opening.
- **Hierarchy:** root; wall slab; base and cap courses; outer pillar; gate-side watch pillar;
  rail system; banded leaf; lantern and crystal cue; join sockets.
- **Topology:** the wall body is one straight `assembled-solid` chord with complete inner and
  outer faces. Pillars and the leaf are `assembled-solid`; block courses and metal bands are
  `surface-relief`; rail rods are `fiber-strand` tubes or thin cylinders. The layout generator,
  not the serialized mesh, owns the ring curvature. Every generated arc span is at most `6.5`
  yards and receives a tangent-aligned chord placement; one long straight wall is forbidden.
- **Silhouette lock:** complete chord body, lower outer pier, taller blue-roof watch pier at the
  gate side, and continuous rail cap. The assembled ring must read as shallow-curved and
  concentric without visible seam gaps. No disconnected half-wing and no leaf across an opening.
- **Mapped details, minimum 10:** base plinth; cap bevel; three masonry-course rhythms; offset
  block seams; outer pier cap; watch-box window; blue pyramidal roof; rail posts; horizontal rail;
  gate bands and studs; lantern crystal; contact-dark base.
- **Sockets:** `Socket_LeftJoin` and `Socket_RightGate`. Chaining or mirroring must preserve
  outward normals, material winding, tangent orientation, and seam continuity.
- **Feature targets:** critical `wall-mass-and-course-rhythm`, `outer-and-watch-pillar-pair`,
  `rail-cap-system`, `bounded-chord-ring-read`, `complete-five-yard-gate-composition`; important
  `banded-leaf`, `lantern-and-blue-roof`.

## Locked build passes

Each asset advances independently. A future pass remains locked until the current pass has a
render, comparison sheet, review record, and `continue` decision.

1. **Blockout:** exact bounds, floor seating, `+Z` front, all silhouette-defining macro masses,
   player-scale proxy, and no materials beyond diagnostic values.
2. **Structural pass:** component hierarchy, openings, repeated systems, parent attachments,
   sockets, and contact points. Reject floating awnings, roofs, signs, racks, benches, or rails.
3. **Form refinement:** roof pitches, tapers, bevels, chamfers, arches, buttresses, masonry rhythm,
   and silhouette-visible relief.
4. **Material pass:** vertex-color palette, opaque and emissive separation, one shared external
   atlas with cell-contained semantic UVs, local wear and cavity response, warm and cyan restraint,
   plus neutral, grazing-light, Low Lambert, and Ultra Standard proof.
5. **Lighting pass:** neutral review rig first, then reference-like warm key, cool fill or rim,
   soft contact shadow, ACES exposure target, and no asset-owned point lights.
6. **Interaction pass:** named sockets, `sculptRuntime`, authored collision separation, station or
   NPC apron, camera-hide height, terrain seating, and non-interactive status.
7. **Optimization pass:** material merge, shared or instanced repeats, optimizer round trip,
   parsed GLB contract, raw and shipping multi-angle comparison, and runtime tier conversion.

## Comparison rubric and quality contract

### Required evidence

For every visual pass, produce one full reference/render comparison sheet for the pass goal.
Use at most five critical semantic targets in that pair. Required final views are front, rear,
left, right, reference-like three-quarter, low grazing, and player-scale hero. Non-planar forms
must also pass at least two orbit angles for self-consistency. An orbit angle that does not exist
in the reference is judged for volume and attachment, not pixel similarity.

Review in this order:

1. silhouette and camera-normalized proportions;
2. component hierarchy, contact, and repeated-system placement;
3. form detail and negative space;
4. material and emissive response;
5. local features and wear;
6. lighting and camera;
7. explicit performance tradeoffs.

Layer scores are `silhouetteProportion`, `componentStructure`, `formDetail`,
`materialSurface`, and `lightingCamera`, each from `0` to `1`. Pixel diagnostics may identify
framing or degenerate geometry but cannot approve a pass. The master concept is a generated scene,
so photo-like SSIM or unaligned IoU is advisory only.

```json
{
  "qualityContract": {
    "definitionOfDone": "Every shipping GLB matches its admitted turnaround's identity-critical silhouette and service cues, fits its authored world bounds, survives serialized multi-angle review, shares exactly one external runtime atlas with the preserved Armoury and banker chest on every graphics path, and integrates without changing gameplay authority.",
    "visualAcceptance": {
      "globalThreshold": 0.70,
      "criticalFeatureThreshold": 0.70,
      "requireEveryCriticalFeature": true,
      "allowAverageToHideCriticalFailure": false
    },
    "requiredViewpoints": [
      "front",
      "rear",
      "left",
      "right",
      "reference-three-quarter",
      "grazing",
      "player-scale-hero"
    ],
    "requiredMaterialViews": [
      "neutral",
      "grazing",
      "reference-match",
      "low-lambert",
      "ultra-standard"
    ],
    "stopConditions": [
      "global score below 0.70",
      "any critical feature below 0.70",
      "wrong or collapsed silhouette",
      "missing service cue",
      "floating or detached child part",
      "bounds, floor seating, or front-axis failure",
      "five-yard wall passage obstruction",
      "duplicate or obstructed gameplay station visual",
      "unreadable Low-tier silhouette or emissive-only identity",
      "triangle, byte, primitive, material, texture, skin, or animation budget failure"
    ]
  }
}
```

Choose exactly one review action per pass: `continue`, `refine-spec`, `refine-code`,
`request-input`, or `stop`. Missing or contradictory specification requires `refine-spec`.
Implementation drift against a sound spec requires `refine-code`. Hidden essential geometry or an
unresolvable cross-panel contradiction requires `request-input`. No asset can receive `continue`
without a global score of at least `0.70` and a score of at least `0.70` for every critical
feature visible in that comparison.
