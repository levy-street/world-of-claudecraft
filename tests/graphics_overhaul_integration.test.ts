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
      'const cx = px - Math.sin(pose.yaw) * Math.cos(pose.pitch) * pose.dist;',
    );
    expect(renderer).toContain(
      'const cy = Math.min(eyeY + Math.sin(pose.pitch) * pose.dist, underwaterCeilingY);',
    );
    expect(renderer).toContain(
      'const cz = pz - Math.cos(pose.yaw) * Math.cos(pose.pitch) * pose.dist;',
    );
    expect(renderer).toContain('this.camera.position.set(cx, Math.max(cy, groundY), cz);');
    const chaseCamera = renderer.slice(
      renderer.indexOf('const px = this.camBoom.x + this.camFeel.leadX;'),
      renderer.indexOf('// Spatial-audio listener'),
    );
    expect(chaseCamera).not.toMatch(/pose\.dist\s*[-+*/]?=/);
    expect(chaseCamera.match(/\bconst cx =/g)).toHaveLength(1);
    expect(chaseCamera.match(/\bconst cy =/g)).toHaveLength(1);
    expect(chaseCamera.match(/\bconst cz =/g)).toHaveLength(1);
    expect(renderer).toContain('resolveCameraFov(this.baseFov, this.camFeel)');
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
