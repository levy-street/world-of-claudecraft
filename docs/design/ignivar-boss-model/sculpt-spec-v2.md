# Ignivar approved-turnaround sculpt specification v2

This specification turns the approved turnaround into a deterministic GLB contract. The
shipping model is judged against the reference image, not against the previous procedural
blockout.

## Identity-critical systems

- A broad, top-heavy humanoid silhouette with a width of at least 78 percent of the body
  height when the hanging arms are included.
- A visible basalt king face with brow, nose guard, jaw, two furnace eyes, and exactly three
  crown prongs. The center prong is tallest and every tip glows.
- A large open crucible in the upper chest. The white-hot interior must be the primary focal
  point, surrounded by a thick iron and burnt-bronze frame rather than a small circular light.
- Two layered shoulder pauldrons ending in real brazier bowls with multi-tongue flames.
- One oversized plated forge gauntlet and one visibly different magma arm made from separated
  basalt chunks over an emissive inner core.
- Heavy articulated boots, knee armour, belt, side skirts, and a long framed forge tabard.
- A barred furnace exhaust on the back so front and rear views remain distinct.

## Supporting systems

- Hammered iron and stone remain readable in dark dungeon lighting. Metal must not collapse to
  black when the environment map is dim.
- Burnt-bronze rims separate the major armour plates at gameplay distance.
- Emissive geometry is limited to the chest, eyes, crown tips, braziers, magma seams, boot vents,
  and rear furnace. It never casts an opaque shadow.
- Geometry uses chunky low-to-medium-poly forms with intentional bevels and faceted stone, not
  thin boxes standing in for the whole anatomy.

## Animation and runtime constraints

- Preserve the existing Idle, Walk, Run, Attack, Cast, Hit, Death, and Flourish clips.
- Preserve independent leg, forge-arm, magma-arm, chest-core, and shoulder-flame pivots.
- Preserve the three encounter VFX sockets at the chest and shoulders.
- Keep the optimized model textureless and meshopt-compressed. Visual fidelity takes priority
  over the old 16-primitive blockout budget, but the candidate must remain below 32 primitives,
  32,000 triangles, and 700 KiB.

## Approval gate

The candidate is not final until the project owner sees renders produced from the serialized
shipping GLB in front, side, back, and three-quarter views and explicitly approves it. Only then
is the final in-game capture and release QA performed.
# HIFI reconstruction reference

The approved turnaround is converted into `ignivar-hifi-input-v1.png` before paid
image-to-model reconstruction. That single-character reference preserves the approved
identity and asymmetry while removing the multi-view collage that can be misread as
several characters. It is an intermediate source artifact, not evidence of the shipped
mesh; approval must still use renders of the serialized GLB.
