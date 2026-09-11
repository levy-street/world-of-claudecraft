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
    }
    const removedModule = ['camera', 'collision.ts'].join('_');
    expect(existsSync(path.join(__dirname, '..', 'src/render', removedModule))).toBe(false);
    expect(renderer).toContain(
      'let cx = px - Math.sin(pose.yaw) * Math.cos(pose.pitch) * camDist;',
    );
    expect(renderer).toContain(
      'let cy = Math.min(eyeY + Math.sin(pose.pitch) * camDist, underwaterCeilingY);',
    );
    expect(renderer).toContain(
      'let cz = pz - Math.cos(pose.yaw) * Math.cos(pose.pitch) * camDist;',
    );
    // In flooded flight the sphere is the only floor, so the terrain clamp stands
    // down there (renderer.ts bellBoomLimit); everywhere else it is the ground.
    expect(renderer).toContain(
      'this.camera.position.set(cx, dgFlying ? cy : Math.max(cy, groundY), cz);',
    );
    const chaseCamera = renderer.slice(
      renderer.indexOf('let camDist = pose.dist;'),
      renderer.indexOf('// Spatial-audio listener'),
    );
    // OBJECT obstruction stays opacity-only: no prop, tree or building may pull
    // the camera in. The ONE exception is a cave tube or carve cavity, whose
    // rock the camera would otherwise sit outside of (opacity cannot help — the
    // whole world is on the far side of it), so the distance may be clamped by
    // cameraSheetMaxDist and by nothing else. Assert exactly that shape: the
    // solve is written twice (the open-world pose, then the clamped one) and
    // every re-solve is inside the sheet branch.
    // Three writes: the open-world pose, the Deepglass bell's glass clamp
    // (bellBoomLimit: inside the sphere the camera may not poke through the
    // glass, the one other place the boom is allowed to shorten), and the
    // cave-sheet re-solve.
    expect(chaseCamera.match(/\bcamDist\s*=/g)).toHaveLength(3);
    expect(chaseCamera).toContain('bellBoomLimit(px, eyeY, pz, pose.yaw, pose.pitch)');
    expect(chaseCamera).toContain('const sheetMax = cameraSheetMaxDist(');
    expect(chaseCamera).toContain('if (sheetMax < camDist) {');
    expect(chaseCamera.match(/\bcx\s*=/g)).toHaveLength(2);
    expect(chaseCamera.match(/\bcy\s*=/g)).toHaveLength(2);
    expect(chaseCamera.match(/\bcz\s*=/g)).toHaveLength(2);
    expect(renderer).toContain('resolveCameraFov(this.camFovBase, this.camFeel)');
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
    ];
    for (const file of consumers) {
      const text = source(file);
      // Either the core's step (the instanced-ghost consumers and the raid
      // backface cull, whose trailing argument is the fade floor) or the
      // gated stepper over it (occluder_fade.ts advanceOccluderFade, the
      // fade painters); both take the flag after dt.
      expect(text, file).toMatch(/(?:step|advance)OccluderFade\([^)]+,\s*reducedMotion\s*[,)]/s);
    }
  });

  it('invalidates the scree placement grid after terrain and water rebuilds', () => {
    const renderer = source('src/render/renderer.ts');
    for (const method of ['rebuildTerrain', 'rebuildWater', 'rebuildWaterBodies']) {
      const start = renderer.indexOf(`${method}(`);
      expect(start, method).toBeGreaterThan(0);
      const body = renderer.slice(start, renderer.indexOf('\n  }', start));
      expect(body, method).toContain('this.cliffScree.invalidate();');
    }
  });
});
