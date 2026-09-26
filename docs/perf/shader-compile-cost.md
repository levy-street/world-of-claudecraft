# Shader compile cost on ANGLE D3D11

On Windows the browser runs WebGL through ANGLE on its Direct3D 11 backend. ANGLE translates
each GLSL program to HLSL and Microsoft's fxc compiler optimizes it into GPU bytecode. fxc is
single-threaded and slow, its time grows faster than the code it is given, and every program
the game links pays it once per session, at load or as a hitch in play. The shape of the GLSL
text, not the work it does per pixel, decides most of that price.

This page records the shapes we MEASURED on our own programs, the method, and the shapes that
are only suspected. `render-performance-reviewer` reviews shader diffs against the measured
list; a suspected shape becomes a rule only once a measurement confirms it.

## Measured shapes

All figures: RTX 3060, Chrome 153, `--use-angle=d3d11`, driver shader cache disabled, medians
of repeated links of programs harvested from the game, measured in September 2026. They are
illustrations of scale, not budgets: absolute times move with the machine, ratios hold.

| Shape | Measured on | Price |
|---|---|---|
| The same heavy code inlined N times (an unrolled loop, a JS-templated repeat, a helper called at N sites): fxc compiles every copy | the point-light block of `lights_fragment_begin`, 0 to 10 unrolled copies in two world programs | about 30 ms per copy, linear; 10 copies were about 60 percent of a 440 to 505 ms lit program |
| The same block as ONE real loop, constant bound, no implicit-gradient texture read in the body | same programs | links at the price of about 3 copies; fxc does not re-unroll it |
| A `break` inside that loop | same programs | no extra link cost over the plain loop |
| Many branches: `if`, early `return`, a ternary that ANGLE unfolds into flow, a selector chain repeated in every read | the worn surface layer, 24 to 56 branches after inlining reduced to 2 to 4 (`src/render/worn_stone.ts`) | 20 to 26 percent of the layer's programs; 15 percent of all worn program link time in game |
| A chain of dependent texture reads (a parallax walk) | worn layer, a two-read walk versus one height read | about 15 ms per program |
| Explicit gradients (`textureGrad` with derivatives taken up front) on every read | worn layer variant | about 6 ms more per program: a fair price to fix seams, not free |
| A variant axis (a `#define`, a JS-templated value, a `customProgramCacheKey` token) | the harvested corpus of a full Ultra tour | every value is one more full link, even when two values compile byte-identical text; ghost-fade twins alone were about a sixth of the corpus link time |

## The run-time trap of a loop

A real loop is cheaper to COMPILE than unrolled copies, but on a weak GPU it can cost more to
RUN: every iteration pays the loop and a dynamic array read even when the slot does nothing,
where an unrolled copy behind a uniform test is almost free. On an Intel HD 530 (ANGLE D3D11),
a full-screen lit layer with 10 point-light slots and none live cost 22 percent more GPU time
as a plain loop. Packing the live lights into the first slots and stopping the loop at the
first dark slot made it cheaper than the unrolled copies in every measured case (0 to 10 live
lights, 10 and 7 slots), at the same link price as the plain loop. Rule: a loop that replaces
unrolled copies ends at the live count, and its GPU time is measured on the HD 530 class, not
only its link time.

## Suspected, not yet measured

General knowledge of fxc, unconfirmed on our programs. Ask for a measurement; do not flag them
as defects:

- implicit-gradient texture reads (`texture`) inside data-dependent flow, which force fxc to
  flatten or unroll the flow;
- procedural noise or hash stacks with many octaves;
- dynamic indexing of sampler arrays (expanded to a switch);
- compile warnings or failures: ANGLE retries a failed compile with other flags, so one
  program can pay two or three compiles (the warnings show in `chrome://gpu`);
- draw-time recompiles on D3D11 outside the link: a vertex attribute format that does not
  match the default input layout, integer attributes, a different render-target signature.

## How to measure

- Link time: harvest the programs the game links, then link each one repeatedly in a browser
  running ANGLE D3D11 on Windows, with the driver's shader disk cache disabled (a warm NVIDIA
  cache answers in about 5 ms and hides everything). Salt each program so the browser's own
  program cache cannot answer either. Compare before and after in ONE run: baselines drift
  between runs.
- Linux GL (Mesa or NVIDIA) links faster and gives the ORDERING of variants, never the score.
- GPU time: disjoint timer queries (`EXT_disjoint_timer_query_webgl2`) on a fixed scene at a
  fixed drawing-buffer size, arms interleaved across page loads, a control arm that repeats the
  baseline under another program key to read the noise.
