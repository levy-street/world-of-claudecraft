import type { SfxPromptEntry } from './sfx_prompts.mjs';

export interface PingLayer {
  src: string;
  start: number;
  end: number;
  semis: number;
  gain: number;
  delayMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  fadeOutCurve: string;
  highpassHz: number;
  lowpassHz: number;
  tremoloHz: number;
  tremoloDepth: number;
}
export interface PingRecipe {
  length: number;
  driveDb?: number;
  layers: PingLayer[];
}
export declare const PING_SFX: readonly SfxPromptEntry[];
export declare const PING_SOURCES: Readonly<Record<string, string>>;
export declare const PING_RECIPES: Readonly<Record<string, PingRecipe>>;
export declare function pingFilterGraph(recipe: PingRecipe, inputs: string[]): string;
