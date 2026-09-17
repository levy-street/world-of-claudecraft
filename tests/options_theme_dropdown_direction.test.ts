// The shared in-app dropdown (.ui-dd) opens UPWARD by default, a choice from
// its hotbar-loadout origin. The Interface panel's first rows reuse it (the
// language picker, and since the v0.43.0 redesign the UI Theme preset), so an
// upward menu lands on the tab strip and the panel clips it: the theme menu
// showed two options and could not be picked (dev report, 2026-09-17). The
// language picker already carries a downward override class; this pins that the
// theme preset carries its own and that the stylesheet drops both downward.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const optionsWindow = readFileSync('src/ui/options_window.ts', 'utf8');
const components = readFileSync('src/styles/components.css', 'utf8');

describe('Interface panel dropdowns open downward', () => {
  it('the UI Theme preset dropdown carries the downward override class', () => {
    const start = optionsWindow.indexOf('const presetDropdown = this.buildDropdown(');
    expect(start).toBeGreaterThan(-1);
    const block = optionsWindow.slice(
      start,
      optionsWindow.indexOf('body.appendChild(presetRow);', start),
    );
    expect(block).toContain("presetDropdown.classList.add('set-theme-select');");
  });

  it('the language picker keeps its downward override class', () => {
    expect(optionsWindow).toContain("dropdown.classList.add('set-lang-select');");
  });

  it('the stylesheet drops both Interface panel dropdowns downward', () => {
    const rule =
      /\.set-lang-select \.ui-dd-menu,\s*\.set-theme-select \.ui-dd-menu \{([^}]*)\}/.exec(
        components,
      );
    expect(rule, 'shared downward rule for the two panel dropdowns').not.toBeNull();
    const body = rule![1];
    expect(body).toContain('bottom: auto;');
    expect(body).toContain('top: calc(100% + 4px);');
  });
});
