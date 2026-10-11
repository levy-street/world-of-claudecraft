import { captureFocusKey, FOCUS_KEY_ATTR, findFocusKey } from './focus_restore';
import { FRAME_MENU_GROUPS, frameMenuGroup } from './frame_menu_core';
import { t } from './i18n';
import type { FramesMenuSelect, FramesMenuToggle, UnlockEntry } from './interface_unlock';

export function frameCheckRow(
  doc: Document,
  label: string,
  checked: boolean,
  change: (on: boolean) => void,
  key: string,
): HTMLElement {
  const row = doc.createElement('label');
  row.className = 'frames-menu-row';
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.setAttribute(FOCUS_KEY_ATTR, key);
  box.addEventListener('change', () => change(box.checked));
  const text = doc.createElement('span');
  text.textContent = label;
  row.appendChild(box);
  row.appendChild(text);
  return row;
}

export function renderFrameSettingsRows(
  doc: Document,
  root: HTMLElement,
  toggles: FramesMenuToggle[],
  selects: FramesMenuSelect[],
  changed: () => void,
  appearance: 'plate' | 'checkbox' = 'plate',
): void {
  for (const toggle of toggles) {
    if (appearance === 'checkbox') {
      root.appendChild(
        frameCheckRow(
          doc,
          toggle.label,
          toggle.value,
          (on) => {
            toggle.set(on);
            changed();
          },
          toggle.id,
        ),
      );
      continue;
    }
    const row = doc.createElement('div');
    row.className = 'set-row ui-stat-row';
    const label = doc.createElement('span');
    label.className = 'set-name';
    label.textContent = toggle.label;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = `btn ui-btn ui-btn--plate set-toggle${toggle.value ? '' : ' off is-off'}`;
    button.textContent = t(toggle.value ? 'hud.options.on' : 'hud.options.off');
    button.setAttribute('aria-label', toggle.label);
    button.setAttribute('aria-pressed', String(toggle.value));
    button.setAttribute(FOCUS_KEY_ATTR, toggle.id);
    button.addEventListener('click', () => {
      toggle.set(!toggle.value);
      changed();
    });
    row.appendChild(label);
    row.appendChild(button);
    root.appendChild(row);
  }
  for (const select of selects) {
    const row = doc.createElement('label');
    row.className = 'frames-menu-row frames-menu-select';
    const name = doc.createElement('span');
    name.textContent = select.label;
    row.appendChild(name);
    const picker = doc.createElement('select');
    picker.setAttribute(FOCUS_KEY_ATTR, select.id);
    for (const option of select.options) {
      const element = doc.createElement('option');
      element.value = String(option.value);
      element.textContent = option.label;
      element.selected = option.value === select.value;
      picker.appendChild(element);
    }
    picker.addEventListener('change', () => {
      select.set(Number(picker.value));
      changed();
    });
    row.appendChild(picker);
    root.appendChild(row);
  }
}

export function renderFrameVisibilityRows(
  doc: Document,
  root: HTMLElement,
  entries: readonly UnlockEntry[],
  openGroups: Map<string, boolean>,
  reset: (entry: UnlockEntry) => void,
): void {
  const focus = captureFocusKey(root);
  const scrollTop = root.scrollTop;
  // Read synchronously: the native toggle event may not have fired before a setting rebuild.
  for (const group of root.querySelectorAll<HTMLDetailsElement>('details[data-frame-group]'))
    openGroups.set(group.dataset.frameGroup!, group.open);
  root.replaceChildren();
  for (const [id, labelKey] of FRAME_MENU_GROUPS) {
    const members = entries.filter(
      (entry) =>
        frameMenuGroup(entry.id) === id &&
        entry.mover.labelText() &&
        (entry.rowOverride
          ? entry.rowOverride.listed()
          : entry.isActive() || entry.mover.isUserHidden),
    );
    if (!members.length) continue;
    const section = doc.createElement('details');
    section.className = 'frames-menu-sub';
    section.dataset.frameGroup = id;
    section.open = openGroups.get(id) ?? true;
    const summary = doc.createElement('summary');
    summary.textContent = t(labelKey);
    summary.setAttribute(FOCUS_KEY_ATTR, 'group:' + id);
    section.appendChild(summary);
    const rows = doc.createElement('div');
    rows.className = 'frames-menu-rows';
    for (const entry of members) {
      const name = entry.mover.labelText();
      const wrap = doc.createElement('div');
      wrap.className = 'frames-menu-row-wrap';
      const override = entry.rowOverride;
      wrap.appendChild(
        frameCheckRow(
          doc,
          name,
          override ? override.value() : !entry.mover.isUserHidden,
          (on) => {
            if (override) override.set(on);
            else entry.mover.setUserHidden(!on);
          },
          entry.id,
        ),
      );
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'frames-menu-reset';
      button.textContent = t('hudChrome.interfaceUnlock.resetFrameSize');
      button.setAttribute('aria-label', t('hudChrome.interfaceUnlock.resetFrameSizeFor', { name }));
      button.setAttribute(FOCUS_KEY_ATTR, 'reset:' + entry.id);
      button.addEventListener('click', () => reset(entry));
      wrap.appendChild(button);
      rows.appendChild(wrap);
    }
    section.appendChild(rows);
    root.appendChild(section);
  }
  if (focus) findFocusKey(root, focus)?.focus({ preventScroll: true });
  root.scrollTop = scrollTop;
}
