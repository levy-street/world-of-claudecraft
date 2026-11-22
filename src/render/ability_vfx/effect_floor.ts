/** Where a ground effect should lie. `groundY` is the bare terrain, but bodies
 * also stand on docks, bridges, crates, dungeon floors and raised rift tiers;
 * an effect laid on the terrain beneath them is hidden by that surface.
 * The displayed feet are the visible floor, so they win when clearly higher. */
export const RAISED_FLOOR = 0.15;
export function effectFloor(terrain: number | undefined, feet: number | undefined): number {
  const standing = feet !== undefined && Number.isFinite(feet) ? feet : undefined;
  if (terrain === undefined || !Number.isFinite(terrain)) return standing ?? 0;
  if (standing === undefined) return terrain;
  return standing - terrain > RAISED_FLOOR ? standing : terrain;
}

/** View-space pull for ground-lying geometry, in yards. Moving a vertex toward
 * the camera along its own view ray keeps its screen position and only changes
 * its depth, so grass, plank seams and drape error between terrain samples no
 * longer swallow the effect, while walls and bodies still occlude it. */
export const GROUND_DEPTH_PULL = 0.4;
export const GROUND_DEPTH_PULL_GLSL = `
  vec4 groundPulledView(vec3 local, float pull) {
    vec4 view = modelViewMatrix * vec4(local, 1.0);
    float distance = max(length(view.xyz), 0.001);
    view.xyz *= max(0.05, 1.0 - pull / distance);
    return view;
  }
`;
