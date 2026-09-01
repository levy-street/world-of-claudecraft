import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ControllerWorldPromptPainter } from '../src/render/controller_world_prompt_painter';
import type { ControllerWorldPromptFrame } from '../src/render/controller_world_prompt_view';
import { createNameplateCanvasState } from '../src/render/nameplate_canvas';

function camera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 2, 10);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
  return camera;
}

function frame(worldPoint: { x: number; y: number; z: number } | null): ControllerWorldPromptFrame {
  return {
    padActive: true,
    claimedBy: null,
    action: {
      kind: 'confirm',
      buttonLabel: 'Cross',
      anchor: { kind: 'entity', entityId: 9 },
      blocked: false,
    },
    worldPoint,
  };
}

function surface() {
  return {
    controllerPrompt: {
      drawAt: vi.fn(),
      drawBesideName: vi.fn(),
    },
  };
}

describe('controller world prompt painter', () => {
  it('attaches the button to the existing entity label before any world projection', () => {
    const canvas = surface();
    const painter = new ControllerWorldPromptPainter(camera(), canvas);
    const state = createNameplateCanvasState();
    state.name = 'Miner Brann';

    painter.paint(
      frame({ x: 0, y: 2, z: 0 }),
      { state, heraldryLift: 0, screenX: 620, screenY: 260 },
      null,
      1280,
      720,
    );

    expect(canvas.controllerPrompt.drawBesideName).toHaveBeenCalledWith(
      state,
      'Cross',
      620,
      260,
      0,
    );
    expect(canvas.controllerPrompt.drawAt).not.toHaveBeenCalled();
  });

  it('projects an unlabeled actionable object at its world point', () => {
    const canvas = surface();
    const painter = new ControllerWorldPromptPainter(camera(), canvas);

    painter.paint(frame({ x: 0, y: 2, z: 0 }), null, null, 1280, 720);

    expect(canvas.controllerPrompt.drawAt).toHaveBeenCalledWith('Cross', 640, 360);
  });

  it('uses bottom center when a bobber, node, or reticle projection is unavailable', () => {
    const canvas = surface();
    const painter = new ControllerWorldPromptPainter(camera(), canvas);

    painter.paint(frame({ x: 0, y: 2, z: 12 }), null, null, 1280, 720);

    expect(canvas.controllerPrompt.drawAt).toHaveBeenCalledWith('Cross', 640, 608);
  });

  it('does not repaint the previous action after input handoff clears the frame', () => {
    const canvas = surface();
    const painter = new ControllerWorldPromptPainter(camera(), canvas);
    painter.paint(frame({ x: 0, y: 2, z: 0 }), null, null, 1280, 720);
    canvas.controllerPrompt.drawAt.mockClear();

    painter.paint(null, null, null, 1280, 720);

    expect(canvas.controllerPrompt.drawAt).not.toHaveBeenCalled();
    expect(canvas.controllerPrompt.drawBesideName).not.toHaveBeenCalled();
  });
});
