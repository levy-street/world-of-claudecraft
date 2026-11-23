# Scenery distance bands

Production port of the selected scenery experiment in
`scripts/lib/scenery_quality_experiment.mjs`. The saved experiment is the
behavior and throughput reference, not an import dependency of the client.

- Full-detail culling and cheap replacement populations are one policy. Never
  replace this with simplification that keeps the original distant population.
- Whole placements own zone scenery boundaries; foliage follows its authored
  origin-distance shader. Near scenery, actors and gameplay remain intact.
- Replacements batch by material. Low uses the selected prototype's Lambert
  replacements with source maps and alpha cutouts. Preserve source material
  hooks, textures and lighting on Medium and above.
- Prepare geometry and GPU resources through the existing scheduler and reveal
  gates. Dispose owned resources without disposing borrowed source resources.
- Expose the renderer adapter through `index.ts`; keep policy, collection,
  geometry, batching and atlas ownership in small independently tested modules.
