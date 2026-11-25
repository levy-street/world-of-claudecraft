import { mountWikiTooltips } from './hover_tooltip.js';
import { tooltipLookup } from './tooltip_content.js';

// Hover cards inside the MediaWiki container: Vector puts the page title in same-wiki
// article URLs (the offline reader uses #hash links and the static site uses paths).
function titleForLink(link) {
  const url = new URL(link.href);
  if (url.origin !== location.origin) return null;
  const prefix = '/wiki/index.php/';
  if (!url.pathname.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(url.pathname.slice(prefix.length)).replaceAll('_', ' ');
  } catch {
    return null;
  }
}
const view = document.querySelector('.mw-parser-output');
if (view) {
  const title = document.querySelector('#firstHeading')?.textContent;
  if (title) view.dataset.article = title.trim();
  fetch(new URL('./pages.tooltips.json', import.meta.url))
    .then((response) => {
      if (!response.ok) throw Error('Tooltip catalog request failed');
      return response.json();
    })
    .then((cards) =>
      mountWikiTooltips(
        view,
        tooltipLookup(cards, (path) => '/wiki/resources/assets/game' + path),
        { titleForLink },
      ),
    )
    .catch((error) => console.error('Unable to load encyclopedia tooltips', error));
}
