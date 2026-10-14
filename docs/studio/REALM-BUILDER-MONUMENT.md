# Realm Builder of the Month monument

Replaces Eastbrook Vale's civic well beacon with a statue of a builder whose two
honour plates project the current honouree's name in gold, and which opens an
honour roll when inspected.

## What a player sees

- The square's centrepiece is a 7.6 yard statue on a tiered plinth, four
  lanterns on its outrigger ring, an honour plate on the front and back. It is
  the tallest thing in the square by a long way.
- It keeps the sculpt's own carved stone. The hammer head and the tablet glow
  gold, lit from within over that same stone.
- The current honouree's name floats in gold off each plate, on a projector
  shaft rising from the plate itself: scanlines, a slow sweep climbing the
  panel, and a two-rate flicker. The front plate faces the east arrival lane, so
  the name is the first side you meet walking in.
- The lanterns carry a pulsing halo and rising embers, each on its own phase so
  the ring never blinks in unison.
- Clicking the monument (or pressing the interact key beside it) opens the
  honour roll: who is honoured this month, and everyone honoured before.

## Who is honoured, and who decides

Admins own the roll from the dashboard: **Content > Realm Builders**, behind the
`content.moderate` grant the other public-content pages already use. The page
shows this month's honouree, a form to name the next one (with a "use next
month" button that steps past the newest entry), and the past roll with edit and
remove.

The plumbing, top to bottom:

```
admin dashboard  -> POST /admin/api/realm-builders      (content.moderate)
                 -> realm_builder_honours               (one row per realm/month)
                 -> publishRealmBuilderRoll()           (server, on boot AND every write)
                 -> setRealmBuilderRoll()               (sim)
                 -> the realmBuilder inspect event      (the card)
online client    -> GET /api/realm-builder              (public, on world load)
                 -> setRealmBuilderRoll() + re-bake     (the gold projection)
```

**Every write republishes.** The sim's copy moves the moment an operator saves,
so the statue names the new builder without a server restart. Clients already in
the world pick the change up on their next connect; the read is on the world-load
path, not a poll.

`src/sim/content/realm_builders.ts` still ships the placeholder (`Your Name
Here`, an empty past roll) and the card still says so in as many words. It is
what an **offline** browser world shows, what a realm that has never named
anybody shows, and what a failed or missing `/api/realm-builder` read leaves
standing. `src/net/realm_builder_roll.ts` fails quiet on every path for exactly
that reason: a slow endpoint must never hold a player out of the world, so the
call is not awaited.

That override is the only sim state that comes from outside the world. It is
safe because nothing reads it but the inspect event: it decides no outcome,
moves no entity, and draws no rng. Keep it that way.

**For a Discord hookup**, write into `realm_builder_honours` and call
`publishRealmBuilderRoll()`. Nothing on the client or in the sim needs to know
where the name came from.

## Where the pieces live

| Piece | File |
|---|---|
| Who is honoured | `src/sim/content/realm_builders.ts` |
| Placement, collider, bench ring | `src/sim/eastbrook_layout.ts` (`civic.monument`) |
| Inspect interaction | `src/sim/interaction.ts` (`pickUpObject`) |
| Honour-roll card | `src/ui/realm_builder_popup.ts` + `hudChrome.realmBuilder.*` |
| Body, projections, lantern light | `src/render/realm_builder_monument_fx.ts` (+ its `_core`) |
| Statue art | `public/models/props/eastbrook_realm_builder_monument.glb` |
| Distance impostor | `public/textures/props/eastbrook_realm_builder_impostor.webp` |
| Sculpt export | `scripts/assets/realm_builder_monument.py` (Blender) |
| SQL boundary | `server/realm_builder_db.ts` |
| API + republish | `server/realm_builder.ts` |
| Client read | `src/net/realm_builder_roll.ts` |
| Admin page | `src/admin/pages/RealmBuilders.svelte` + `src/admin/realm_builders.ts` |

## Why this one is not a town micro-batch asset

Every other Eastbrook civic prop ships as flat town-palette vertex colours and
merges into one batch that picks a surface from a shared atlas. The monument
tried that twice and the owner rejected both: the batch also forced a 45 percent
collapse decimation, and between the two the beard and face went to putty and
the carved stone read as putty-coloured shape.

So it keeps its baked albedo, which a merged vertex-colour batch cannot hold,
and draws as its own textured prop through the same `keepsOwnMaterials` path the
KTX2 kit buildings already use. Its `COLOR_0` still does work: glTF multiplies
`baseColorFactor x baseColorTexture x COLOR_0`, so a per-vertex TINT paints the
plaque's dark plate and gold frame straight over the albedo with no second image
and no second UV set.

Two consequences worth knowing:

- `eastbrook_civic_beacon.ts` is **deleted**. It animated the well beacon's
  floating crystal inside the merged emissive batch; with the crystal gone and
  the monument out of the batch, its mask selected nothing at all.
- The town's triangle **target** moved 30,000 to 33,000 to pay for the full
  sculpt. The 40,000 hard ceiling did not move.

## Costs, and what falls away with distance

- Body: three draws (surface, gold tools, flame cores), 5,923 triangles, one
  1024px WebP albedo.
- Effects: two name panels, two beams, one halo sheet, plus an ember Points
  cloud above the low effects tier. All `uTime`-driven, so `update()` writes one
  uniform and nothing else per frame.
- Town runtime budget: 32,275 against the 33,000 target.

Three distance tiers, all in `monumentLodPlan` (`..._fx_core.ts`) so the policy
is testable without a renderer:

| Distance | What draws |
|---|---|
| under 48 yd | full body, projections, halos, embers, tool sparkle |
| 48 to 72 yd | full body, no effects at all |
| beyond 72 yd | one billboarded impostor quad |

The impostor is an 8-angle atlas (1280x640, eight 320px cells) baked from the
same sculpt, Y-axis billboarded and alpha-TESTED rather than blended so it needs
no sort. Its alpha came from black-and-white render pairs: `A = 1 - (Cw - Cb)`,
`C = Cb / A`.

One trap worth keeping: if the atlas has not loaded yet, the body must keep
drawing at every distance, or the square gets a hole where the statue is. That
is `const showBody = plan.body || impostor === null` in `setLod`, and a test
holds it.

## Sizing, and what it cost the square

The statue is deliberately large and the square is now full. Numbers to know
before moving anything:

- The collider is 3.19, the sculpt's own widest ring (the lantern outriggers)
  rounded up by a centimetre.
- The bench ring is at **4.1, its hard maximum**. The southwest road's last
  centreline sample sits at (-9, -100.4) and the west bench has to stay 1.5
  yards off it, which caps the ring at 4.12. That leaves about 0.6 yards
  between a bench back and the plinth.
- Two polish capture aims and one route-proof start point had to move off the
  middle of the square, because the middle of the square is now the statue.
- `civic.ring` (radius 4.75) is overlapped and that is fine: nothing reads it
  for collision or drawing, only a layout-suite pin.

## Known follow-ups

- **In-game screenshots for the PR body are not captured yet.** The monument,
  the projection and the card were all verified in a live offline session at the
  earlier size, but the Browser pane cannot reliably re-enter the world to shoot
  clean before/after plates. Capture them from a normal browser.
- **Not verified live since the rework:** the doubled size, the textured
  surface, the pulsing/sparkling tools, the distance impostor, click-to-inspect,
  and the admin page end to end against a real Postgres. All are covered by
  tests; none has been looked at in the running game.
- **The projector shaft is deliberately faint** (peak alpha 0.30). If the name
  reads as floating rather than projected, raise `alpha` in `BEAM_FRAGMENT`.
- The Eastbrook polish capture archive still shows the OLD square. That is on
  purpose (its metadata is frozen evidence of captures already taken); retaking
  it is its own change. The provenance pins HAVE been re-minted for both this
  round and the last; if any of `renderer.ts`, `eastbrook_town.ts` or
  `realm_builder_monument_fx.ts` moves again, re-run
  `scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs` LAST,
  after biome, and commit exactly those bytes.
