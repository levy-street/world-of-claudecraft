// Baldemar's travel gate (`renderer.wizardGate`), moved out of renderer.ts: the
// cast (call pose, sparkle, rune circle) and the one open gate a world holds.
// main.ts / src/game/studio_world_hooks.ts own the timing (see
// src/game/portal_travel_core.ts).

import type * as THREE from 'three';
import type { CharacterVisual } from './characters';
import type { MageGroundFx } from './mage_ground_fx';
import type { BudgetPointLightRegistry } from './point_light_budget';
import type { EntityView } from './renderer';
import type { Vfx } from './vfx';
import { buildWizardPortal, type WizardPortalView } from './wizard_portal';

/** What the gate reads from the renderer. */
export interface WizardGateHost {
  scene(): THREE.Scene;
  lowGfx(): boolean;
  readonly budgetLights: BudgetPointLightRegistry;
  groundHeight(x: number, z: number): number;
  view(id: number): EntityView | undefined;
  activeVisual(v: EntityView): CharacterVisual | null;
  pulseAt(entityId: number, school: string, intensity: number, duration: number): void;
  vfx(): Vfx;
  mageGroundFx(): MageGroundFx;
}

export class WizardGate {
  /** Baldemar's open gate, at most one per world. */
  private portal: WizardPortalView | null = null;

  constructor(private readonly host: WizardGateHost) {}

  /** Baldemar's cast: the arm-raised call pose on his visual, arcane sparkle
   *  around him, and a persistent arcane rune circle churning on the ground
   *  where the gate is about to open. */
  playWizardCast(entityId: number, seconds: number, runeX: number, runeZ: number): void {
    const v = this.host.view(entityId);
    const vis = v ? this.host.activeVisual(v) : null;
    if (vis && !vis.isMidOneShot) vis.playCallPose(seconds);
    this.host.pulseAt(entityId, 'arcane', 1.2, 0.4);
    this.host.vfx().castSparkle(entityId, 'arcane', 1.4);
    this.host
      .mageGroundFx()
      .spawnRune({ x: runeX, z: runeZ, radius: 2.3, duration: seconds + 0.4 });
  }

  /** Open Baldemar's gate at (x, z), seated on the terrain. One gate at a
   *  time: a re-cast moves it rather than stacking a second view. */
  openWizardPortal(x: number, z: number, facing: number): void {
    this.closeWizardPortal();
    const portal = buildWizardPortal(this.host.lowGfx(), this.host.budgetLights);
    portal.place(x, this.host.groundHeight(x, z), z, facing);
    this.host.scene().add(portal.group);
    this.portal = portal;
  }

  closeWizardPortal(): void {
    if (!this.portal) return;
    this.portal.dispose();
    this.portal = null;
  }

  update(dt: number): void {
    this.portal?.update(dt);
  }
}
