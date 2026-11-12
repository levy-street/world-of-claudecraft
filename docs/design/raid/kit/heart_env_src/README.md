# The Ring's and the Heart's painted pass: sources

The owner's ask (2026-11-11): "do the rest of the environments", the Ring (the hub the four
veins leave) and the Heart (the final room), reusing the four veins' painted kits ("with the
last environment it's all the elements combined, so we can reuse"): no new model. Then a
four-way sky, "each of the 4 sections a bit different, a blend in the middle", made in
ChatGPT. Everything here is a ChatGPT image as WebP; the full-size images stay local
(`tmp/env_rest/`). Design: `docs/design/raid/smith_heart.md` section 5.26.

## The concepts

Each its own ChatGPT chat: an in-game screenshot attached with the earth room's arena concept
as the style, asked to keep the camera and layout and make it a far richer version.

- `concept/hv_ring_concept.webp`: the Ring. Each quarter of the mountain round it its vein's
  cliffs (basalt and molten left, glacier right, golden quarry behind the stair), the ring a
  pale worn stone paving, four standing stones with glowing runes in the elements' colours,
  mist in the pit, a dusky sky.
- `concept/hv_heart_concept.webp`: the Heart. Behind each landmark, out of the chasm, the
  great cliffs of its element meeting in a crown open to an ember-violet sky.

> Generate an image: repaint the first attached image, an in-game screenshot of a raid hub,
> as a polished 16:9 concept painting for a stylised fantasy MMO, in exactly the hand-painted
> style of the second attached image (thick painterly strokes, chunky faceted shapes,
> stylised low detail, readable big value groups). Keep the SAME camera, framing and layout
> exactly ... Make it a far better, richer hub where four elemental veins of the mountain
> meet ... Add four tall carved standing stones round the ring, each with a glowing rune in
> one element's colour (orange, ice blue, gold, storm violet), and soft drifting mist in the
> pit. A dusky sky with clouds. No characters, no creatures, no text, no UI.

The Heart's chat asked the same of a screenshot of the Anvil, keeping its floor, well and
four landmarks: "behind each landmark, rising out of the dark chasm all round the floating
floor, raise great painted cliffs of that landmark's element ... the four cliffs meeting in a
towering crown open at the top to a deep ember-violet sky".

## The skies

- `sky/hv_four_sky.webp` (shipped as `public/env/smith_heart_four_sky.ktx2`, 1024 square,
  over the Heart): the whole sky seen straight up, the zenith in the middle, a quarter per
  element round it (north the Breath's storm, east the Quench's aurora, south the Hammer's
  golden dust, west the Heat's ember smoke), all four swirling together overhead.

  > Create an image: a square 1:1 painting of a night sky seen looking straight up, like a
  > circular fisheye view of the whole sky dome from the floor of a deep crater. The zenith
  > is exactly in the centre of the image and the horizon runs round the edge of a circle
  > that touches all four edges of the square ... The sky is split into four quarters that
  > each feel clearly different, blending softly into each other along the diagonals, and
  > all four swirl together and mix in the middle (the zenith) into a deep ember-violet
  > night full of small stars ... TOP quarter: a stormy night ... RIGHT quarter: a clear
  > cold night ... aurora ribbons ... BOTTOM quarter: a warm golden night ... LEFT quarter:
  > a smoky ember night ... rich colour but dark values overall.

- `sky/hv_ring_sky.webp` (shipped as `public/env/smith_heart_ring_sky.ktx2`, 2048 by 1024,
  over the Ring and the rest of the main map): seen low from the Ring the fisheye painting
  read as "blobs" and too colourful; a muted grey panorama was rejected ("needs to be way
  better and more aligned with the previous one"); this is ChatGPT's repaint of the fisheye
  painting (attached) as a horizon panorama with a sky's own perspective, the same four skies
  left to right gold, ember, storm, aurora, gold again at the seam.

  > Create an image: repaint the attached sky as a wide 2:1 landscape panorama of the same
  > sky seen from the ground, looking out at the horizon all the way round, seamless from its
  > left edge to its right edge ... Keep the attached painting's exact style ... and the same
  > four clearly different skies ... But give it real sky perspective: a soft hazy horizon
  > line along the very bottom, smaller and flatter clouds and streaks crowding down near the
  > horizon, the bigger billowing clouds higher up, and across the whole top band all four
  > blend into the attached image's middle ... Same colours as the attached image, only a
  > little less saturated and a little deeper in value, so it never looks neon.

## Rebuild

The fisheye is resized to 1024 square; the panorama's last 8 percent of columns is folded
over its first (a cross-fade from the right edge into the left, the ice sky's step), then it
is resized to 2048 by 1024. Both encode to UASTC KTX2 with mips:

```bash
ktx create --format R8G8B8_SRGB --encode uastc --uastc-quality 2 --zstd 18 --generate-mipmap --assign-tf srgb <in.png> public/env/smith_heart_four_sky.ktx2
node scripts/build_media_manifest.mjs generate
```

The dome takes both well under the paintings' own colour (`heart_four_sky.ts`
`HEART_FOUR_SKY`, `HEART_RING_SKY`: the owner's "less colourful"; the game's grade gives some
saturation back).
