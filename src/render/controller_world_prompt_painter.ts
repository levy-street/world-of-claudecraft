import * as THREE from 'three';
import {
  type ControllerWorldPromptFrame,
  type ControllerWorldPromptScreenAnchor,
  type ControllerWorldPromptViewInput,
  controllerWorldPromptPlanInto,
  newControllerWorldPromptPlan,
} from './controller_world_prompt_view';
import type { NameplateCanvasState } from './nameplate_canvas';
import { isProjectedNameplateAnchorVisible } from './nameplate_projection';

export interface ControllerWorldPromptLabelAnchor {
  state: NameplateCanvasState;
  heraldryLift: number;
  screenX: number;
  screenY: number;
}

export interface ControllerWorldPromptPaintSurface {
  controllerPrompt: {
    drawAt(buttonLabel: string, screenX: number, screenY: number): void;
    drawBesideName(
      state: NameplateCanvasState,
      buttonLabel: string,
      screenX: number,
      screenY: number,
      heraldryLift: number,
    ): void;
  };
}

export class ControllerWorldPromptPainter {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly surface: ControllerWorldPromptPaintSurface;
  private readonly worldPoint = new THREE.Vector3();
  private readonly cameraPoint = new THREE.Vector3();
  private readonly labelAnchor: ControllerWorldPromptScreenAnchor = {
    anchor: { kind: 'entity', entityId: 0 },
    x: 0,
    y: 0,
  };
  private readonly projectedAnchor: ControllerWorldPromptScreenAnchor = {
    anchor: { kind: 'entity', entityId: 0 },
    x: 0,
    y: 0,
  };
  private readonly viewInput: ControllerWorldPromptViewInput = {
    frame: null,
    labelAnchor: null,
    worldAnchor: null,
    viewportWidth: 0,
    viewportHeight: 0,
  };
  private readonly plan = newControllerWorldPromptPlan();

  constructor(camera: THREE.PerspectiveCamera, surface: ControllerWorldPromptPaintSurface) {
    this.camera = camera;
    this.surface = surface;
  }

  paint(
    frame: ControllerWorldPromptFrame | null,
    label: ControllerWorldPromptLabelAnchor | null,
    fallbackWorldPoint: Readonly<{ x: number; y: number; z: number }> | null,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const action = frame?.action;
    const input = this.viewInput;
    input.frame = frame;
    input.viewportWidth = viewportWidth;
    input.viewportHeight = viewportHeight;
    input.labelAnchor = null;
    input.worldAnchor = null;

    if (action && label) {
      this.labelAnchor.anchor = action.anchor;
      this.labelAnchor.x = label.screenX;
      this.labelAnchor.y = label.screenY;
      input.labelAnchor = this.labelAnchor;
    }

    const point = frame?.worldPoint ?? fallbackWorldPoint;
    if (action && point) {
      this.worldPoint.set(point.x, point.y, point.z);
      if (isProjectedNameplateAnchorVisible(this.camera, this.worldPoint, this.cameraPoint)) {
        this.worldPoint.project(this.camera);
        if (this.worldPoint.z >= -1 && this.worldPoint.z <= 1) {
          this.projectedAnchor.anchor = action.anchor;
          this.projectedAnchor.x = (this.worldPoint.x * 0.5 + 0.5) * viewportWidth;
          this.projectedAnchor.y = (-this.worldPoint.y * 0.5 + 0.5) * viewportHeight;
          input.worldAnchor = this.projectedAnchor;
        }
      }
    }

    const plan = controllerWorldPromptPlanInto(this.plan, input);
    if (plan.hidden) return;
    if (plan.placement === 'label' && label) {
      this.surface.controllerPrompt.drawBesideName(
        label.state,
        plan.buttonLabel,
        label.screenX,
        label.screenY,
        label.heraldryLift,
      );
      return;
    }
    this.surface.controllerPrompt.drawAt(plan.buttonLabel, plan.x, plan.y);
  }
}
