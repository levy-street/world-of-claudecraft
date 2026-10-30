# Painted building tiles: prompts

The tiling sources in `src/` are project-generated with ChatGPT image generation (no third-party
imagery: text prompts, and for the shipped stone tile one of the project's own generated tiles as
the style reference), on 2026-10-29 and 2026-10-30, at 1254x1254.
`stone_wall.png` is re-baked into the walls atlases of the six Tidehold buildings Eastbrook stands,
after the bake script paints its light and simplifies it into brushwork; every later step is
recorded in the header of `rebake_walls.mjs`. A roof slate tile was generated too but never used
(the roofs' slate size was judged right and their atlases kept), so it is not committed; its prompt
is kept below for the record.

## `stone_wall.png`

The shipped tile (2026-10-30) is stylised dressed blocks of random length and colour, every block
laid flat in horizontal courses, in dark umber mortar. It came in two steps. A text prompt gave a
random ashlar tile whose painted style the owner liked but whose layout (tall blocks spanning two
courses, a square patchwork) did not read as a wall; that tile was then attached as the style
reference for the shipped one. Earlier tiles (the small cream-mortar fieldstone first shipped on
2026-10-29, a uniform block tile) were replaced at the owner's call for a stylised wall with
bigger stones. The tile already wraps, so the bake makes it seamless without a content cut
(`TILE_RECIPE.quiltPx` 0).

The style reference (text only):

```text
Generate an image: a square seamless tileable stone wall texture for a stylized fantasy game town building, straight-on front view of a flat wall (orthographic, no perspective). Hand-painted stylized game texture like a gouache painting with soft confident brush strokes, not photographic. Subject: random ashlar masonry with lots of variety: dressed stone blocks of clearly different sizes mixed together, some long wide blocks, some small square ones, a few tall blocks spanning two courses, a few small filler stones, courses of uneven height that step up and break, no two neighbouring blocks the same size, each block slightly irregular with soft rounded chipped corners. Varied colours from block to block: light warm grey, pale beige, sandy ochre, cool blue-grey and a few darker brown-grey stones, a couple with darker weathered stains and one or two with a hint of green moss along the bottom edge. Each block painted with a soft gradient (lighter warm top, slightly darker cooler bottom), light painted highlights on the top edges and a few short painted cracks. Recessed dark grey-brown mortar joints. Bold readable shapes, simple painted surfaces, very little fine noise. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient across the whole image. No windows, no wood, no objects, no text, no watermark. All four edges must tile seamlessly with each other.
```

The shipped tile (that image attached, nothing else):

```text
Make a new version of this stone wall texture. Keep this exact hand-painted style, colour palette and surface painting: the same warm beige, sandy ochre, cool blue-grey and brown-grey stones, the same soft painted weathering stains, chips, short cracks and the occasional small touch of moss, the same dark brown recessed mortar. Change only the layout: lay EVERY stone horizontally in neat horizontal courses with staggered joints (running bond), each stone a horizontal rectangle wider than it is tall, all lying the same way. No vertical or tall stones, no stones spanning two courses, no square patchwork. Keep it a bit random: stone lengths vary from short to long within each course, course heights vary slightly, colours are scattered at random. About 4 to 6 stones across the image width and 7 to 8 courses down. Straight-on front view, flat even lighting, no cast shadows, no vignette. Square image. All four edges must tile seamlessly with each other.
```

## Roof slate tile (not used, not committed)

```text
Generate an image: a square seamless tileable roof texture for a stylized dark-fantasy action RPG town building, straight-on view of a flat roof plane (orthographic, no perspective), slates running in horizontal overlapping rows. Hand-painted like a rich gouache and oil painting with confident visible brush strokes. Subject: small slightly irregular slate roof tiles (about 12 to 16 slates across the image width and 10 to 14 rows down), dark slate blue and blue-grey with a few warmer grey slates, a soft painted highlight along each slate's lower edge and a dark painted shadow line under it, a few chipped corners and a little moss and lichen. Imperfect and organic, rows slightly wavy, not a perfect grid. Painted, not photographic. Flat even overall lighting: no cast shadows across the image, no vignette, no bright spot, no gradient. No objects, no text, no watermark. All four edges must tile seamlessly with each other.
```
