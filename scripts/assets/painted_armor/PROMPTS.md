# Painted armour brushwork tile: prompt

`src/brush_strokes.png` is project-generated with ChatGPT image generation from a text prompt alone
(no reference image attached, no third-party imagery), on 2026-10-29, at 1254x1254. It is a
low-strength painterly overlay in the armour paint bake; every later step is recorded in the bake
script's header.

```text
Generate an image: a square seamless tileable brushwork texture for overlaying on hand-painted stylized game textures. Greyscale only (no colour), average value a calm mid grey. Subject: many soft, confident gouache and oil brush strokes of varied lengths and widths laid in many directions, some short dabs, some longer sweeps, slightly lighter and darker than the mid grey, with soft painterly edges and a faint dry-brush texture inside some strokes. Even, evenly distributed coverage across the whole square, low contrast, no single dominant stroke, no shapes, no objects, no text, no watermark, no vignette, no gradient across the image. All four edges must tile seamlessly with each other.
```

# Armour repaint: prompts

Every `src/repaint/<set>.png` (all nine classes, both bodies) is project-generated with ChatGPT image
editing on 2026-10-29. Each input was the project's own painted colour atlas for that set (the
composite of `paint_armor.mjs`, gutters blacked out), sent as its left and right 1024 x 1024 halves,
with no other image attached; each came back at 1254 x 1254. `repaint_armor.py register` resized each
half back, registered it onto its half (an affine fit plus a stiff residual on the island outlines) and
wrote the registered repaint with its confidence as alpha; `composite_armor.py` blends it over the bake.
The warriors came first: both male halves and the female right half used the first prompt, the female
left half (her tightly packed islands drifted on the first try) the second, whose result registered
closer. The other sixteen sets used the third, which words the materials for cloth and leather sets
too. The rogue and warlock atlases are so dark that the model could not tell their pieces from the
black gutters, so they were sent lifted (every island value raised to a power under 1, gutters still
black) and `repaint_armor.py register --gamma` brought each registered repaint back down by the
inverse power.

```text
Make this exact image but give it a hand-painted look. This is a UV texture atlas for a 3D fantasy armor model, so every piece must stay exactly where it is: same shapes, same outlines, same size, same position, same framing. Nothing moved, rotated, cropped, added or removed, and keep the black background plain black. Only repaint the surface inside each piece in a stylised hand-painted fantasy game texture style: visible confident brush strokes, painted steel with crisp warm highlights along plate edges, rivets and trim, cool painted shadows, subtle painted scratches and wear, brushy painted leather and cloth. Keep each piece's colours and its light and dark areas as they are. Square image, no text.
```

```text
Make this exact image but give it a hand-painted look. It is a UV texture atlas for a 3D fantasy armor model and the layout is fixed: trace every piece's outline exactly as it is, pixel for pixel, at the same size and position. Do not merge, split, move, resize or invent pieces, keep the many small pieces small and separate, and keep the black background plain black between them. Only repaint inside each outline in a stylised hand-painted fantasy game texture style: confident brush strokes, painted steel with crisp warm highlights along plate edges, rivets and trim, cool painted shadows, subtle painted scratches and wear, brushy painted leather and cloth. Keep each piece's colours and its light and dark areas as they are. Square image, no text.
```

```text
Make this exact image but give it a hand-painted look. It is a UV texture atlas for a 3D fantasy armor model and the layout is fixed: trace every piece's outline exactly as it is, pixel for pixel, at the same size and position. Do not merge, split, move, resize or invent pieces, keep the many small pieces small and separate, and keep the black background plain black between them. Only repaint inside each outline in a stylised hand-painted fantasy game texture style: confident brush strokes; painted metal with crisp warm highlights along edges, rivets and trim and subtle scratches and wear; brushy painted cloth with soft painted folds; painted leather with worn edges; cool painted shadows. Keep each piece's colours and its light and dark areas as they are. Square image, no text.
```
