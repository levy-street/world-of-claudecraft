// Type surface for scripts/wiki_site/build.mjs (see that file for behavior).
import type { PathRegistry } from './paths.mjs';
export const REGISTRY_FILE: string;
export function readRegistry(file?: string): PathRegistry;
export function shellTemplate(html: string, paths: Map<string, string>): string;
export function buildSite(options?: {
  seedFile?: string;
  outDir?: string;
  templateFile?: string;
  registry?: PathRegistry;
  log?: (message: string) => void;
}): Promise<{
  paths: Map<string, string>;
  broken: Map<string, Set<string>>;
  written: number;
  searchUrl: string;
  cardsUrl: string;
}>;
