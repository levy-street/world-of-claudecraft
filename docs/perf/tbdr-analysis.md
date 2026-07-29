# Apple M2 Pro TBDR analysis

Date: 2026-07-30

Target: Apple M2 Pro, Chrome WebGL2, ANGLE Metal, 1280x720 settled frames.

## Conclusion

This target rewards removing work from an existing draw and keeping dependent
render-target work out of the main render pass. It punishes extra draws,
attachment changes, dependent blits, and target reuse that introduces new
resource dependencies. The measured results fit that model.

The town frame may have substantial tiling cost because it submits about 4.25
million triangles, but triangle count alone does not prove that it is
tiling-bound. Apple does not publish the M2 tiled vertex-buffer capacity or the
threshold for a Partial Render. A Metal System Trace or Xcode GPU capture on
the reference machine is required to distinguish vertex, fragment, Partial
Render, and encoder-store costs.

The highest-confidence untouched opportunity was to restore exact index reuse
to Eastbrook's deliberately expanded geometry after all generated attributes
exist. This change is implemented. It keeps the same triangle sequence and the
same byte values for every position, normal, color, and UV. It adds no draw,
render target, pass, or per-frame CPU work.

## What the M2 Pro actually does

### Tiling and rendering are separate phases

Apple GPUs process a render pass in two broad phases. The tiling phase runs
vertex shading for the whole pass and bins transformed primitives into tiles.
Its post-transform output and internal metadata live in an opaque Tiled Vertex
Buffer. If that buffer fills, the GPU performs a Partial Render, splitting the
pass to flush the buffer. The rendering phase then handles one tile at a time:
load attachments into on-chip tile memory, determine visibility, shade visible
fragments, and store required results. Apple documents this pipeline in
[Harness Apple GPUs with Metal](https://developer.apple.com/videos/play/wwdc2020/10602/).

This makes three costs especially relevant here:

1. Vertex executions, active vertex outputs, primitive binning, and index
   locality affect the tiling phase.
2. Texture reads and shader instructions on fragments that survive visibility
   affect the rendering phase.
3. Attachment stores and later loads move data between tile memory and unified
   system memory.

Apple can overlap tiling for a later independent pass with rendering from an
earlier pass. Resource dependencies remove that freedom. Apple's
[Apple silicon optimization guidance](https://developer.apple.com/videos/play/wwdc2020/10632/)
therefore recommends merging compatible passes, avoiding attachment
ping-pong, folding a clear into the consuming pass, and resolving MSAA at the
end of the producing pass.

### "Flush" has three different meanings

The word flush must be qualified:

- An HSR visibility flush means the GPU must run fragment shading for covered
  pixels because blending or feedback prevents it from deferring visibility.
  It does not by itself mean that tile memory was written to system memory.
- A Partial Render means the opaque Tiled Vertex Buffer filled and the hardware
  split the render pass.
- Ending a Metal render encoder closes a render pass. Required attachments may
  then be stored and loaded by the next pass. This is still distinct from
  submitting the command buffer or synchronizing the CPU.

Current ANGLE may submit a command buffer at presentation, explicit flush or
finish, or internal pressure thresholds. In the revision examined, one
threshold is 16 render passes per command buffer and another tracks 400 MiB of
working resources. See ANGLE's pinned
[Metal context implementation](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/ContextMtl.mm)
and
[Metal constants](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/mtl_common.h).
These are current implementation details, not WebGL guarantees, and Chrome may
vendor a different ANGLE revision.

### Tile memory, load/store, and memoryless targets

Tile memory is fast, on-chip, and temporary. A load action initializes it from
an attachment, a clear value, or undefined data. A store action writes a
result back when later work needs it. Apple advises loading and storing only
what is required in
[Setting load and store actions](https://developer.apple.com/documentation/metal/setting-load-and-store-actions/).

Native Metal can mark one-pass attachments as
[memoryless](https://developer.apple.com/documentation/metal/mtlstoragemode/memoryless),
so they exist only in tile memory and cannot be loaded or stored. WebGL2 does
not expose Metal storage modes, imageblocks, tile shaders, programmable
blending, or explicit load/store actions. ClaudeCraft can only present patterns
that ANGLE can translate efficiently.

ANGLE does use memoryless storage internally for supported implicit
multisampled-render-to-texture paths. Three r165 uses
`EXT_multisampled_render_to_texture` when available; otherwise it resolves via
a framebuffer blit and invalidates transient multisample attachments. See
ANGLE's
[Metal resource implementation](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/mtl_resources.mm),
[extension conditions](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/DisplayMtl.mm),
and the pinned
[Three r165 resolve path](https://github.com/mrdoob/three.js/blob/0.165.0/src/renderers/webgl/WebGLTextures.js).

For context, the current
[Metal Feature Set Tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)
classify M2 as Apple8. They list 1,024 threads per threadgroup, 32 KiB total
threadgroup allocation, 32 KiB explicit imageblock allocation, and 128 KiB
implicit imageblock allocation. The listed maximum tile dimensions are 32x32
without MSAA or at 2x and 32x16 at 4x. These are API-family limits, not a
promise about the physical tile chosen for a WebGL pass. WebGL2 cannot tune
these allocations directly.

### Visibility, alpha test, blending, and depth

Apple's hidden surface removal, HSR, can choose the frontmost ordinary opaque
primitive before running its fragment shader. For that class it is pixel
accurate and submission-order independent. Apple recommends this order:

1. Ordinary opaque geometry.
2. Feedback geometry that uses alpha test, `discard`, fragment depth, resource
   writes, or differing color write masks.
3. Translucent geometry.

Blending forces the visibility buffer to shade covered pixels before blending.
Alpha blending itself occurs in tile memory, so it does not inherently write
the render target to system memory after every blended primitive. A discard or
fragment depth update feeds the result back to HSR. Interleaving these
visibility classes can therefore create avoidable fragment work without
creating a new Metal render pass.

This is why foliage should remain after true opaque occluders and before water,
and why transparent water should remain last with its existing depth policy.
It is also why a performance-only depth prepass is a poor default on Apple
GPUs. Apple says effective HSR already supplies the relevant overdraw benefit,
while a prepass processes geometry twice and can add depth storage.

### Vertex and binning cost

The tiled vertex buffer stores post-transform vertex output plus opaque
internal data. Smaller index and vertex streams, exact index reuse, nearby
reuse of recently transformed vertices, fewer active varyings, and fewer
submitted instances all reduce pressure without changing render-pass
structure.

Apple's retired but still relevant OpenGL ES
[vertex-data guidance](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/TechniquesforWorkingwithVertexData/TechniquesforWorkingwithVertexData.html)
recommends indexed geometry, placing shared indices near one another for the
post-transform cache, using the smallest acceptable types, and respecting
alignment. Current ANGLE Metal keeps native 16-bit and 32-bit indices, promotes
8-bit indices, and may convert vertex attributes whose Metal format, offset,
or stride is unsuitable. See ANGLE's
[vertex-array translation](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/VertexArrayMtl.mm)
and
[index-type mapping](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/mtl_utils.mm).

Position-only vertex shading is useful when a pass really needs only position,
such as a solid shadow or visibility pass. Three already compiles separate
shadow/depth shaders and only active attributes are bound. Foliage shadows
still need UV, alpha test, instance data, and wind deformation to match the
color pass. A new position-only foliage partition would either be wrong or add
the draw calls that already measured slower.

Apple does not publish the M2 post-transform cache size, tiled vertex-buffer
size, parameter metadata size, or a universal index reordering rule. Claims
that 4.25 million triangles necessarily cause Partial Renders remain a
hypothesis until a target-machine capture reports them.

## What ANGLE turns into extra work

The following describes upstream ANGLE Metal at commit
`2c5c60cd270d1596fa8abe06bd277983852f4b2b`, dated 2026-07-30.

| WebGL2 pattern | Current ANGLE Metal behavior | Likely target cost |
| --- | --- | --- |
| Keep drawing to compatible attachments | Reuse the active render encoder even if later load/store choices differ | Preserves one Metal render pass |
| Change draw framebuffer or attachment set | End the current encoder and start another | Tile attachment store/load as required |
| Full unmasked clear before draws | Fold the clear into the Metal load action | Avoids a clear draw and prior-content load |
| Scissored, masked, or late clear | Encode clear work as a draw | Adds command, tiling, and fragment work |
| Dependent blit or compute operation | End active dependent rendering and preserve required contents | Pass split, attachment store, dependency, and lost overlap |
| Copy or mip generation on an unrelated resource | May keep current rendering alive | No unconditional split; dependency is decisive |
| `invalidateFramebuffer` | Map invalidated attachments to `MTLStoreActionDontCare`, then end the encoder | Can avoid stores but still creates a boundary |
| `readPixels` from in-flight work | May submit and wait for GPU completion | Strong synchronization risk |
| Leave unsupported MSAA target | Resolve with framebuffer blit, then invalidate transient attachments | Extra resolve work and possibly another boundary |

The relevant primary implementations are
[ContextMtl](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/ContextMtl.mm),
[FramebufferMtl](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/FrameBufferMtl.mm),
and
[TextureMtl](https://chromium.googlesource.com/angle/angle/+/2c5c60cd270d1596fa8abe06bd277983852f4b2b/src/libANGLE/renderer/metal/TextureMtl.mm).

A read-after-write between sequential render targets is legal, but it forces an
ordering dependency. Sampling a texture while it is the active draw attachment
is a WebGL feedback loop and is invalid. Reusing one bloom texture for a later
write therefore saves an allocation only if the new dependency does not cost
more than the allocation. The measurements say it did.

## Explaining the measured evidence

### Winners

**Fewer texture taps per fragment.** This directly removes texture traffic and
fragment instructions after visibility. It stays in the same draw and pass, so
there is no compensating encoder or submission cost.

**Fewer bytes uploaded through the same buffer.** Apple silicon shares system
memory between CPU and GPU, but synchronization and bandwidth still have cost.
Shortening the existing update avoids extra commands and avoids touching bytes
that the GPU cannot use. This result supports smaller existing streams, not
moving data through a new buffer or pass.

**Fewer instances in an existing `InstancedMesh`.** This removes vertex shader
executions, primitives, tiled vertex-buffer output, rasterization candidates,
and shadow work while keeping one draw. It is almost the ideal TBDR
optimization shape.

**Removing CPU work.** Around 620 WebGL draws still require scene traversal,
Three state work, WebGL validation, and ANGLE command encoding. GPU utilization
falling from 98 percent to 87 to 95 percent also leaves room for CPU and
submission improvements to affect frame rate.

**Front-to-back opaque ordering.** This does not refute Apple's order-independent
HSR claim because ClaudeCraft's former "opaque" list also contained alpha-tested
foliage. The current sorter explicitly places true opaque draws before
alpha-tested draws and sorts within each class. Solid buildings can now settle
visibility before foliage feedback, and nearer alpha-tested surfaces can reject
farther layers earlier.

The measured roughly 19 percent static-view win is larger than that explanation
alone proves. If a capture shows that the gain remains when sorting only
ordinary solid opaque draws, ideal HSR theory does not explain it. Possible
causes include ANGLE shader behavior, cache locality, or fewer Partial Renders,
but there is no counter evidence yet. The honest conclusion is that the class
partition has a strong mechanism and the residual solid-order effect is
unresolved.

### Losers

**Eight extra foliage shadow draws despite 60 percent fewer shadow triangles.**
Changing material or draw state on the same framebuffer does not itself split
the Metal render pass, so blaming tile stores would be incorrect. The extra
draws do add recurring Three, WebGL, ANGLE, command, pipeline, vertex-state,
and primitive-list overhead. The result says the old shadow geometry was not
expensive enough to repay those fixed costs. It also argues against future
partitions, depth prepasses, or position-only subpasses that add draws.

**Shadow-map caching through blits.** A blit that depends on active render work
can end ANGLE's render encoder and force required contents to be stored. The
consumer then has a dependency and later load. The full-map scheme also moved
substantial bytes. The scissored restore moved only about 315 KiB yet still
lost heavily, which shows that fixed pass, encoder, and dependency costs
dominated transfer size. This is exactly the pattern Apple warns about.

**Aliasing one bloom target onto another.** The alias added a write, read, then
write dependency on one texture. That can serialize work that previously used
independent resources and prevent tiling/render overlap. The east-run collapse
shows that reducing allocations is not equivalent to reducing render traffic.
Without a Metal trace this dependency explanation is consistent with, but not
uniquely proven by, the measurement.

**Water fragment branches.** A dynamic branch is not free. Fragment SIMD groups
can execute divergent paths, and moving existing math behind a branch saves
nothing where neighboring pixels disagree or where the compiler cannot remove
the path. Branch setup can also increase register lifetime. Apple's shader
guidance recommends inspecting control-flow and divergence rather than assuming
that fewer source-level operations execute. See
[Inspecting shaders](https://developer.apple.com/documentation/xcode/inspecting-shaders)
and
[Apple's shader branching guidance](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/OpenGLES_ProgrammingGuide/BestPracticesforShaders/BestPracticesforShaders.html).
The two measured regressions, 7.1 percent and then 1.9 percent, take precedence
over a theoretical branch win.

## Ranked untouched opportunities

The ranking is risk-adjusted for exact settled-frame parity, not merely
estimated peak upside.

1. **Exactly re-index Eastbrook after atlas UV and color generation.**
   Implemented. The loader path previously expanded every triangle and retained
   no index reuse before already-existing town batching. An audit of shipping
   assets found about 84,990 expanded town vertex records and about 50,775
   byte-identical full tuples, a 40.3 percent reduction. Per-asset simulated
   post-transform cache misses fell about 31 to 43 percent. The implementation
   maps the unchanged expanded triangle stream onto first-occurrence exact
   tuples and selects a 16-bit index where possible. It preserves the existing
   18 color draws, 9 shadow draws, triangle order, all attribute bytes, and all
   frame-time code.

2. **Exactly weld post-quantization foliage tuples while preserving its index
   stream.** The shipping tree, bush, and fern audit found 119,590 vertex
   records and 74,417 exact full tuples, a 37.8 percent reduction before
   multiplying by instances. This may have greater aggregate upside than the
   town change. It ranks second because foliage already has indices and spans
   wind, alpha-test, instancing, shadow, quantized-attribute, and asset-cache
   contracts. The safe implementation must remap existing indices after every
   active attribute is final, preserve each index in sequence, and prove the
   expanded stream against real assets. It needs no runtime tolerance and no
   per-frame work.

3. **Use 16-bit indices for every generated terrain chunk.** The generator
   currently allocates `Uint32Array` unconditionally. The densest 60-unit
   production chunk has 2,809 vertices, and a 120-unit far superchunk has about
   2,401, both far below the 16-bit limit. A `Uint16Array` would preserve every
   index value while halving index upload, worker-transfer, and GPU index-fetch
   bytes. This is the smallest next patch and should be tested by pinning the
   array type while retaining the existing numeric geometry hashes.

4. **Restore exact indexing after `mergeStaticMeshes` in props.** That path
   currently expands indexed inputs to merge them into one draw. Exact
   full-tuple compaction after the merge can keep the one draw and exact
   triangle stream while restoring post-transform reuse. Quantify the actual
   shipping meshes before applying it broadly.

5. **Compact water's static vertex inputs without changing the grid.** The
   custom water shader does not need the plane's normal and UV attributes and
   needs only two local position components plus existing shore data. Removing
   inactive attributes cuts allocation and initial upload. Replacing vec3
   position with an exact vec2 input can also reduce active vertex fetch, but
   it needs a shader-input and bounds proof for every zone and apron. The
   expected win is smaller than indexed scene geometry.

6. **Offline vertex remap for locality without triangle reordering.** Reorder
   unique vertex records and remap indices while leaving the index sequence,
   triangle sequence, and attributes exact. This can improve fetch locality
   and does not affect alpha or depth ties. Do not reorder triangles globally:
   coplanar depth ties, transparency, derivatives, and feedback geometry make
   that a higher parity risk. A target capture is needed because Apple does not
   publish the M2 cache geometry.

7. **Use target captures to find avoidable offscreen attachment boundaries.**
   The current post targets already omit unused depth in the audited paths, and
   the water simulation already uses color-only ping-pong targets. Further pass
   merging is only rankable after ANGLE/Metal counters identify a boundary
   whose dependency can be removed without adding a target or changing output.
   WebGL2 cannot directly request memoryless storage or programmable blending.

Not ranked as opportunities: another depth prepass, shadow partition, cached
blit, bloom target alias, dynamic water branch, new render target, or new
position-only draw. Each violates either the measured cost model or the
explicit draw/pass/target constraints.

## Implemented change and parity argument

`indexExactVertexTuples` operates once while Eastbrook templates are prepared.
It requires non-indexed, non-morph geometry. It builds its identity key from
the raw bytes of every active geometry attribute, not from rounded positions or
a tolerance. The first occurrence of each full tuple becomes the compact
vertex record, and the original expanded vertex order becomes the index order.

Therefore, for every submitted element:

- The triangle and winding are unchanged.
- Position, normal, color, and generated atlas UV bytes are unchanged.
- Material, draw order, groups, transforms, shadows, and visibility are
  unchanged.
- No per-frame JavaScript path changes.
- Draw count, pass count, render-target count, and triangle count are
  unchanged.

The one behavioral assumption is that Eastbrook's Three materials do not use
`gl_VertexID` or flat per-vertex varyings. They use ordinary interpolated
attributes, and the focused tests expand the new index stream and compare it
with the old attribute stream exactly. Browser pixel testing was not run
because Chromium launch is unavailable in this environment and the task
explicitly forbids the frozen baseline runner.
