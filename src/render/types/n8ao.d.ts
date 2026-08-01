// Minimal typings for the n8ao package (ships untyped JS). Only the surface
// we use: stock-EffectComposer N8AOPass + the configuration knobs we set.
declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: { set(hex: number): void };
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    denoiseIterations: number;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    gammaCorrection: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    detectTransparency(): void;
    configureAOPass(depthBufferType?: number, ortho?: boolean): void;
    configureDenoisePass(depthBufferType?: number, ortho?: boolean): void;
    configureEffectCompositer(depthBufferType?: number, ortho?: boolean): void;
    configureHalfResTargets(): void;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    setSize(width: number, height: number): void;
  }
}
