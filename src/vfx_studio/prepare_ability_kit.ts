import { ensureActiveAbilityKit } from '../render/ability_vfx/active_kit_prewarm';

interface KitRenderer {
  scene: object;
  sync(
    alpha: number,
    dt: number,
    facing: null,
    lead: number,
    motion: null,
    discontinuity: boolean,
    present: boolean,
  ): void;
}

/** A review take starts only when its selected recipe is prepared. Keep the
 * previous image and combat clock frozen while the existing queue progresses. */
export async function prepareStudioAbilityKit(
  renderer: KitRenderer,
  cls: string,
  current: () => boolean,
  nextFrame: () => Promise<void> = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve())),
  now: () => number = () => performance.now(),
): Promise<void> {
  if (!current()) return;
  const deadline = now() + 45000;
  let settled = false;
  let failure: unknown;
  let failed = false;
  void ensureActiveAbilityKit(renderer.scene, cls).then(
    () => {
      settled = true;
    },
    (error) => {
      failure = error;
      failed = settled = true;
    },
  );
  while (current()) {
    if (settled) {
      if (failed) throw failure;
      return;
    }
    if (now() >= deadline) throw new Error('VFX Studio selected ability preparation timed out');
    renderer.sync(1, 0, null, 0, null, true, false);
    await nextFrame();
  }
}
