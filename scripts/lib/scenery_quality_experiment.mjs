// Bounded, warm-scene Low research. No game import installs this controller.

import { installFarBandExperiment } from './far_band_experiment.mjs';
import { bandDistance, installMiddleBandExperiment } from './middle_band_experiment.mjs';

export function isGiantTree(item) {
  return item.kind === 'landmark' && !!item.owner.getObjectByName('TwistedTree_1');
}

export function sceneryDistance(item, x, z) {
  return item.kind === 'foliage'
    ? Math.hypot(item.x - x, item.z - z)
    : bandDistance(item.bounds, x, z);
}

export async function installSceneryQualityExperiment(renderer, distance, options = {}) {
  const controllers = [];
  let mode = 'baseline';
  let disposed = false;
  const horizon = () => mode === 'horizon' || mode === 'regional';
  const excluded = (item) => horizon() && isGiantTree(item);
  const originalRender = renderer.webgl.render;
  function render(scene, camera, ...args) {
    if (!horizon() || scene !== renderer.scene || !scene.fog?.isFog)
      return originalRender.call(this, scene, camera, ...args);
    const { near, far } = scene.fog;
    // Preserve any stronger native haze. Gently approach the 480-yard horizon,
    // then finish its fade by 560. Never clear a zone's authored atmosphere.
    scene.fog.near = Math.min(near, 320);
    scene.fog.far = Math.min(far, 560);
    try {
      return originalRender.call(this, scene, camera, ...args);
    } finally {
      scene.fog.near = near;
      scene.fog.far = far;
    }
  }
  function dispose() {
    if (disposed) return;
    if (renderer.webgl.render === render) renderer.webgl.render = originalRender;
    for (const c of controllers.reverse()) c.dispose();
    disposed = true;
  }
  try {
    const outer = await installFarBandExperiment(renderer, distance, {
      name: 'research-outer-band',
      radius: 630,
      targetTriangles: 12,
      member: (item, x, z) => {
        const d = sceneryDistance(item, x, z);
        return d > 240 && d <= 560;
      },
      excluded: isGiantTree,
    });
    controllers.push(outer);
    const far = await installFarBandExperiment(renderer, distance, { excluded });
    controllers.push(far);
    const giants = await installMiddleBandExperiment(renderer, distance, {
      name: 'research-giant-sprites',
      radius: 630,
      filter: isGiantTree,
      member: (item, x, z) => {
        const d = sceneryDistance(item, x, z);
        return d > 64 && d <= 560;
      },
      cellSize: 256,
      litSprites: true,
      allowEmpty: true,
      activateDistance: false,
    });
    controllers.push(giants);
    const middle = await installMiddleBandExperiment(renderer, distance, {
      quality: true,
      palmZone: options.palmZone,
      excluded,
    });
    controllers.push(middle);
    renderer.webgl.render = render;
    function set(value) {
      if (disposed) throw Error('Disposed');
      if (
        !['baseline', 'quality', 'horizon', ...(options.palmZone ? ['regional'] : [])].includes(
          value,
        )
      )
        throw Error('Unsupported mode');
      mode = value;
      middle.set(mode === 'baseline' ? 'simple' : mode === 'regional' ? 'regional' : 'quality');
      far.set(true);
      giants.set(horizon() ? 'sprites' : 'cutoff');
      outer.set(horizon());
    }
    set('baseline');
    return {
      set,
      dispose,
      snapshot() {
        return {
          mode,
          middle: middle.snapshot(),
          far: far.snapshot(),
          giants: giants.snapshot(),
          outer: outer.snapshot(),
          fog: horizon()
            ? {
                near: Math.min(renderer.scene.fog.near, 320),
                far: Math.min(renderer.scene.fog.far, 560),
              }
            : null,
        };
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
