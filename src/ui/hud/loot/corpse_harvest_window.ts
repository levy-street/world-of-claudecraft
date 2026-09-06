// Thin DOM consumer for the corpse popup's harvest STATUS section
// (Intentional Gathering PR3, corpse-status-contract.md).
//
// Composed into hud.ts's existing loot window (openLoot) rather than a new
// window: a harvestable, unclaimed corpse gets an extra "Harvest" section
// appended below the loot rows. It owns no state beyond what its caller
// hands it each render; the controller (`loot_window_controller.ts`) keeps
// the live query and repaints this section on a signature change, exactly
// like the loot rows above it.
//
// Replaces the retired per-tag checkbox picker (#1142): there is now ONE
// remembered global preference (All materials, or one material), so this
// section shows that preference plus its live status against THIS body
// (denial, reservation, concentration benefit) and a Change control that
// opens the shared harvest-preference picker
// (`hud/professions/harvest_preference_controller.ts`) scoped to this body's
// supported materials. It never writes the preference itself.

import { ITEMS } from '../../../sim/data';
import {
  HARVEST_CAST_SECONDS,
  HARVEST_PRIORITY_SECONDS,
  type HarvestAdmissionReason,
} from '../../../sim/professions/harvest_admission';
import type { HarvestPreference } from '../../../sim/professions/harvest_preference';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatList, formatNumber, type TranslationKey, t } from '../../i18n';
import { knownItemDef } from '../../known_item';
import type { CorpseHarvestStatusViewModel } from './corpse_harvest_view';

export interface CorpseHarvestPanelDeps {
  /** Opens the shared harvest-preference picker scoped to this body; never
   *  writes the preference itself. */
  onChange(): void;
  /** Fires once per click; the controller re-validates liveness and admission
   *  before sending anything. */
  onHarvest(): void;
  /** The Hud's shared tooltip idiom: hover, mobile long-press, keyboard focus. */
  attachTooltip(element: HTMLElement, html: () => string): void;
  /** True only for a background status refresh in flight over a body the LAST
   *  known answer already admitted (neither checking-from-cold, no-answer, an
   *  active denial, nor a command already sent: `view.harvestDisabled` /
   *  `commandPending` already cover each of those and always win if a caller
   *  ever passes both). Painted with `aria-disabled` rather than native
   *  `disabled`, so the control stays in the tab order and keyboard focus
   *  already on it is never blurred to `<body>` by a native disabled flip
   *  mid-poll (Intentional Gathering PR3 keyboard-focus review); the
   *  click/keydown handlers below refuse the press the same as a real
   *  disabled one. Defaults to false, so every existing caller is unaffected. */
  busyRefresh?: boolean;
}

const COMPONENT_LABEL_KEYS: Record<string, string> = {
  hide: 'hudChrome.corpseHarvest.components.hide',
  fang: 'hudChrome.corpseHarvest.components.fang',
  silk: 'hudChrome.corpseHarvest.components.silk',
  venomSac: 'hudChrome.corpseHarvest.components.venomSac',
  gills: 'hudChrome.corpseHarvest.components.gills',
  claw: 'hudChrome.corpseHarvest.components.claw',
  horn: 'hudChrome.corpseHarvest.components.horn',
  tusk: 'hudChrome.corpseHarvest.components.tusk',
  meat: 'hudChrome.corpseHarvest.components.meat',
  cloth: 'hudChrome.corpseHarvest.components.cloth',
};

/** Exported for tests only, so the label map can be pinned against the real set of
 *  componentTags used across mob content (see tests/town_focus_i18n.test.ts).
 *  Preserved unchanged by the Intentional Gathering PR3 harvest-status rework:
 *  Town Focus (src/ui/town_focus_window.ts) still reads the sibling
 *  `hudChrome.corpseHarvest.components.*` keys directly. */
export function componentLabel(tag: string): string {
  const key = COMPONENT_LABEL_KEYS[tag];
  return key ? t(key as TranslationKey) : tag;
}

// Every HarvestAdmissionReason EXCEPT 'reserved' and 'material_unavailable',
// which carry their own reservation name / available-materials list and so
// are handled specially in `statusLine` below. A denial reaching this table
// with no row (impossible while the union above stays complete: TypeScript
// enforces it via the exhaustive Record type) falls back to malformedInput.
const DENIAL_KEYS: Record<
  Exclude<HarvestAdmissionReason, 'reserved' | 'material_unavailable'>,
  string
> = {
  malformed_input: 'hudChrome.corpseHarvest.denial.malformedInput',
  actor_dead: 'hudChrome.corpseHarvest.denial.actorDead',
  actor_in_combat: 'hudChrome.corpseHarvest.denial.actorInCombat',
  actor_busy: 'hudChrome.corpseHarvest.denial.actorBusy',
  corpse_invalid: 'hudChrome.corpseHarvest.denial.corpseInvalid',
  wrong_world: 'hudChrome.corpseHarvest.denial.wrongWorld',
  out_of_range: 'hudChrome.corpseHarvest.denial.outOfRange',
  no_field_kit: 'hudChrome.corpseHarvest.denial.noFieldKit',
  already_harvested: 'hudChrome.corpseHarvest.alreadyHarvested',
  priority_protected: 'hudChrome.corpseHarvest.denial.priorityProtected',
  corpse_expiring: 'hudChrome.corpseHarvest.denial.corpseExpiring',
  preference_malformed: 'hudChrome.corpseHarvest.denial.preferenceMalformed',
  nothing_to_harvest: 'hudChrome.corpseHarvest.denial.nothingToHarvest',
  bags_full: 'hudChrome.corpseHarvest.denial.bagsFull',
};

/** An owned item's display name via the real ITEMS table (never the raw
 *  internal id), falling back to the shared "unavailable material" line for
 *  a retired or unknown id, matching the shared preference picker's own
 *  fallback (harvest_preference_picker.ts). */
function materialLabel(itemId: string): string {
  const item = knownItemDef(ITEMS, itemId);
  return item ? itemDisplayName(item) : t('hudChrome.harvestPreference.unknownMaterial');
}

function preferenceLabel(preference: HarvestPreference | null): string {
  if (preference === null) return t('hudChrome.harvestPreference.unknownMaterial');
  if (preference.kind === 'all') return t('hudChrome.harvestPreference.allLabel');
  return materialLabel(preference.itemId);
}

/** The one status sentence: the query state, the active denial (reservation
 *  and material-unavailable spelled out with real names), or the current
 *  preference's benefit when nothing refuses. Never a quantity/specimen
 *  promise: `tierBonus` is the sim's own concentration shift over All. */
function statusLine(view: CorpseHarvestStatusViewModel): string {
  if (view.kind === 'checking') return t('hudChrome.corpseHarvest.checkingStatus');
  if (view.kind === 'unavailable') return t('hudChrome.corpseHarvest.statusUnavailable');
  const denial = view.denial;
  if (denial === 'reserved') {
    if (view.reservation?.self) return t('hudChrome.corpseHarvest.denial.reservedSelf');
    // A missing/empty name (a malformed or not-yet-resolved reservation) gets
    // the honest generic line rather than a sentence with a blank subject.
    return view.reservation?.name
      ? t('hudChrome.corpseHarvest.denial.reservedOther', { name: view.reservation.name })
      : t('hudChrome.corpseHarvest.denial.reservedOtherUnknown');
  }
  if (denial === 'material_unavailable') {
    const material = preferenceLabel(view.preference);
    if (view.availableMaterialItemIds.length === 0) {
      return t('hudChrome.corpseHarvest.denial.materialUnavailable', { material });
    }
    const materials = formatList(view.availableMaterialItemIds.map(materialLabel));
    return t('hudChrome.corpseHarvest.denial.materialUnavailableWithList', {
      material,
      materials,
    });
  }
  if (denial !== null) return t(DENIAL_KEYS[denial] as TranslationKey);
  if (view.preference?.kind === 'material' && view.tierBonus > 0) {
    return t('hudChrome.corpseHarvest.tierBonusHint', {
      material: preferenceLabel(view.preference),
      tierBonus: formatNumber(view.tierBonus, { maximumFractionDigits: 0 }),
    });
  }
  return view.preference?.kind === 'all'
    ? t('hudChrome.corpseHarvest.allBenefit')
    : t('hudChrome.corpseHarvest.focusBenefit', { material: preferenceLabel(view.preference) });
}

/** Append the harvest status section into a container (the loot window body).
 *  `commandPending` disables Harvest independently of `view.harvestDisabled`
 *  (a live Harvest attempt already in flight for this body) and overrides the
 *  status line with a starting notice; Change stays enabled regardless, so a
 *  player can always switch away from an unavailable choice. See
 *  `CorpseHarvestPanelDeps.busyRefresh` for the OTHER, narrower "cannot act
 *  right now" case this also paints. */
export function renderCorpseHarvestPanel(
  container: HTMLElement,
  view: CorpseHarvestStatusViewModel,
  commandPending: boolean,
  deps: CorpseHarvestPanelDeps,
): void {
  const document = container.ownerDocument;
  const section = document.createElement('div');
  section.className = 'corpse-harvest';

  const title = document.createElement('div');
  title.className = 'corpse-harvest-title';
  title.textContent = t('hudChrome.corpseHarvest.preferenceLabel', {
    preference: preferenceLabel(view.preference),
  });
  section.appendChild(title);

  const changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'btn btn-secondary corpse-harvest-change-btn';
  changeBtn.textContent = t('hudChrome.corpseHarvest.changeButton');
  changeBtn.addEventListener('click', () => deps.onChange());
  section.appendChild(changeBtn);

  const hint = document.createElement('div');
  hint.className = 'corpse-harvest-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  hint.textContent = commandPending
    ? t('hudChrome.corpseHarvest.harvestStarting')
    : statusLine(view);
  section.appendChild(hint);

  const harvestBtn = document.createElement('button');
  harvestBtn.type = 'button';
  harvestBtn.className = 'btn corpse-harvest-btn';
  harvestBtn.textContent = t('hudChrome.corpseHarvest.harvestButton');
  const hardDisabled = view.harvestDisabled || commandPending;
  harvestBtn.disabled = hardDisabled;
  if (deps.busyRefresh && !hardDisabled) harvestBtn.setAttribute('aria-disabled', 'true');
  // Attached ONCE, at build: Hud.attachTooltip registers a fresh listener set
  // per call, so re-attaching it on every repaint would stack them. LIVE
  // values off the real admission constants (harvest_admission.ts), never a
  // hardcoded duration: this tooltip must move if the cast/priority window
  // ever does.
  deps.attachTooltip(harvestBtn, () =>
    esc(
      t('hudChrome.corpseHarvest.harvestActionTooltip', {
        seconds: formatNumber(HARVEST_CAST_SECONDS, { maximumFractionDigits: 1 }),
        prioritySeconds: formatNumber(HARVEST_PRIORITY_SECONDS, { maximumFractionDigits: 0 }),
      }),
    ),
  );
  // aria-disabled retains focus, so explicitly suppress activation while busy.
  harvestBtn.addEventListener('click', () => {
    if (harvestBtn.disabled || harvestBtn.getAttribute('aria-disabled') === 'true') return;
    deps.onHarvest();
  });
  harvestBtn.addEventListener('keydown', (event) => {
    if (harvestBtn.getAttribute('aria-disabled') !== 'true') return;
    if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
  });
  section.appendChild(harvestBtn);

  container.appendChild(section);
}
