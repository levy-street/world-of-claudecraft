# The Quench's bodies: sources

The Quench Vein Warder and the Quench Vein Caller (`public/models/creatures/heart_quench_warder.glb`,
`heart_quench_caller.glb`, design doc section 1's body rows). `qv_sheet_warder.webp` and
`qv_sheet_caller.webp` are the ChatGPT turnaround sheets they were built from, as WebP. The Tripo builds,
the Blender files, the repainted atlases and the rig and clip scripts stay local (`tmp/quench_mobs/`,
`tmp/heart_quench_warder/`, `tmp/heart_quench_caller/`), like the Hammer's warder, the Slabwright and the
Seam Singer.

| Mob | Sheet | Tripo P2 task | Face limit | Credits |
|---|---|---|---|---|
| Quench Vein Warder | `qv_sheet_warder.webp` | `a403dcd8-290a-49b4-b03d-4e28ef04a0c2` | 5000 | 110 |
| Quench Vein Caller | `qv_sheet_caller.webp` | `72d7a71f-485d-4ec7-9a31-41c5ddc9ba57` | 5000 | 110 |

## The sheets

One new ChatGPT chat each, three images attached: the earth warder's sheet (the Warder) or the Seam
Singer's (the Caller) for the body plan and the painted style, the Quench's ice sword sheet
(`../quench_env_src/sheets/qv_sheet_sword.webp`) for the ice, and the aurora concept
(`../quench_env_src/concept/qv_arena_aurora.webp`) for the night they must stand out against. The shared
opening:

> Generate an image: a three-view orthographic turnaround sheet of ONE game creature, in exactly the
> painted style of image 1 (thick painterly strokes, big chunky faceted forms, clean readable planes).
> Show the FRONT view, the LEFT side view and the BACK view, side by side from left to right, at one
> scale on one ground line, on a flat dark navy background with clear gaps between the views, no floor
> shadow, no labels, no text, orthographic with no perspective.

Then the subject: a hulking ICE golem on the stone golem's body plan, built of big faceted chunks of
bright glowing glacier ice like the swords (a glowing cyan crack line down each plate), ice crystal
spikes on its shoulders and back, jagged ice crystal fists, white snow caps where the earth warder has
moss, dark slate stone only at its joints, glowing white-cyan eyes and a cyan heart crystal; and a
floating hooded frost caster on the Singer's body plan, an ice hood and snow mantle over a dark slate
face with glowing eyes, a crown of ice shards behind the hood, slate bracers and belt, a frost orb over
each open palm, and a robe of ice shards tapering to a point. Both close on the same line: it "must POP"
against the dark slate and teal night, bright, luminous, saturated, nothing dull or grey. Both sheets
came back first try. Each draws a true LEFT profile (facing image-left), so the split views went to
Tripo as front, left and back (the colossi's sheets draw the right side instead).

## The bodies

1. Tripo P2 multiview, 5000 faces, then faced to -Y, 2.2 tall, its lowest point on the floor, welded.
2. Cut into plates (the warder's `segment.py`), each plate one upright UV island; the Tripo paint carried
   across with ambient occlusion and facet light into a guide.
3. ChatGPT repainted each guide in a new chat with the sheet attached ("Repaint image 1 as a finished
   hand-painted game texture in exactly the painted style and colours of image 2 ... Do not change the
   layout"). It painted the Caller's orb swirls onto two slate bracer pieces, which were graded back to
   slate island by island; the orb facets were painted in Blender.
4. A glow map from each painting: the bright saturated ice softly lit, the near-white cyan lines inside
   it (cracks, eyes, the heart crystal) and the orbs hot; snow and slate unlit.
   Both maps are then edge-padded from the mesh's own UV islands: ChatGPT leaves dark paint between the
   islands and the glow map is black there, and the texture filter, the mips and the ETC1S blocks pull
   that into a small island's edge (black lines along the seams of the small islands).
5. Rigged as rigid plates on one welded skin: every plate wholly on one bone, and only the vertices on
   a seam between two bones' plates shared by both (`tmp/quench_mobs/weld_bind.py`). They were first
   cut apart where two bones meet, the Slabwright's way, but a cut seam opens into a gap you can see
   through as the body moves (the owner's call: never split the model); welded, a seam gives a little
   in its crevice and never opens. The Warder now dies on its face whole and the Caller keeps its
   crown in death (nothing breaks off a welded skin; the Caller's orbs, separate pieces, still roll).
6. Clips on the earth bodies' pose engines (the Warder's legs on the earth warder's IK engine, the
   Caller on the Singer's float engine), every bone keyed in every clip, then
   `slim_rig_source.mjs`, `build_assets.mjs` and `compress_glb_textures.mjs` from the specs.

The Caller's frost orbs are icospheres modelled in Blender (Tripo dropped the sheet's flat swirls), each
on its own bone; its CastBolt scales them away into the bolt and back.
