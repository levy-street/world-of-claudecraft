// Type surface for scripts/wiki_site/links.mjs (see that file for behavior).
export function hashTarget(hash: string): { title: string; section: string } | null;
export function staticHref(
  hash: string,
  paths: Map<string, string>,
  current: string,
): string | undefined;
export function rewriteView(
  root: Element,
  options: {
    paths: Map<string, string>;
    current: string;
    artUrl?: (path: string) => string;
    title?: string;
  },
): string[];
