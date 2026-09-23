import type * as THREE from 'three';
import type { BackgroundGpuQueue } from '../background_gpu_queue';
import { activeKitPrewarmEntry } from './active_kit_prewarm';
import type { CrestPrewarmHost } from './crest_prewarm';
import type { AbilityVfxFx } from './fx';
import { ensureShamanKitAssets, ensureWarriorKitAssets } from './production_assets';

interface RendererKitHost {
  scene: THREE.Scene;
  webgl: { properties: CrestPrewarmHost['properties'] };
  backgroundGpuWork: BackgroundGpuQueue;
  abilityVfxFx: AbilityVfxFx;
  compilePrewarmColorPrograms: CrestPrewarmHost['compile'];
  renderBoundedPrewarmRoot: CrestPrewarmHost['draw'];
  prewarmTexture(texture: THREE.Texture): void;
}

/** Both class recipes share the paced scheduler, but never each other's downloads.
 * The adapter owns the coordinator's compile/draw wiring in one place. */
export function classKitPrewarmEntry(renderer: object, cls: string, constrainedMemory: boolean) {
  const h = renderer as RendererKitHost;
  const host: CrestPrewarmHost = {
    properties: h.webgl.properties,
    compile: (root, offscreen) => h.compilePrewarmColorPrograms(root, offscreen),
    draw: (group, child) => h.renderBoundedPrewarmRoot(group, child),
  };
  return activeKitPrewarmEntry(h.scene, cls, {
    queue: h.backgroundGpuWork,
    assets: (selected) =>
      selected === 'shaman'
        ? ensureShamanKitAssets(constrainedMemory)
        : ensureWarriorKitAssets(constrainedMemory),
    fragments: () => h.abilityVfxFx.impactFragmentPrewarmUnits(host),
    geometry: (kinds) => h.abilityVfxFx.authoredPrewarmUnits(host, kinds),
    texture: (texture) => h.prewarmTexture(texture),
  });
}
