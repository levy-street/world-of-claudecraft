// The mount-skin inspect panel's pure core (src/ui/mount_inspect_view.ts), the
// mount twin of the Armory inspect's card views. Registering it in
// UI_PURE_CORES proves it is PURE; these arms prove it is CORRECT: the one
// action decision per row state, the row projection that unions the store
// snapshot with the account mirror and the acting character, and the markup
// the DOM painter (src/ui/mount_inspect_controller.ts) binds by attribute.
//
// Ids come from the shipped catalog (MOUNT_SKIN_IDS) and labels from t(), so a
// catalog or copy change reaches these arms instead of sailing past a fixture.

import { describe, expect, it } from 'vitest';
import { MOUNT_SKIN_IDS, MOUNT_SKINS } from '../src/sim/content/mount_skins';
import { formatNumber, t } from '../src/ui/i18n';
import {
  MOUNT_INSPECT_BUY_ATTR,
  MOUNT_INSPECT_CLOSE_ATTR,
  MOUNT_INSPECT_MODE_ATTR,
  MOUNT_INSPECT_SCENE_ATTR,
  MOUNT_INSPECT_TAKEOFF_ATTR,
  MOUNT_INSPECT_WEAR_ATTR,
  type MountInspectRow,
  mountInspectAction,
  mountInspectActionsHtml,
  mountInspectControlsHtml,
  mountInspectHtml,
  mountInspectRow,
} from '../src/ui/mount_inspect_view';
import { mountSkinDescription, mountSkinDisplayName } from '../src/ui/mount_labels';

const REINS = MOUNT_SKIN_IDS[0];
const OTHER = MOUNT_SKIN_IDS[1];

function row(over: Partial<MountInspectRow> = {}): MountInspectRow {
  return {
    skinId: REINS,
    rarity: MOUNT_SKINS[REINS].rarity,
    costClaudium: 1200,
    purchasable: true,
    owned: false,
    worn: false,
    wearable: false,
    ownsAnyMount: true,
    ...over,
  };
}

const character = (over: Partial<Parameters<typeof mountInspectRow>[2]> = {}) => ({
  ownedMountSkinIds: [] as readonly string[],
  wornMountSkinId: null as string | null,
  ownsAnyMount: true,
  ...over,
});

describe('mountInspectAction', () => {
  it('offers Take off on a worn skin before anything else', () => {
    expect(mountInspectAction(row({ owned: true, worn: true }))).toBe('takeOff');
    expect(mountInspectAction(row({ owned: true, worn: true, ownsAnyMount: false }))).toBe(
      'takeOff',
    );
  });

  it('offers Wear on a wearable owned skin when a mount can carry it', () => {
    expect(mountInspectAction(row({ owned: true, wearable: true }))).toBe('wear');
  });

  it('points a wearable owned skin at a mount when the character has none to ride', () => {
    expect(mountInspectAction(row({ owned: true, wearable: true, ownsAnyMount: false }))).toBe(
      'needsMount',
    );
  });

  it('reads owned-but-not-wearable as syncing, whatever the mounts say', () => {
    expect(mountInspectAction(row({ owned: true, wearable: false }))).toBe('syncing');
    expect(mountInspectAction(row({ owned: true, wearable: false, ownsAnyMount: false }))).toBe(
      'syncing',
    );
    // Wearable without owned cannot happen from the projection, but the arm
    // reads owned first: an unowned row never wears.
    expect(mountInspectAction(row({ owned: false, wearable: true }))).toBe('buy');
  });

  it('offers Buy on an unowned skin only when the store priced it and it is purchasable', () => {
    expect(mountInspectAction(row())).toBe('buy');
    expect(mountInspectAction(row({ purchasable: false }))).toBe('unavailable');
    expect(mountInspectAction(row({ costClaudium: null }))).toBe('unavailable');
    expect(mountInspectAction(row({ costClaudium: null, purchasable: false }))).toBe('unavailable');
  });
});

describe('mountInspectRow', () => {
  it('projects the store snapshot with the catalog rarity', () => {
    const projected = mountInspectRow(
      REINS,
      { costClaudium: 900, purchasable: true, owned: false },
      character(),
    );
    expect(projected).toEqual({
      skinId: REINS,
      rarity: MOUNT_SKINS[REINS].rarity,
      costClaudium: 900,
      purchasable: true,
      owned: false,
      worn: false,
      ownsAnyMount: true,
      wearable: false,
    });
  });

  it('unions owned from the store row and the cosmetics mirror', () => {
    const fromStore = mountInspectRow(
      REINS,
      { costClaudium: 900, purchasable: true, owned: true },
      character(),
    );
    expect(fromStore?.owned).toBe(true);
    // Service-owned with an empty mirror: owned, not yet wearable (syncing).
    expect(fromStore?.wearable).toBe(false);
    expect(mountInspectAction(fromStore as MountInspectRow)).toBe('syncing');
    const fromMirror = mountInspectRow(
      REINS,
      { costClaudium: 900, purchasable: true, owned: false },
      character({ ownedMountSkinIds: [REINS] }),
    );
    expect(fromMirror?.owned).toBe(true);
    expect(fromMirror?.wearable).toBe(true);
    expect(mountInspectAction(fromMirror as MountInspectRow)).toBe('wear');
    const fromNeither = mountInspectRow(
      REINS,
      { costClaudium: 900, purchasable: true, owned: false },
      character({ ownedMountSkinIds: [OTHER] }),
    );
    expect(fromNeither?.owned).toBe(false);
    expect(fromNeither?.wearable).toBe(false);
  });

  it('reads a null store row as unpriced and not purchasable, never as free', () => {
    const projected = mountInspectRow(REINS, null, character({ ownedMountSkinIds: [OTHER] }));
    expect(projected?.costClaudium).toBeNull();
    expect(projected?.purchasable).toBe(false);
    expect(projected?.owned).toBe(false);
    expect(mountInspectAction(projected as MountInspectRow)).toBe('unavailable');
    // Ownership still comes through the mirror with no store row.
    expect(mountInspectRow(REINS, null, character({ ownedMountSkinIds: [REINS] }))?.owned).toBe(
      true,
    );
  });

  it('returns null for an id the catalog does not declare', () => {
    expect(mountInspectRow('not_a_skin', null, character())).toBeNull();
    expect(
      mountInspectRow(
        'not_a_skin',
        { costClaudium: 1, purchasable: true, owned: true },
        character({ ownedMountSkinIds: ['not_a_skin'], wornMountSkinId: 'not_a_skin' }),
      ),
    ).toBeNull();
  });

  it('marks worn only when the skin is owned and this character wears it', () => {
    const wornAndOwned = mountInspectRow(
      REINS,
      null,
      character({ ownedMountSkinIds: [REINS], wornMountSkinId: REINS }),
    );
    expect(wornAndOwned?.worn).toBe(true);
    const wornNotOwned = mountInspectRow(REINS, null, character({ wornMountSkinId: REINS }));
    expect(wornNotOwned?.worn).toBe(false);
    const ownedOtherWorn = mountInspectRow(
      REINS,
      null,
      character({ ownedMountSkinIds: [REINS], wornMountSkinId: OTHER }),
    );
    expect(ownedOtherWorn?.worn).toBe(false);
  });

  it('carries ownsAnyMount through from the character', () => {
    expect(mountInspectRow(REINS, null, character({ ownsAnyMount: false }))?.ownsAnyMount).toBe(
      false,
    );
  });
});

describe('mountInspectHtml', () => {
  it('renders the Armory inspect family dialog with the stage slot and actions host', () => {
    const r = row();
    const html = mountInspectHtml(r);
    expect(html).toMatch(
      new RegExp(
        `^<div class="armory-inspect mount-inspect rarity-${r.rarity}" role="dialog" aria-modal="true" `,
      ),
    );
    expect(html).toContain(
      `aria-label="${t('hudChrome.wocStore.mountInspectAria', { item: mountSkinDisplayName(REINS) })}"`,
    );
    expect(html).toContain(`class="x-btn armory-inspect-close" ${MOUNT_INSPECT_CLOSE_ATTR} `);
    expect(html).toContain(`aria-label="${t('hudChrome.wocStore.close')}"`);
    expect(html).toContain('<div data-mount-stage-slot></div>');
    expect(html).toContain('<div class="armory-inspect-actions" data-mount-actions></div>');
    expect(html).toContain(`<h2>${mountSkinDisplayName(REINS)}</h2>`);
    expect(html).toContain(
      `<span class="armory-collection">${t('hudChrome.wocStore.mountsTitle')}</span>`,
    );
    expect(html).toContain(`<span class="armory-rarity-pill">${t('itemUi.quality.epic')}</span>`);
    const desc = mountSkinDescription(REINS);
    if (desc) expect(html).toContain(`<p class="armory-look">${desc}</p>`);
    // The shell paints no action: the painter repaints the host per row.
    expect(html).not.toContain(MOUNT_INSPECT_BUY_ATTR);
    expect(html).not.toContain(MOUNT_INSPECT_WEAR_ATTR);
  });

  it('escapes every dynamic value', () => {
    const html = mountInspectHtml(row({ rarity: '"><b>x</b>' as never }));
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('rarity-&quot;&gt;&lt;b&gt;x&lt;/b&gt;"');
  });
});

describe('mountInspectControlsHtml', () => {
  it('carries the two mode buttons and one button per scene', () => {
    const html = mountInspectControlsHtml(['day', 'dusk', 'night']);
    expect(html).toContain(
      `<button type="button" ${MOUNT_INSPECT_MODE_ATTR}="rider">${t('hudChrome.wocStore.mountRideIt')}</button>`,
    );
    expect(html).toContain(
      `<button type="button" ${MOUNT_INSPECT_MODE_ATTR}="mount">${t('hudChrome.wocStore.mountOnly')}</button>`,
    );
    expect(html.match(new RegExp(MOUNT_INSPECT_MODE_ATTR, 'g'))).toHaveLength(2);
    expect(html.match(new RegExp(`${MOUNT_INSPECT_SCENE_ATTR}=`, 'g'))).toHaveLength(3);
    expect(html).toContain(
      `${MOUNT_INSPECT_SCENE_ATTR}="day">${t('hudChrome.wocStore.scene.day')}</button>`,
    );
    expect(html).toContain(
      `${MOUNT_INSPECT_SCENE_ATTR}="dusk">${t('hudChrome.wocStore.scene.dusk')}</button>`,
    );
    expect(html).toContain(
      `${MOUNT_INSPECT_SCENE_ATTR}="night">${t('hudChrome.wocStore.scene.night')}</button>`,
    );
    expect(html).toContain(`aria-label="${t('hudChrome.wocStore.viewModeLabel')}"`);
    expect(html).toContain(`aria-label="${t('hudChrome.wocStore.sceneLabel')}"`);
  });

  it('paints only the scenes passed, escaping the scene key', () => {
    const one = mountInspectControlsHtml(['dusk']);
    expect(one.match(new RegExp(`${MOUNT_INSPECT_SCENE_ATTR}=`, 'g'))).toHaveLength(1);
    expect(
      mountInspectControlsHtml([]).match(new RegExp(`${MOUNT_INSPECT_SCENE_ATTR}=`, 'g')),
    ).toBeNull();
    const hostile = mountInspectControlsHtml(['"><i>x</i>' as never]);
    expect(hostile).not.toContain('<i>x</i>');
  });
});

describe('mountInspectActionsHtml', () => {
  const price = formatNumber(1200, { maximumFractionDigits: 0 });

  it('paints Buy with the formatted price for an unowned priced skin', () => {
    const html = mountInspectActionsHtml(row());
    expect(html).toContain(
      '<span class="armory-price"><img src="/claudium/icons/claudium_coin_64.webp" alt="">',
    );
    expect(html).toContain(`<strong>${price}</strong>`);
    expect(html).toContain(
      `<button type="button" class="armory-buy" ${MOUNT_INSPECT_BUY_ATTR}>${t('hudChrome.wocStore.mountBuy')}</button>`,
    );
    expect(html).not.toContain(' disabled');
    expect(html).not.toContain(MOUNT_INSPECT_WEAR_ATTR);
    expect(html).not.toContain(MOUNT_INSPECT_TAKEOFF_ATTR);
  });

  it('paints a disabled Unavailable with no price when the store has none', () => {
    const html = mountInspectActionsHtml(row({ costClaudium: null }));
    expect(html).toBe(
      `<button type="button" class="armory-buy" ${MOUNT_INSPECT_BUY_ATTR} disabled>${t('hudChrome.wocStore.unavailable')}</button>`,
    );
    expect(html).not.toContain('armory-price');
  });

  it('paints Wear with the owned pill and no price once owned', () => {
    const html = mountInspectActionsHtml(row({ owned: true, wearable: true }));
    expect(html).toContain(
      `<span class="armory-owned-pill">${t('hudChrome.wocStore.owned')}</span>`,
    );
    expect(html).toContain(
      `<button type="button" class="armory-apply" ${MOUNT_INSPECT_WEAR_ATTR}>${t('hudChrome.cosmetics.wear')}</button>`,
    );
    expect(html).not.toContain(price);
    expect(html).not.toContain('armory-price');
    expect(html).not.toContain(MOUNT_INSPECT_BUY_ATTR);
  });

  it('paints Take off with the worn pill on a worn skin', () => {
    const html = mountInspectActionsHtml(row({ owned: true, wearable: true, worn: true }));
    expect(html).toContain(
      `<span class="armory-owned-pill applied">${t('hudChrome.cosmetics.worn')}</span>`,
    );
    expect(html).toContain(
      `<button type="button" class="armory-detach" ${MOUNT_INSPECT_TAKEOFF_ATTR}>${t('hudChrome.cosmetics.takeOff')}</button>`,
    );
    expect(html).not.toContain('armory-price');
    expect(html).not.toContain(MOUNT_INSPECT_WEAR_ATTR);
  });

  it('paints the needs-a-mount hint with no button for an owned skin and no ride', () => {
    const html = mountInspectActionsHtml(row({ owned: true, wearable: true, ownsAnyMount: false }));
    expect(html).toContain(
      `<span class="armory-owned-pill">${t('hudChrome.wocStore.owned')}</span>`,
    );
    expect(html).toContain(
      `<span class="armory-equip-hint">${t('hudChrome.cosmetics.mountsNoMount')}</span>`,
    );
    expect(html).not.toContain('<button');
    expect(html).not.toContain('armory-price');
  });

  it('paints only the Owned pill while a service grant is still syncing to the mirror', () => {
    const html = mountInspectActionsHtml(row({ owned: true, wearable: false }));
    expect(html).toBe(`<span class="armory-owned-pill">${t('hudChrome.wocStore.owned')}</span>`);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('armory-equip-hint');
    expect(html).not.toContain('armory-price');
  });
});
