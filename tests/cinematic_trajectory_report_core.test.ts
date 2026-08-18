import { describe, expect, it, vi } from 'vitest';
import { reportScene } from '../scripts/lib/cinematic_trajectory_report_core.mjs';
import {
  evaluateSceneRigPose,
  sceneRigCameraPosition,
  sceneRigLocalToWorld,
} from '../src/game/scene_rig_core';
import { composeHarborShipAttachFrame } from '../src/render/harbor_ship_attach_core';
import { propPathPoseAt } from '../src/render/prop_path_core';
import '../src/sim/content/last_bell_campaign';
import {
  LAST_BELL_PROP_PATH_SEGMENTS,
  LAST_BELL_VOYAGE_SEGMENT_IDS,
} from '../src/sim/content/last_bell_cinematics';
import { HARBORS, harborShipLocalBounds } from '../src/sim/harbor_layout';
import { sceneById } from '../src/sim/scenes/scenes';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SCENE_ID = 'scn_lb_ferry_depart_out';

describe('cinematic trajectory report core', () => {
  it('reports a registered scene with shot rows and stable columns', () => {
    const scene = sceneById(SCENE_ID);
    expect(scene).toBeDefined();
    if (!scene) return;
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
      lines.push(values.join(' '));
    });

    try {
      reportScene(
        {
          evaluateSceneRigPose,
          sceneRigCameraPosition,
          sceneRigLocalToWorld,
          composeHarborShipAttachFrame,
          propPathPoseAt,
          HARBORS,
          harborShipLocalBounds,
          groundHeight,
          terrainHeight,
          WATER_LEVEL,
          LAST_BELL_PROP_PATH_SEGMENTS,
          LAST_BELL_VOYAGE_SEGMENT_IDS,
        },
        scene,
      );
    } finally {
      log.mockRestore();
    }

    const output = lines.join('\n');
    expect(output).toContain(SCENE_ID);
    expect(output).toContain('live deck xz');
    expect(lines.some((line) => /^\s+\d+\s+\d/.test(line))).toBe(true);
  });
});
