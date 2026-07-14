import { dropdownKeyNav } from './dropdown_nav';

export interface MobileHudContextDropdownHandle<T extends string> {
  readonly root: HTMLElement;
  setValue(value: T): void;
  close(): void;
}

export interface MobileHudContextDropdownOptions<T extends string> {
  document: Document;
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}

let dropdownSequence = 0;

/**
 * Build the editor's context picker with the same .ui-dd skin and listbox
 * semantics used by the rest of the game. A real <select> is intentionally not
 * used because iOS replaces it with a native full-screen picker.
 */
export function createMobileHudContextDropdown<T extends string>(
  config: MobileHudContextDropdownOptions<T>,
): MobileHudContextDropdownHandle<T> {
  const id = `mobile-hud-context-menu-${++dropdownSequence}`;
  const root = config.document.createElement('div');
  root.classList.add('ui-dd', 'mobile-hud-editor-contexts');
  root.setAttribute('data-mobile-hud-selector', 'context');

  const trigger = config.document.createElement('button');
  trigger.type = 'button';
  trigger.classList.add('btn', 'ui-dd-btn');
  trigger.setAttribute('aria-label', config.ariaLabel);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', id);

  const label = config.document.createElement('span');
  label.classList.add('ui-dd-label');
  const caret = config.document.createElement('span');
  caret.classList.add('ui-dd-caret');
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  trigger.append(label, caret);

  const menu = config.document.createElement('div');
  menu.classList.add('ui-dd-menu');
  menu.setAttribute('id', id);
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', config.ariaLabel);
  menu.setAttribute('hidden', '');

  const items = config.options.map((option, index) => {
    const item = config.document.createElement('div');
    item.classList.add('ui-dd-item');
    item.setAttribute('id', `${id}-option-${index}`);
    item.setAttribute('role', 'option');
    item.setAttribute('data-mobile-hud-context-id', option.value);
    item.tabIndex = -1;
    item.textContent = option.label;
    menu.append(item);
    return item;
  });

  root.append(trigger, menu);
  let value = config.value;
  const isOpen = (): boolean => menu.getAttribute('hidden') === null;
  const selectedIndex = (): number =>
    Math.max(
      0,
      config.options.findIndex((option) => option.value === value),
    );
  const focusedIndex = (): number => items.indexOf(config.document.activeElement as HTMLDivElement);

  function close(returnFocus = false): void {
    menu.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
    config.document.removeEventListener('click', closeOnDocumentClick);
    if (returnFocus) trigger.focus();
  }
  function closeOnDocumentClick(): void {
    close();
  }
  function open(focusIndex = selectedIndex()): void {
    menu.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    config.document.addEventListener('click', closeOnDocumentClick, { once: true });
    items[focusIndex]?.focus();
  }
  const setValue = (nextValue: T): void => {
    const optionIndex = config.options.findIndex((option) => option.value === nextValue);
    if (optionIndex < 0) return;
    value = nextValue;
    root.setAttribute('data-mobile-hud-context-value', nextValue);
    label.textContent = config.options[optionIndex].label;
    for (const [index, item] of items.entries()) {
      const selected = index === optionIndex;
      if (selected) item.classList.add('sel');
      else item.classList.remove('sel');
      item.setAttribute('aria-selected', String(selected));
    }
  };
  const commit = (item: HTMLElement): void => {
    const nextValue = item.getAttribute('data-mobile-hud-context-id') as T | null;
    if (!nextValue) return;
    setValue(nextValue);
    close(true);
    config.onChange(nextValue);
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isOpen()) close();
    else open();
  });
  for (const item of items) item.addEventListener('click', () => commit(item));
  root.addEventListener('keydown', (event) => {
    const action = dropdownKeyNav(event.key, isOpen(), focusedIndex(), items.length);
    if (action.kind === 'none') return;
    if (action.kind === 'tab') {
      close(true);
      return;
    }
    event.preventDefault();
    switch (action.kind) {
      case 'open':
        open(action.index);
        break;
      case 'move':
        items[action.index]?.focus();
        break;
      case 'select': {
        const item = items[focusedIndex()];
        if (item) commit(item);
        break;
      }
      case 'close':
        close(true);
        break;
    }
  });

  setValue(config.value);
  return { root, setValue, close };
}
