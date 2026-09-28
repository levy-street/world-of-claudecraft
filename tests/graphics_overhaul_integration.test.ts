import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('graphics-overhaul integration', () => {
  // Outdoors, object obstruction is opacity-only and the chase camera never changes its
  // distance for scene geometry; the one scoped exception (authored interiors) is pinned in the
  // next two tests.
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
    const chaseStart = renderer.indexOf('const px = pose.x + shoulder.x;');
    const chaseEnd = renderer.indexOf('// Spatial-audio listener');
    expect(chaseStart).toBeGreaterThan(0);
    expect(chaseEnd).toBeGreaterThan(chaseStart);
    const chaseCamera = renderer.slice(chaseStart, chaseEnd);
    expect(chaseCamera).not.toMatch(/pose\.dist\s*[-+*/]?=/);
    expect(chaseCamera.match(/\bconst cx =/g)).toHaveLength(1);
    expect(chaseCamera.match(/\bconst cy =/g)).toHaveLength(1);
    expect(chaseCamera.match(/\bconst cz =/g)).toHaveLength(1);
    expect(renderer).toContain('resolveCameraFov(this.baseFov, this.camFeel)');
  });

  // THE ONE EXCEPTION: an authored walk-in interior (a building that registers its air with
  // src/render/interior_camera.ts, the Mirefen tavern today) keeps the drawn camera inside
  // that air while the player's eye stands in it, the classic MMO indoor camera. It is scoped
  // to registered interiors only: outdoors nothing pulls in (pinned by behaviour below and in
  // tests/interior_camera.test.ts), the requested distance (pose.dist, camDist) is never
  // written, and the clamp runs once, after the one pose assignment, before the one aim.
  it('clamps the drawn camera only inside an authored interior, after the one pose', () => {
    const renderer = source('src/render/renderer.ts');
    const chaseStart = renderer.indexOf('const px = pose.x + shoulder.x;');
    const chaseEnd = renderer.indexOf('// Spatial-audio listener');
    const chaseCamera = renderer.slice(chaseStart, chaseEnd);
    const pose = chaseCamera.indexOf('this.camera.position.set(cx, Math.max(cy, groundY), cz);');
    const clamp = chaseCamera.indexOf(
      'interiorCam.clampChaseCameraToInterior(this.camera, this.cameraLookAt, selfPos, dt, reduce);',
    );
    const aim = chaseCamera.indexOf('lookAtFrozen(this.camera, this.cameraLookAt);');
    expect(pose).toBeGreaterThan(0);
    expect(clamp).toBeGreaterThan(pose);
    expect(aim).toBeGreaterThan(clamp);
    expect(renderer.match(/interiorCam\.clampChaseCameraToInterior\(/g)).toHaveLength(1);
    // the draw-time re-check wraps the draw once, restored before the shakes undo
    const constrain = renderer.indexOf('interiorCam.constrainInteriorCameraDraw(this.camera);');
    const present = renderer.indexOf('if (presentFrame(host, dt, present))');
    const restore = renderer.indexOf('interiorCam.restoreInteriorCameraDraw(this.camera);');
    const unshake = renderer.indexOf('this.camera.position.x -= shakeX;');
    expect(renderer.match(/interiorCam\.constrainInteriorCameraDraw\(/g)).toHaveLength(1);
    expect(renderer.match(/interiorCam\.restoreInteriorCameraDraw\(/g)).toHaveLength(1);
    expect(constrain).toBeGreaterThan(renderer.indexOf('this.camera.position.x += shakeX;'));
    expect(present).toBeGreaterThan(constrain);
    expect(restore).toBeGreaterThan(present);
    expect(unshake).toBeGreaterThan(restore);
    expect(source('src/render/interior_camera.ts')).not.toMatch(/camDist|pose\.dist/);
  });

  it('leaves the chase camera exactly where the pose put it outdoors', async () => {
    const THREE = await import('three');
    const { clampChaseCameraToInterior, interiorCameraInternalsForTest, registerCameraInterior } =
      await import('../src/render/interior_camera');
    const { mirefenTavernCameraInterior } = await import(
      '../src/render/mirefen_tavern_interior_core'
    );
    const { tavernToWorld, TAVERN_FLOOR_Y } = await import('../src/sim/content/mirefen_tavern');
    interiorCameraInternalsForTest.reset();
    // the tavern's air registered, as in the live world: a player OUTSIDE it (on the road,
    // on the porch, in the doorway's thickness, behind its back wall) keeps the pose to the
    // bit, even with the boom running straight through the building
    registerCameraInterior(mirefenTavernCameraInterior());
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
    const poses: [number, number, [number, number, number]][] = [
      [0, 24, [0, 9, -2]], // on the road, the camera over the hall
      [0, 15.5, [0, 5, 4]], // on the porch, the camera in the room
      [0, 13.6, [0, 6, -6]], // in the doorway's thickness
      [-20, 0, [12, 8, 0]], // behind the side wall, the boom through the hall
    ];
    for (const [lx, lz, [cx, cy, cz]] of poses) {
      const self = tavernToWorld(lx, lz);
      const cam = tavernToWorld(cx, cz);
      const feet = TAVERN_FLOOR_Y;
      camera.position.set(cam.x, TAVERN_FLOOR_Y + cy, cam.z);
      const before = camera.position.toArray();
      const look = new THREE.Vector3(self.x, feet + 2, self.z);
      clampChaseCameraToInterior(
        camera,
        look,
        new THREE.Vector3(self.x, feet, self.z),
        1 / 60,
        true,
      );
      expect(camera.position.toArray(), `${lx}, ${lz}`).toEqual(before);
      expect(look.toArray()).toEqual([self.x, feet + 2, self.z]);
    }
    // ...and with nothing registered, anywhere at all
    interiorCameraInternalsForTest.reset();
    for (const [x, y, z] of [
      [10, 4, -30],
      [-400, 12, 90],
      [3.25, 0.5, 7.125],
    ]) {
      camera.position.set(x, y, z);
      const look = new THREE.Vector3(x + 3, y - 1, z + 4);
      const self = new THREE.Vector3(x + 3, y - 3, z + 4);
      clampChaseCameraToInterior(camera, look, self, 1 / 60, false);
      expect(camera.position.toArray()).toEqual([x, y, z]);
      expect(look.toArray()).toEqual([x + 3, y - 1, z + 4]);
    }
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
      // the Mirefen tavern's walk-in cutaway (the same per-part shell fade)
      'src/render/mirefen_tavern.ts',
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
    const renderer = source('src/render/renderer.ts');
    for (const method of ['rebuildTerrain', 'rebuildWater', 'rebuildWaterBodies']) {
      const start = renderer.indexOf(`${method}(`);
      expect(start, method).toBeGreaterThan(0);
      const body = renderer.slice(start, renderer.indexOf('\n  }', start));
      expect(body, method).toContain('this.cliffScree.invalidate();');
    }
  });
});
