// World Editor reference (/wiki/reference/editor): what the standalone map editor at
// /editor is, what a player can actually build with it, how a map is stored and shared,
// and the load-bearing fact that a custom map is a private sandbox which never touches
// the live game world.
//
// Facts mirror the real tool, not a wish list: src/editor/toolbar.ts (the tool set),
// topbar.ts (the actions), map_drawer.ts (local / mine / public tabs, publish, fork),
// asset_browser.ts + net.ts (uploads and the wire contract), playtest.ts +
// src/game/editor_playtest.ts (the offline handoff), and the server lanes behind it
// (server/maps.ts, server/user_assets.ts). Nothing in the editor is gated behind
// ALLOW_DEV_COMMANDS, so nothing dev-only is described here; per-account caps exist but
// their numbers are deliberately left out.

import { hrefFor } from '../routes';
import type { GuidePage } from './types';
import { callout, loreBeat, p, pageHeader, paras, related, section } from './ui';

// The tool rail, grouped the way the palette itself groups it (sculpt, surface,
// world content, utility). One beat per family, never a key table.
const TOOL_FAMILIES = [
  ['guide.editorPage.toolLandTitle', 'guide.editorPage.toolLandBody'],
  ['guide.editorPage.toolSurfaceTitle', 'guide.editorPage.toolSurfaceBody'],
  ['guide.editorPage.toolPlaceTitle', 'guide.editorPage.toolPlaceBody'],
  ['guide.editorPage.toolCampTitle', 'guide.editorPage.toolCampBody'],
  ['guide.editorPage.toolBlockerTitle', 'guide.editorPage.toolBlockerBody'],
  ['guide.editorPage.toolRegionTitle', 'guide.editorPage.toolRegionBody'],
] as const;

export const editor: GuidePage = {
  titleKey: 'guide.nav.editor',
  render() {
    const tools = TOOL_FAMILIES.map(([title, body]) => loreBeat(title, body)).join('');
    return `
      <article class="guide-article">
        ${pageHeader('guide.nav.editor', 'guide.editorPage.intro')}
        ${callout(p('guide.editorPage.whereBody'), {
          variant: 'note',
          titleKey: 'guide.editorPage.whereTitle',
        })}

        ${section(
          'guide.editorPage.buildTitle',
          `${paras('guide.editorPage.buildBody')}<div class="guide-beat-grid">${tools}</div>`,
        )}

        ${section('guide.editorPage.viewsTitle', paras('guide.editorPage.viewsBody'))}

        ${section(
          'guide.editorPage.playtestTitle',
          paras('guide.editorPage.playtestBody') +
            callout(p('guide.editorPage.sandboxBody'), {
              variant: 'note',
              titleKey: 'guide.editorPage.sandboxTitle',
            }),
        )}

        ${section('guide.editorPage.saveTitle', paras('guide.editorPage.saveBody'))}

        ${section('guide.editorPage.shareTitle', paras('guide.editorPage.shareBody'))}

        ${section('guide.editorPage.uploadTitle', paras('guide.editorPage.uploadBody'))}

        ${section('guide.editorPage.helpTitle', paras('guide.editorPage.helpBody'))}

        ${related([
          { href: hrefFor('world'), key: 'guide.nav.world' },
          { href: hrefFor('models'), key: 'guide.nav.models' },
          { href: hrefFor('reference/interface'), key: 'guide.nav.interface' },
        ])}
      </article>`;
  },
};
