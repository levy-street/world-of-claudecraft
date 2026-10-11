// A stylesheet <link> in <head> blocks the first paint until it arrives, so the game
// entries' boot splash (painted from its own inline CSS) would stay invisible behind
// the multi-megabyte game stylesheet. On an entry that carries the splash, every head
// stylesheet <link> moves to the end of <body>: the splash paints first, the rest of
// the page stays hidden under it until src/ui/boot_splash.ts lifts it.

export const BOOT_SPLASH_MARKER = 'id="boot-splash"';

const HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head>/i;
const STYLESHEET_LINK_RE = /[ \t]*<link\b(?=[^>]*\brel=["']?stylesheet\b)[^>]*>[ \t]*\r?\n?/gi;

/** The stylesheet links still in the head of an entry carrying the splash (none expected). */
export function headStylesheetsBlockingBootSplash(html) {
  if (!html.includes(BOOT_SPLASH_MARKER)) return [];
  const head = HEAD_RE.exec(html);
  return head ? (head[0].match(STYLESHEET_LINK_RE) ?? []).map((link) => link.trim()) : [];
}

export function moveHeadStylesheetsBehindBootSplash(html) {
  if (!html.includes(BOOT_SPLASH_MARKER)) return html;
  const head = HEAD_RE.exec(html);
  if (!head) return html;
  const links = head[0].match(STYLESHEET_LINK_RE);
  if (!links) return html;
  const bodyEnd = html.lastIndexOf('</body>');
  if (bodyEnd < head.index + head[0].length) {
    throw new Error('boot splash stylesheets: no </body> after <head>');
  }
  const strippedHead = head[0].replace(STYLESHEET_LINK_RE, '');
  const moved = links.map((link) => `  ${link.trim()}\n`).join('');
  return (
    html.slice(0, head.index) +
    strippedHead +
    html.slice(head.index + head[0].length, bodyEnd) +
    moved +
    html.slice(bodyEnd)
  );
}
