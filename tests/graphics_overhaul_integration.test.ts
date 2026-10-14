import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('graphics-overhaul integration', () => {
  it('keeps object obstruction opacity-only and never changes chase-camera distance', () => {
    const renderer = source('src/render/renderer.ts');
    const colliders = source('src/sim/colliders.ts');
    // The boom march moved out of colliders.ts; scan its new home too.
    const boomMarch = source('src/sim/colliders_authored/camera_boom.ts');

    const obsoleteParts: Array<[string[], string]> = [
      [['camera', 'Occlusion'], ''],
      [['Camera', 'OcclusionState'], ''],
      [['stepCamera', 'Occlusion'], ''],
      [['cam', 'Occlusion'], ''],
      [['CAMERA', 'COLLIDER_PAD'], '_'],
      [['CAMERA_SOFT', 'COLLIDER_PAD'], '_'],
      [['CAMERA', 'MIN_DIST'], '_'],
      [['CAMERA', 'PULL_IN_RATE'], '_'],
      [['CAMERA', 'PULL_OUT_RATE'], '_'],
      [['CAMERA_SOFT', 'PULL_WEIGHT'], '_'],
      [['CAMERA_MAX', 'COMP_FOV'], '_'],
    ];
    const obsolete = obsoleteParts.map(([parts, separator]) => parts.join(separator));
    for (const identifier of obsolete) {
      expect(renderer, identifier).not.toContain(identifier);
      expect(colliders, identifier).not.toContain(identifier);
      expect(boomMarch, identifier).not.toContain(identifier);
    }
    const removedModule = ['camera', 'collision.ts'].join('_');
    expect(existsSync(path.join(__dirname, '..', 'src/render', removedModule))).toBe(false);
    // The open-world seat orbits at the requested distance: on the BUILT-IN
    // world nothing in the scene changes it (release behaviour), and the
    // terrain clamp is the height-blind groundHeight.
    expect(renderer).toContain(
      'let cx = px - Math.sin(pose.yaw) * Math.cos(pose.pitch) * pose.dist;',
    );
    expect(renderer).toContain(
      'let cy = Math.min(eyeY + Math.sin(pose.pitch) * pose.dist, underwaterCeilingY);',
    );
    expect(renderer).toContain(
      'let cz = pz - Math.cos(pose.yaw) * Math.cos(pose.pitch) * pose.dist;',
    );
    // In flooded flight the sphere is the only floor, so the terrain clamp stands
    // down there (bellBoomLimit); everywhere else it is the ground.
    expect(renderer).toContain(
      'this.camera.position.set(cx, dgFlying ? cy : Math.max(cy, groundY), cz);',
    );
    const chaseStart = renderer.indexOf('const px = pose.x + shoulder.x;');
    const chaseEnd = renderer.indexOf('// Spatial-audio listener');
    expect(chaseStart).toBeGreaterThan(0);
    expect(chaseEnd).toBeGreaterThan(chaseStart);
    const chaseCamera = renderer.slice(chaseStart, chaseEnd);
    expect(chaseCamera).not.toMatch(/pose\.dist\s*[-+*/]?=/);
    // The boom only shortens on an AUTHORED map (or in the Deepglass bell), in
    // ONE gated branch: the bell's glass, the rock of a cave tube or carve
    // cavity, and a placed asset's collider (SPACEY, 2026-09-19: "make the camera
    // work with our assets colliion just like the terrain"). The solve lives in
    // authored_map/chase_boom_core.ts; the built-in world never enters it.
    expect(chaseCamera).toMatch(
      /if \(isBuiltinWorldActive\(\)\) \{\s*groundY = groundHeight\(cx, cz, seed\) \+ 0\.6;\s*\} else \{/,
    );
    expect(chaseCamera).toContain('const seat = solveChaseBoom(');
    // The look-up dolly (pitch / CAM_PITCH_UP) is part of the authored solve
    // only: the renderer never shortens the built-in boom by pitch.
    expect(chaseCamera).not.toContain('CAM_PITCH_UP');
    expect(chaseCamera).not.toContain('lookUpDollyDist');
    expect(source('src/render/authored_map/chase_boom_core.ts')).toContain(
      'if (!i.flying) camDist = lookUpDollyDist(camDist, i.pitch, i.pitchUp);',
    );
    expect(chaseCamera).toContain(
      'groundY = authoredChaseGroundY(seed, cx, cz, px, py, pz, eyeY);',
    );
    expect(chaseCamera.match(/\bcx\s*=/g)).toHaveLength(2);
    expect(chaseCamera.match(/\bcy\s*=/g)).toHaveLength(2);
    expect(chaseCamera.match(/\bcz\s*=/g)).toHaveLength(2);
    const boom = source('src/render/authored_map/chase_boom_core.ts');
    expect(boom).toContain('bellBoomLimit(i.px, i.eyeY, i.pz, i.yaw, i.pitch)');
    expect(boom).toContain('const sheetMax = cameraSheetMaxDist(');
    expect(boom).toContain(
      'cameraBoomMaxDist(i.seed, i.px, i.eyeY, i.pz, out.x, out.y, out.z, 0.3)',
    );
    expect(boom).toContain('const boomMax = Math.min(sheetMax, out.solidLimit);');
    expect(renderer).toContain('resolveCameraFov(this.camFovBase, this.camFeel)');
  });

  it('hands the occluder fades and ambience the avatar eye, not the Action Cam aim', () => {
    const renderer = source('src/render/renderer.ts');
    const tail = renderer.slice(
      renderer.indexOf('lookAtFrozen(this.camera, this.cameraLookAt);\n    // Later readers'),
      renderer.indexOf('sink.ambience('),
    );
    // After the one aim, cameraLookAt is reset to the un-shifted avatar eye,
    // and the ambience is sampled there, never at the shifted pivot.
    expect(tail).toContain(
      'this.cameraLookAt.set(px - shoulder.x, eyeY + shoulder.drop, pz - shoulder.z);',
    );
    expect(tail).toContain('sampleAmbienceInto(this.ambience, eye.x, eye.z, seed, this.weatherOn)');
    expect(tail).not.toMatch(/zoneBiomeAt\(px|sampleAmbienceInto\([^)]*\bpx\b/);
  });

  it('routes reduced motion through every occluder-fade consumer', () => {
    const consumers = [
      'src/render/props.ts',
      'src/render/tree_hide_fade.ts',
      // dungeon.ts's occluder loop moved to dungeon_wall_occlusion.ts (the
      // raid backface cull); the pin follows the consumer.
      'src/render/dungeon_wall_occlusion.ts',
      'src/render/eastbrook_town.ts',
      'src/render/yumi_maze.ts',
      'src/render/battleground_placements.ts',
      // the Harbormaster's House walk-in cutaway (the shell's per-part fade)
      'src/render/wyrmwatch_harbor_house.ts',
    ];
    for (const file of consumers) {
      const text = source(file);
      // The core's step (the raid backface cull, whose trailing argument is
      // the fade floor), the gated stepper over it (occluder_fade.ts
      // advanceOccluderFade, the fade painters), or the ghost pool's step (the
      // instanced-ghost consumers); all take the flag after dt.
      expect(text, file).toMatch(
        /(?:(?:step|advance)OccluderFade|[gG]hosts\.step)\([^)]+,\s*reducedMotion\s*[,)]/s,
      );
    }
    // The pool's step is the core's, and the dithered style restores in one
    // step the way reduced motion does.
    expect(source('src/render/instanced_occluder_ghosts.ts')).toContain(
      'stepOccluderFade(alpha, occluded, dt, reducedMotion || this.dithered)',
    );
  });

  it('invalidates the scree placement grid after terrain and water rebuilds', () => {
    // the rebuild hooks live on the renderer's editor facade (renderer.editor)
    const facade = source('src/render/editor_api/editor_api.ts');
    for (const method of ['rebuildTerrain', 'rebuildWater', 'rebuildWaterBodies']) {
      const start = facade.indexOf(`  ${method}(`);
      expect(start, method).toBeGreaterThan(0);
      const body = facade.slice(start, facade.indexOf('\n  }', start));
      expect(body, method).toContain('h.cliffScree().invalidate();');
    }
  });
});
