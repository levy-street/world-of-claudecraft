# Real-time rendering technique survey

Date: 2026-07-31

Target: WebGL2, Three r165, Chrome through ANGLE Metal on Apple M2 Pro, with
tile-based deferred rendering behavior. The performance target is all five
graphics presets. Low and medium are first-class targets, not fallbacks.

## Decision

The best fit is to preserve exact vertex index reuse when static prop meshes
are baked and merged. The previous prop path converted every indexed glTF
primitive to an expanded triangle stream before merging it with procedural
geometry. The new path keeps indexed sources indexed and gives non-indexed
procedural sources byte-exact full-tuple indices.

This change:

- preserves the original index element order, triangle order, winding,
  transforms, materials, shadow flags, bucket order, and expanded values of
  every active vertex attribute;
- keeps the same draw, target, pass, triangle, material, and per-frame CPU
  counts;
- runs only while static prop geometry is prepared;
- applies to low and medium as well as the higher presets; and
- removes vertex records and can reduce vertex fetch, post-transform work, and
  Apple tiled-vertex-buffer pressure inside the existing draws.

The evidence supports the mechanism, not a promised frame-rate increase.
Eastbrook's earlier exact-index change removed about 40 percent of its vertex
records and was benchmark-neutral. This prop change therefore needs the normal
five-preset target benchmark before any FPS claim. It is still the strongest
candidate because it has exact output, broad reach, an audited data-reduction
opportunity, and none of the frame-graph costs that lost on this hardware.

## Method and verdict labels

The survey combined:

- a repository inventory of render systems and hot paths;
- the measured M2 Pro wins, losses, and closed avenues in the shared graphics
  notes and [TBDR analysis](./tbdr-analysis.md);
- the WebGL 2 specification and Three r165 implementation;
- current upstream ANGLE Metal behavior where WebGL leaves implementation
  choices open; and
- primary papers, vendor architecture guidance, and engine documentation.

Each item has one of these verdicts:

- **Already present**: the material technique is already active and is not a
  proposal.
- **Rejected**: it fails exact output, adds forbidden frame work, is a measured
  loss, or has no credible benefit on low and medium.
- **Candidate**: it fits the constraints closely enough to implement or retain
  as a specifically bounded future experiment.

Preset impact names the presets likely to benefit, not a guarantee.

## Existing ground truth

The renderer is not a naive forward scene. It already contains the following
techniques that might otherwise look like recommendations:

| Existing technique | Repository state | Presets |
| --- | --- | --- |
| Spatial partitioning | Terrain chunks, zone streaming, prop z-bands, foliage grids, and nameplate spatial hashing are active. Three performs object frustum culling. | All five |
| Geometry LOD | Chunked terrain LOD and skirts are active. | All five |
| Tree impostors | Real-model and impostor windows, including fog coverage rules, are active in `foliage_lod.ts`. | All five |
| Character LOD | Animation-rate, shadow, animated-far, and frozen-far bands are active in `crowd_lod.ts`. | All five |
| Instancing and merging | Foliage, props, gather nodes, grass, scree, water flora, and other repeated content are instanced. Static props, rigs, and zone structures are merged where compatible. | All five |
| Atlases | VFX, character, Eastbrook, dungeon, and stadium families use atlases where their sampling rules permit it. | All five, content dependent |
| Temporal work spreading | Idle prewarm queues, paced foliage construction, dirty grass buffer spans, and tiered UI update cadence are active. | All five |
| Exact dirty uploads | Live VFX uses one compact uploaded prefix. Blade grass marks changed spans. | All five |
| Tile-friendly ordering | Ordinary opaque work precedes alpha-tested feedback and transparent work. The adaptive opaque sort is already landed. | All five |
| Tile-friendly post | Output and grading are fused, redundant clears and a spare target are removed, bloom addition is folded, and depth is omitted where unused. | Preset dependent |
| Exact shader specialization | Terrain splat masks, parallax skips, specialized AO paths, bloom identity-tint removal, and shared water-flora ORM fetches are already landed. | Preset dependent |
| Static geometry compaction | Terrain uses narrow indices and cache-aware ordering. Eastbrook exact indexing, welded foliage GLBs, rig merge, and narrow skeleton palettes are landed. | All five, content dependent |

The exact-hardware losses are also hard filters:

| Closed avenue | Measured or structural reason | Presets |
| --- | --- | --- |
| Extra draws to save shader work | More draw calls and visibility-class partitions lost on the M2 Pro target. | All five |
| Shadow caching | State tracking and cache management cost more than the saved work. | Medium through insane |
| Render-target aliasing | The dependent write, read, write chain regressed the high-tier post graph. | High through insane |
| Dynamic fragment branches | Branch overhead and divergence lost against compile-time specialization. | Preset dependent |
| CPU screen-space occlusion | About 0.745 ms CPU saved only about 0.05 to 0.15 ms GPU. | All five, worst trade on low and medium |
| AO output changes | Cheaper approximations failed exact output. | High through insane |
| Precision narrowing | The attempted lower precision path did not produce a safe win. | Preset dependent |
| Overdraw triangle reordering | It did not improve the target measurements. | All five |

## Classic optimization techniques

Primary background includes Clark's
[hierarchical geometric models](https://doi.org/10.1145/360349.360354),
Fuchs, Kedem, and Naylor's
[BSP visibility work](https://www.cs.unc.edu/~fuchs/publications/VisSurfaceGeneration80.pdf),
and Apple's
[vertex-data guidance](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesforWorkingwithVertexData/TechniquesforWorkingwithVertexData.html).

| Technique | Evaluation | Verdict | Presets |
| --- | --- | --- | --- |
| Precomputed exact model data | Static preprocessing is attractive when it deletes storage or math without changing runtime semantics. Lookup textures are not automatically cheaper: NVIDIA's [GPU program optimization guidance](https://developer.nvidia.com/gpugems/gpugems2/part-iv-general-purpose-computation-gpus-primer/chapter-35-gpu-program-optimization) describes the storage versus computation trade and cache risk. | **Candidate**, but only for exact preprocessing. The implemented prop index preservation is the strongest case. General shader lookup-table replacement is **Rejected** because interpolation, precision, and an added texture fetch make exact output and a win unlikely. | Exact preprocessing: all five. Shader LUTs: no reliable target |
| Coarse grids and hierarchical scene structures | Terrain chunks, zone partitions, foliage grids, and Three object culling already supply the coarse hierarchy. A finer runtime tree cannot cull inside one merged or instanced draw. Splitting those batches adds draws, and traversing a new tree adds per-frame CPU. | **Already present** at the useful granularity. A new runtime BVH or octree is **Rejected** for this task. | Existing system: all five. A finer tree would mainly target high-visibility scenes |
| BSP trees | BSP preprocessing is strongest for mostly static polygonal environments. This world mixes open terrain, streamed zones, merged content, and dynamic entities. Useful leaves would require more draw partitions. | **Rejected**. Poor world fit and conflicts with the measured draw-call result. | Town and interiors on all presets in theory |
| Portals and PVS | Teller and Sequin require a conservative [potentially visible set](https://people.csail.mit.edu/teller/pubs/siggraph91.pdf). Luebke and Georges traverse authored [cells and portals](https://www.luebke.us/publications/pdf/portals.pdf). This can be effective for room-like architecture, but the open world lacks stable authored cells and has dynamic openings and actors. | **Rejected**. It needs new authoring, runtime traversal, and partitions fine enough to omit cells. | Dense interiors and town only |
| Temporal amortization | Initialization and upload work is already paced. Deferring settled-frame animation, visibility, lighting, or shadow work mixes states from different times. Bishop's [frameless rendering](https://doi.org/10.1145/192161.192195) is deliberately approximate. | **Already present** for non-frame-critical preparation. Extending it to visible frame work is **Rejected** for output identity and fairness. | Existing system: all five |
| Dirty-region redraw | Apple's [OpenGL ES performance guidance](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/Performance/Performance.html) recommends avoiding needless redraws. Here camera motion, characters, water, VFX, fog, and full-frame post make nearly every scene pixel dirty. Preserving old color and depth also fights the target's discard-friendly path. | **Already present** for exact buffer and UI updates. Main 3D dirty-region rendering is **Rejected**. | Existing system: all five |
| Shading LOD | Funkhouser and Sequin's [adaptive display](https://www.cs.princeton.edu/~funk/sig93.pdf) and Olano, Kuehne, and Simmons' [shader LOD](https://diglib.eg.org/items/af9bf5b4-3c70-458a-af68-bc55788461a5) trade image quality for cost. Distance-based tap or lobe removal changes pixels. | **Already present** as preset selection. New runtime shading LOD is **Rejected**. Exact zero-contribution specialization remains useful, but multiple cases already landed. | Would target low and medium, but violates the contract |
| Update-rate LOD | Carlson and Hodgins use less accurate [simulation levels of detail](https://graphicsinterface.org/wp-content/uploads/gi1997-1.pdf). The character renderer already uses distance and crowd-pressure cadence with accumulated time. Further reduction changes poses on specific frames. | **Already present** for character presentation. Further reduction is **Rejected**. Simulation LOD is outside rendering scope. | Existing system: all five |
| Impostors and billboards | Maciel and Shirley's [textured clusters](https://doi.org/10.1145/199404.199420) replace geometry with an image approximation. Trees already use impostors behind explicit fog rules. Characters and ordinary props would change silhouette, lighting, shadow, equipment, and transition pixels. | **Already present** for trees. Expansion to characters or props is **Rejected**. | Existing trees: all five. Expansion would favor distant high-tier content |
| Texture atlases | Apple notes that [atlases](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesForWorkingWithTextureData/TechniquesForWorkingWithTextureData.html) can reduce binds, but ordinary repeat wrapping is unavailable and filtering needs gutters at every mip. | **Already present** selectively. A future atlas is a **Candidate** only if an inventory proves compatible dimensions, format, color space, transforms, sampling, and a real draw reduction. Not selected. | Potentially all five if it removes draws |
| Batching | Apple recommends fewer submissions and warns that sprawling batches become harder to cull. The renderer already merges or instances the compatible families and deduplicates materials. | **Already present**. More partitioning or incompatible merging is **Rejected**. Improve data inside existing batches instead. | All five |
| Exact vertex indexing | Indexed data avoids duplicate records and can reuse transformed vertices. The static prop merger was the broad remaining hole because it deliberately expanded all source indices. | **Candidate and implemented**. | All five |

## Modern engine and TBDR techniques

Apple separates tiling from fragment rendering and recommends compatible pass
merging, load/store discipline, and avoiding attachment ping-pong in
[Optimize Metal apps and games with GPU counters](https://developer.apple.com/videos/play/wwdc2020/10632/).
Its [Apple GPU architecture session](https://developer.apple.com/videos/play/wwdc2020/10602/)
also explains hidden-surface removal. These principles matter, but WebGL2 does
not expose native Metal tile memory directly.

| Technique | Evaluation | Verdict | Presets |
| --- | --- | --- | --- |
| Front-to-back opaque submission and HSR classes | Apple can defer ordinary opaque fragment shading until visibility is known, but blending, discard, and depth feedback constrain that behavior. The renderer already separates ordinary opaque, alpha-tested feedback, and transparent work, with a landed adaptive sort. | **Already present**. | All five |
| Depth prepass | Native immediate renderers often use one, but effective Apple HSR already supplies the overdraw benefit for ordinary opaque work. A prepass submits geometry twice and may add depth storage or an encoder boundary. | **Rejected**, consistent with exact-target losses from added draws. | All five |
| Merge compatible scene passes | Ordinary scene classes already remain inside one Three scene render where ordering permits it. The compatible post stages that could be fused without dependency changes have landed. | **Already present**. No further safe merge found. | All five, with more post work on high tiers |
| Clear as load action | Full unmasked early clears can become native load actions. Redundant clears have already been removed. Scissored, masked, or late clears can become draws in ANGLE Metal. | **Already present** at the available seam. | All five |
| Explicit load and store actions | Native Metal exposes [load and store actions](https://developer.apple.com/documentation/metal/setting-load-and-store-actions/), but WebGL2 does not. WebGL can only provide recognizable usage patterns to ANGLE. | **Rejected** as an application patch because the control is unavailable. | None directly |
| Memoryless attachments | Native Metal has [memoryless storage](https://developer.apple.com/documentation/metal/mtlstoragemode/memoryless). WebGL2 cannot request it. Three and ANGLE can use it opportunistically for supported implicit multisampled-render-to-texture paths. | **Already present opportunistically** through the implementation. No portable project control exists. | Medium's MSAA path is the current niche |
| Framebuffer invalidation | WebGL2 permits invalidation, but the implementation may ignore it. In the examined ANGLE Metal path, invalidation can also end the active encoder. A new call adds per-frame JavaScript and command work. | **Rejected**. Default depth discard is already handled where preservation is disabled, and richer-tier depth has consumers. | No universal win |
| Attachment aliasing | Reusing one target may save allocation while adding a dependency that prevents overlap and forces preservation. This exactly matches a measured regression in the bloom graph. | **Rejected and closed by measurement**. | High through insane |
| MRT deferred lighting | Native tiled deferred shading can keep a G-buffer on chip. A conventional WebGL2 deferred path needs multiple attachments, later sampling, and more targets and passes. Apple's [deferred lighting sample](https://developer.apple.com/documentation/Metal/rendering-a-scene-with-deferred-lighting-in-swift) relies on native Metal facilities not exposed by production WebGL2. | **Rejected**. It is the expensive external-memory form on this target. | Mostly high tiers, and fails low and medium |
| Pixel-local storage, tile shaders, framebuffer fetch | These can make deferred or programmable blending cheap on native tile hardware. The WebGL [pixel local storage extension](https://registry.khronos.org/webgl/extensions/WEBGL_shader_pixel_local_storage/) remains draft and does not provide a dependable Three r165 production path. | **Rejected** for availability and maturity. | None portably |
| Clustered or tiled light lists | Modern engines build per-tile or per-cluster light lists. WebGL2 would need CPU uploads or extra GPU construction passes, then custom lighting shaders. The renderer already prunes point lights exactly, and low and medium do not establish a large remaining light-list bottleneck. | **Rejected** for this task. It adds frame work and lacks all-preset evidence. | Dense high-tier lighting only |
| GPU-driven scene culling, indirect draws, and meshlets | Modern engines use compute, storage buffers, indirect commands, and sometimes mesh shaders. WebGL2 exposes none of that full pipeline. Transform feedback is not a substitute on ANGLE Metal. | **Rejected** as unavailable or pass-adding. | Dense scenes in theory |
| Hierarchical depth occlusion | A depth pyramid plus GPU culling is common in modern engines. WebGL2 would require pyramid passes, query or readback latency, and additional draw submission. The repository's CPU occlusion route already lost. | **Rejected and closed**. | Dense occluded scenes only |
| Temporal upscaling and dynamic resolution | Modern engines commonly reuse history or vary resolution. Both change sample placement and output, and history introduces state across frames. | **Rejected** for exact output. | Low and medium would be the intended targets |
| Virtual textures and virtual shadow maps | These trade working-set residency against indirection, page management, and update passes. The current asset scale does not establish a texture residency bottleneck, and virtual shadows add targets and page work. | **Rejected** for this task. | Mostly high and insane |
| Async compute and pass overlap | Native APIs can overlap independent work. WebGL2 does not expose command queues. Visible candidates are dependent: water simulation feeds water, shadow feeds scene lighting, and scene color/depth feeds post. | **Rejected** as unavailable, with no safe pass reorder found. | All five in theory |
| Readback avoidance | Readback and forced synchronization can flush or wait for GPU work. Gameplay has no steady-frame readback; capture paths are out of band. | **Already present**. | All five |

## MMO and crowd rendering

The most relevant primary crowd reference is NVIDIA's
[Animated Crowd Rendering](https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-2-animated-crowd-rendering).
Modern engine practice is represented by Epic's
[Animation Budget Allocator](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-budget-allocator-in-unreal-engine)
and [modular character guidance](https://dev.epicgames.com/documentation/en-us/unreal-engine/working-with-modular-characters-in-unreal-engine).

| Technique | Evaluation | Verdict | Presets |
| --- | --- | --- | --- |
| Distance and crowd-pressure animation cadence | The renderer already reduces pose-update frequency by distance and crowd pressure while preserving accumulated time and actionable-pose exemptions. | **Already present**. | All five |
| Screen-size or projected-area animation cadence | Modern engines can base update budgets on projected importance rather than distance alone. This renderer does not. Computing and maintaining a projected-size band would add per-frame CPU, and changing cadence for the same actor and frame would change its exact pose. | **Rejected** under the strict no-new-per-frame-CPU and exact-output contract. It could be a separate approximation experiment under different rules. | Dense crowds on all five, with low entering reduced cadence sooner |
| Shared skeleton or leader pose | It helps only parts or actors with one identical pose. This renderer goes further within each modular character by merging compatible rig parts into one draw and one skeleton. Independent MMO actors have different phase, speed, casts, deaths, forms, and one-shots. | **Already present** within a character. Cross-character sharing is **Rejected**. | All five |
| Compact bone palettes and unchanged-palette reuse | The renderer removes unused palette entries and texture rows, narrows skin indices exactly, and skips unchanged palette rebuilds. | **Already present**. | All five |
| Skinned instancing with a palette atlas | The NVIDIA crowd method stores independent animation matrices in textures and builds per-LOD instance lists. Three r165's stock skinning has one bone texture per draw. A replacement needs custom shaders, palette atlases, per-frame instance data, effect cohorts, and shadow integration. | **Rejected**. It adds per-frame CPU and upload work with high parity risk. | Dense crowds only; little ordinary low/medium evidence |
| Animation or vertex texture baking | Offline samples cannot reproduce arbitrary live quaternion tracks, crossfades, one-shots, time scales, and procedural additions bit for bit. Dynamic caching research by [Lister, Laycock, and Day](https://diglib.eg.org/bitstreams/c66ca1da-10ec-4743-99fa-0dd66f434919/download) adds an FBO cache and update pass. | **Rejected** for output identity and forbidden target/pass work. | Mostly medium through insane crowds |
| Instance frozen far characters | This would need per-frame bucketing and matrix uploads across visual, material, skin, tint, effect, corpse, and equipment states. It also changes transform evaluation in the shader. | **Rejected** under the no-new-per-frame-work and exact-output rules. | Low could benefit most in dense crowds |
| Character impostors | [Geopostors](https://doi.org/10.1145/1073204.1073290) are explicitly an image approximation. They change silhouettes, equipment, lighting, animation, telegraphs, and shadows. | **Rejected**. Tree impostors are already present under different fog constraints. | Distant dense crowds |
| GPU crowd culling and LOD | AMD's [GPU scene management](https://drivers.amd.com/misc/siggraph_asia_08/GPUBasedSceneManagementLargeCrowds.pdf) depends on geometry shaders, filtering passes, Hi-Z, queries, and separate LOD draws. WebGL2 lacks the required pipeline, and added passes are a poor TBDR fit. | **Rejected**. | Dense crowds only |
| Exact merged-rig tuple compaction | This could be exact if shipping merged rigs contain duplicate full tuples, but the duplicate ratio is not yet audited and the scope is crowd-only. | **Candidate** for a future asset audit, ranked below props. | Color draws on all five, plus richer-tier shadows |

## WebGL2 features

The normative reference is the [WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/).
Three behavior below refers specifically to tag
[0.165.0](https://github.com/mrdoob/three.js/tree/0.165.0).

| Feature | Evaluation | Verdict | Presets |
| --- | --- | --- | --- |
| Vertex array objects | Three r165's [WebGLBindingStates](https://github.com/mrdoob/three.js/blob/0.165.0/src/renderers/webgl/WebGLBindingStates.js) caches VAOs per geometry, program, and wireframe state. | **Already present** through Three. | All five |
| Immutable texture storage | Three r165's [WebGLTextures](https://github.com/mrdoob/three.js/blob/0.165.0/src/renderers/webgl/WebGLTextures.js) uses `texStorage2D` and `texStorage3D` for non-video texture classes. | **Already present** through Three. | All five |
| Instanced arrays | `InstancedMesh` and instanced buffer attributes are used broadly across the renderer. | **Already present**. | All five |
| Uniform buffer objects | WebGL2 supports `std140` blocks. Three r165's [WebGLUniformsGroups](https://github.com/mrdoob/three.js/blob/0.165.0/src/renderers/webgl/WebGLUniformsGroups.js) is limited to `ShaderMaterial` and `RawShaderMaterial`; many shared uniforms here patch built-in materials through `onBeforeCompile`. Conversion would be invasive and still require updates and bindings. | **Rejected** now. A future unchanged block shared by many custom programs is a narrow **Candidate** only after profiling. | No demonstrated all-preset win |
| Transform feedback | It requires capture setup and draw commands. ANGLE documents that Metal has [no native transform feedback](https://chromium.googlesource.com/angle/angle/+/refs/heads/main/src/libANGLE/renderer/metal/doc/TransformFeedback.md); mixed capture and rasterization can run the vertex work twice and feedback boundaries require barriers. Three's classic renderer has no first-class path. | **Rejected**. It adds draws, pass boundaries, and per-frame management. | None |
| Texture arrays | They can reduce binds or permit larger batches only when layers share dimensions, format, mip structure, color space, and sampling. Patching built-in PBR chunks adds variants and exact-sampling risk. The array alone removes no tap or draw. | **Rejected** for this task. An inventory-proven compatible family remains a conditional **Candidate**. | Potentially all five if it removes draws |
| `WEBGL_multi_draw` | The [extension](https://registry.khronos.org/webgl/extensions/WEBGL_multi_draw/) reduces WebGL entry overhead. Three r165 [BatchedMesh](https://github.com/mrdoob/three.js/blob/0.165.0/src/objects/BatchedMesh.js) uses it when available, otherwise loops ordinary draws. It also uses a matrix texture and defaults to per-frame culling and sorting. [ANGLE's general path](https://chromium.googlesource.com/angle/angle/+/refs/heads/main/src/libANGLE/renderer/renderer_utils.cpp) loops subdraws, so it is not one native Metal draw. | **Rejected** for landing. It is the best API-level future **Candidate** only after proving extension exposure and a compatible static draw family that cannot be exactly merged or instanced. | Potential CPU submission benefit on all five, but unproven |
| Occlusion queries | Query results are asynchronous, unavailable in the issuing frame, and not guaranteed on the next animation frame. Useful culling needs proxy work, delayed decisions, and polling. The measured CPU culler already lost badly. | **Rejected and closed**. | Harmful across the target set |
| Sampler objects | A sampler can override sampling state for a bound texture unit, but Three r165 owns sampling on `Texture` objects and does not use raw sampler objects. Bypassing that state model adds calls and has no identified multi-state image hotspot. | **Rejected**. | No demonstrated benefit |
| Multiple render targets | Core WebGL2 can write several attachments, but later dependent post work still has to sample stored results. It does not provide native tile-local deferred shading. | **Rejected** for the current graph. | High tiers only in theory |

## Candidate ranking

| Rank | Candidate | Why it ranks here | Presets |
| ---: | --- | --- | --- |
| 1 | Preserve exact indices through static prop merging | Exact output, audited catalog-wide input opportunity, no new frame work, existing helper and architectural seam | All five |
| 2 | Exact tuple compaction after rig merging | Same exact mechanism, but the duplicate ratio is unknown and the benefit is crowd-specific | All five in crowd scenes |
| 3 | `WEBGL_multi_draw` experiment | Could reduce JavaScript submission overhead, but extension availability, fallback native draws, matrix-texture math, and per-frame sort/cull weaken it | Potentially all five |
| 4 | Compatible texture-array or atlas family | Useful only if a concrete inventory proves it removes existing draws while preserving all sampler semantics | Content dependent, potentially all five |
| 5 | Small immutable UBO shared by custom shaders | Narrow Three r165 seam and no established low/medium bottleneck | Mostly richer tiers |

## Implemented candidate input audit

An offline audit decoded all unique URLs in the static prop catalog and counted
the attributes extracted by the prop path: Float32 position, normal, UV, and
optional color. Every audited primitive was already indexed and had no
unreferenced source vertices. This establishes the source-data opportunity. It
is not an exact live-scene saving: `InstancedMesh` placements were already
indexed and bypass this merger, while only static mesh placements entering
`mergeStaticMeshes` receive the change.

| One-copy catalog opportunity | Expanded elements if merged | Source vertices retained | Vertex-record reduction | Estimated expanded bytes | Estimated indexed bytes, worst-case Uint32 | Byte reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Low-tier 35-asset subset | 211,689 | 115,873 | 45.3% | 7,136,172 | 4,740,680 | 33.6% |
| Full 194-asset catalog | 1,109,934 | 522,109 | 53.0% | 36,142,092 | 21,391,628 | 40.8% |

These are theoretical one-copy catalog opportunity figures, not before and
after totals for a live preset. Static placements may repeat assets, some
catalog assets are used only through already-indexed instancing, and final
merged buckets may promote an index to Uint32. The worst-case byte estimate
already assumes Uint32 indices. Fewer vertex records do not imply the same
percentage reduction in vertex shader invocations or frame time. The actual
static-placement mix, cache locality, and target bottleneck decide the runtime
result.

The implementation preserves identity as follows:

1. An indexed source is cloned, retaining its original vertex records and
   index element sequence.
2. A non-indexed source is converted by grouping byte-identical full
   attribute tuples and emitting an index element for every original corner.
3. The same world matrix is applied to the cloned or normalized geometry.
4. Three r165's geometry merger concatenates attributes and offsets each
   source index without changing element order.
5. No affected prop shader uses vertex or primitive IDs, and the prop path has
   no flat vertex output whose provoking vertex could change.

The focused test expands the final indexed batch and compares position,
normal, UV, and color streams with the old semantic stream after transforms.
It also pins shared source immutability, one draw for one bucket, unchanged
triangle count, material and shadow bucket separation, bucket order, and
shadow flags.

## Remaining measurement work

No benchmark was run as part of this research and implementation pass because
the shared task constraints prohibit the benchmark and browser harness here.
The change should be measured later on the reference M2 Pro across all five
presets and the canonical scenarios.

The benchmark report should separate:

- frame time and FPS from static GPU memory reduction;
- town from open-run and crowd scenarios;
- low and medium from the richer post-processing tiers; and
- mechanism confirmation from practical significance.

A neutral result is plausible and should be reported as neutral. The technique
should not be credited with an estimated FPS percentage before that data
exists.
