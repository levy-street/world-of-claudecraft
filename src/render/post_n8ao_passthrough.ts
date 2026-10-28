import type { Camera, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';

/** The pinned n8ao 2.0.0 surface used by the shed's white-occlusion path. */
export interface N8AOPassthroughState {
  camera: Camera;
  scene: Scene;
  beautyRenderTarget: WebGLRenderTarget;
  effectCompositerQuad: {
    material: ShaderMaterial;
    render(renderer: WebGLRenderer): void;
  };
  configuration: {
    autoRenderBeauty: boolean;
    gammaCorrection: boolean;
    renderMode: number;
    aoTones: number;
    transparencyAware: boolean;
  };
  renderToScreen: boolean;
  debugMode: boolean;
}

/**
 * A uniform branch in the existing program, installed before its first compile.
 * White AO in Combined mode leaves scene RGB and alpha unchanged. Keep the
 * compositor's dithering and explicit gamma conversion in their original order.
 * No depth reconstruction, bilateral upsample, or AO texture access is needed.
 */
export function installN8aoPassthrough(material: ShaderMaterial): void {
  const anchor = '        vec4 sceneTexel = texture2D(sceneDiffuse, vUv);';
  if (material.fragmentShader.split(anchor).length !== 2) {
    throw new Error('Pinned n8ao 2.0.0 compositor scene sample changed');
  }
  material.uniforms.occlusionPassthrough = { value: false };
  material.fragmentShader =
    `uniform bool occlusionPassthrough;\n${material.fragmentShader}`.replace(
      anchor,
      `${anchor}
        if (occlusionPassthrough) {
            gl_FragColor = sceneTexel;
            #include <dithering_fragment>
            if (gammaCorrection) {
                gl_FragColor = sRGBTransferOETF(gl_FragColor);
            }
            return;
        }`,
    );
  material.needsUpdate = true;
}

/**
 * Retain the exact beauty/depth target consumed by OpaqueSceneCapture and cel
 * ink. Only skip upstream's unused AO uniforms, allocations and target binds.
 * Debug timing and diagnostic display modes keep the package's original path.
 */
export function renderN8aoPassthrough(
  state: N8AOPassthroughState,
  renderer: WebGLRenderer,
  writeBuffer: WebGLRenderTarget,
): boolean {
  const config = state.configuration;
  if (
    state.debugMode ||
    config.transparencyAware ||
    (config.renderMode !== 2 && (config.renderMode !== 0 || config.aoTones !== 0))
  )
    return false;

  state.camera.updateMatrixWorld();
  if (config.autoRenderBeauty) {
    renderer.setRenderTarget(state.beautyRenderTarget);
    renderer.render(state.scene, state.camera);
  }
  const uniforms = state.effectCompositerQuad.material.uniforms;
  const xrEnabled = renderer.xr.enabled;
  renderer.xr.enabled = false;
  uniforms.sceneDiffuse.value = state.beautyRenderTarget.texture;
  uniforms.gammaCorrection.value = config.gammaCorrection;
  uniforms.occlusionPassthrough.value = true;
  try {
    renderer.setRenderTarget(state.renderToScreen ? null : writeBuffer);
    state.effectCompositerQuad.render(renderer);
  } finally {
    uniforms.occlusionPassthrough.value = false;
    renderer.xr.enabled = xrEnabled;
  }
  return true;
}
