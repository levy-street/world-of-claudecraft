// Type surface for scripts/wiki_site/head.mjs (see that file for behavior).
export const SITE_NAME: string;
export function clipDescription(text: string, limit?: number): string;
export function describePage(page: { title: string; lead?: string; kind?: string }): string;
export function documentTitle(title: string): string;
export function absolute(path: string): string;
export function headMarkup(page: {
  title: string;
  description: string;
  path: string;
  image?: string;
  crumbs?: { name: string; path: string }[];
  article?: boolean;
}): string;
