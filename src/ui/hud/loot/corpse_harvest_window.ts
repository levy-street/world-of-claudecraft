// Thin DOM consumer for the per-corpse focus picker (#1142).
//
// Composed into hud.ts's existing loot window (openLoot) rather than a new
// window: a harvestable, unclaimed corpse gets an extra "Harvest" section
// appended below the loot rows, with one checkbox per tagged component and a
// Harvest button. It owns no state beyond the checked set it reports back
// through `onHarvest`; Hud tracks nothing extra and just re-renders the loot
// window like it already does for a plain loot-only corpse.

import { esc } from '../../esc';
import { type TranslationKey, t } from '../../i18n';
import { type CorpseHarvestViewModel, corpseHarvestView } from './corpse_harvest_view';

export interface CorpseHarvestPainterDeps {
  /** Called with the checked component tags (may be empty = spread across all). */
  onHarvest(chosen: string[]): void;
  /** The Hud's shared tooltip idiom: hover, mobile long-press, keyboard focus. */
  attachTooltip(element: HTMLElement, html: () => string): void;
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
 *  componentTags used across mob content (see tests/town_focus_i18n.test.ts). */
export function componentLabel(tag: string): string {
  const key = COMPONENT_LABEL_KEYS[tag];
  return key ? t(key as TranslationKey) : tag;
}

/** Append the harvest picker section into a container (the loot window body). */
export function renderCorpseHarvestPicker(
  container: HTMLElement,
  view: CorpseHarvestViewModel,
  deps: CorpseHarvestPainterDeps,
): void {
  // No rows, or no family on this corpse with an item behind it (#2513): draw
  // nothing at all rather than a section whose Harvest button can only ever be
  // dead. The reason line below reports a FORFEIT, which is a statement about
  // the player's selection, so it would be false here and stays hidden; a
  // section with live checkboxes, a disabled button and no explanation is worse
  // than no section, which is exactly what an untagged corpse already shows.
  // The shipped caller (loot_window_controller.openCorpse) already refuses to
  // draw the picker for such a corpse; this is the same rule one layer down, for
  // a caller that gets here anyway.
  if (view.rows.length === 0 || !view.corpseHarvestable) return;
  const document = container.ownerDocument;
  const section = document.createElement('div');
  section.className = 'corpse-harvest';
  section.innerHTML = `<div class="corpse-harvest-title">${esc(t('hudChrome.corpseHarvest.title'))}</div>
    <div class="corpse-harvest-hint">${esc(t('hudChrome.corpseHarvest.yieldTierHint'))}</div>`;
  const list = document.createElement('div');
  list.className = 'corpse-harvest-list';
  for (const row of view.rows) {
    const label = document.createElement('label');
    label.className = 'corpse-harvest-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'corpse-harvest-check';
    box.checked = row.checked;
    box.value = row.tag;
    // #2514: a family with no harvest item behind it is marked, not hidden and
    // not disabled. The sim ignores it outright now (yieldingFocusComponents),
    // so the box costs the player nothing either way; what it must not be is
    // silent, since a checked box that changes no outcome reads as a bug. The
    // mark is a text node, never colour alone, and it rides in the checkbox's
    // own aria-label rather than as a second labelled node, so the label is
    // read once.
    //
    // The aria value is a SEPARATE key that takes the visible mark as a second
    // placeholder, rather than the base label with a clause appended. Two
    // reasons, and neither is style: rendered text never concatenates, and
    // WCAG 2.2 SC 2.5.3 (Label in Name) wants the accessible name to contain
    // the text the row presents visually. Threading the same `componentNoYield`
    // value through makes that containment structural, so it survives in every
    // locale instead of depending on each translator happening to reuse their
    // own phrasing across two independent strings.
    const noYieldNote = t('hudChrome.corpseHarvest.componentNoYield');
    box.setAttribute(
      'aria-label',
      row.yieldsItem
        ? t('hudChrome.corpseHarvest.componentAria', { component: componentLabel(row.tag) })
        : t('hudChrome.corpseHarvest.componentAriaNoYield', {
            component: componentLabel(row.tag),
            note: noYieldNote,
          }),
    );
    const span = document.createElement('span');
    span.textContent = componentLabel(row.tag);
    label.appendChild(box);
    label.appendChild(span);
    if (!row.yieldsItem) {
      // Named for what it is rather than for how it looks: the row is live, and
      // a class called "inert" is one careless CSS edit away from a
      // `pointer-events: none` that would put the #2509 refusal out of reach of
      // the shipped picker, which is exactly the state marking (rather than
      // filtering) exists to keep reachable.
      label.classList.add('corpse-harvest-row-no-yield');
      const note = document.createElement('span');
      note.className = 'corpse-harvest-note';
      // The aria-label above already carries this fragment for assistive tech,
      // so the visible copy is hidden from it rather than announced twice.
      note.setAttribute('aria-hidden', 'true');
      note.textContent = noYieldNote;
      label.appendChild(note);
    }
    list.appendChild(label);
  }
  section.appendChild(list);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn corpse-harvest-btn';
  btn.textContent = t('hudChrome.corpseHarvest.harvestButton');
  // Attached ONCE, at build: Hud.attachTooltip registers a fresh listener set
  // per call, so re-attaching it on every toggle would stack them.
  deps.attachTooltip(btn, () => esc(t('hudChrome.corpseHarvest.harvestTooltip')));
  section.appendChild(btn);
  // #2509: the reason a Harvest is refused, stated in place rather than in the
  // button's tooltip. A `disabled` button takes no pointer events and leaves
  // the tab order (src/ui/focus_manager.ts), so a tooltip on it is unreachable
  // by hover, touch and keyboard alike, and an aria-label on it is read only
  // in browse mode. A live region is reachable by all of them.
  //
  // BELOW the button, not above it, and that is load-bearing: this line
  // appears and disappears as the player toggles boxes, so placing it above
  // would shove the Harvest button ~17px down at the exact moment they are
  // reaching for it, and pull it back up when they undo. Below, the only thing
  // that moves is the popup's own bottom edge.
  //
  // role=status + aria-live=polite because the state change is what has to be
  // announced: the button silently leaves the tab order, and nothing else
  // would say why. The sentence lives ONLY here, never also on the button, so
  // browse mode reads it once (the crafting-window pairing of an aria-label
  // with an aria-hidden note is the other way to do it; one or the other, and
  // this one needs no locale-specific sentence separator).
  const warning = document.createElement('div');
  warning.className = 'corpse-harvest-warning';
  warning.setAttribute('role', 'status');
  warning.setAttribute('aria-live', 'polite');
  warning.textContent = t('hudChrome.corpseHarvest.nothingSelectedYields');
  section.appendChild(warning);
  const chosenTags = (): string[] =>
    [...list.querySelectorAll<HTMLInputElement>('.corpse-harvest-check')]
      .filter((c) => c.checked)
      .map((c) => c.value);
  // The button state, the reason line and the tier-hint emphasis come from ONE
  // model, so they cannot drift apart. These are the three fields that depend
  // on the SELECTION and nothing else: a row's `yieldsItem` is a pure function
  // of its tag, so the marks above are built once and never re-applied here. If
  // a future rule ever makes a mark selection-dependent, it belongs in this
  // function, not in the build loop.
  const apply = (model: CorpseHarvestViewModel): void => {
    btn.disabled = model.harvestDisabled;
    warning.hidden = !model.forfeitsEveryYield;
    // #2514: the current pick earns a tier the widest pick on this corpse would
    // not, so the rule the hint states is live right now. This is the render
    // sink for the view model's `concentrated`, which the picker previously
    // computed and no painter read.
    section.classList.toggle('is-concentrated', model.concentrated);
  };
  // Initial state is the caller's model, so the view-core stays the single
  // source of the picker's decisions; every later state is that same core
  // re-run over the live checkbox set. A discrete change listener, not a
  // repeating driver: the picker is a cold window
  // (tests/hud_perf_budget.test.ts) and this handler reads no geometry, so
  // neither cold contract is touched.
  apply(view);
  list.addEventListener('change', () => {
    apply(
      corpseHarvestView(
        view.rows.map((row) => row.tag),
        new Set(chosenTags()),
      ),
    );
  });
  btn.addEventListener('click', () => {
    deps.onHarvest(chosenTags());
  });
  container.appendChild(section);
}
