// Type surface for scripts/wiki_site/paths.mjs (see that file for behavior).
export interface PageLike {
  title: string;
  categories: string[];
  text: string;
}
export interface PathRegistry {
  pages: Record<string, string>;
  redirects: Record<string, string | null>;
}
export const WIKI_BASE: string;
export const SITE_ORIGIN: string;
export const HOME_PATH: string;
export const SECTIONS: string[];
export function slugify(title: string): string;
export function stripQualifier(title: string): string;
export function sectionFor(page: PageLike): string;
export function assignPaths(
  pages: Map<string, PageLike>,
  registry?: PathRegistry,
): { paths: Map<string, string>; added: string[] };
export function registryDrift(
  paths: Map<string, string>,
  registry: PathRegistry,
): { added: string[]; missing: string[] };
export function fileForPath(path: string): string;
