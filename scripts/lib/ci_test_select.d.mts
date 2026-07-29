import type { PrFileEntry } from './ci_change_classify.mjs';

export const SELECTION_PIPELINE_FILES: readonly string[];
export const CHANGED_LIST_BUDGET: number;

export function relayByteLength(s: string): number;

export function isRelayablePath(p: string): boolean;

export function decideTestMode(opts: { eventName: string; code: boolean; files?: PrFileEntry[] }): {
  mode: 'full' | 'selective';
  reason: string;
  changedPaths: string[];
};
