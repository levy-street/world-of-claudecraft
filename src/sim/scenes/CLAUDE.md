<!-- src/sim/scenes/: deterministic scene authoring and playback. Root and
     src/sim/CLAUDE.md carry the shared simulation rules. -->

# src/sim/scenes/: cinematic authoring and playback

The canonical authoring and review loop is
`docs/design/cinematics-workflow.md`.

## Authoring rules

- **Builder-only definitions.** Create or change scenes with `buildScene` from
  `authoring.ts`. Use `beat`, `coveredCut`, and `fadeInTail` for authored timing
  and cuts. Register the emitted plain `SceneDef` with `registerScene`; do not
  hand-build a parallel timeline shape.
- **Keep cues and directives typed.** Prop cues use `LastBellPropCueId`, and
  music ops use `SceneMusicDirective` through `SceneOpDef`. Do not widen either
  surface to `string` or cast around a compiler error.
- **Name intended subjects.** Set `subjectRef` on a camera shot when the
  composition intends a named presentation fixture or entity. Use the stable
  fixture, entity, or ship target id that the shot linter can resolve near the
  authored look-at.
- **Keep the registry declarative.** `registry.ts` remains free of `Sim` and
  runtime imports. Content modules register uniquely named scenes at module
  evaluation with `registerScene(buildScene(...))`, and campaign code triggers
  every registered production scene so the orphan check stays green.

## Local checks

```sh
npx tsc --noEmit
npx vitest tests/cinematic_shots.test.ts
npx vitest run tests/scene_authoring_builder.test.ts tests/scene_authoring_types.test.ts
npx vitest run tests/scene_lifecycle.test.ts
```
