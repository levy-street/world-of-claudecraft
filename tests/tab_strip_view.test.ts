import { describe, expect, it } from 'vitest';
import { tabStripHtml, tabStripModel } from '../src/ui/tab_strip_view';

describe('tabStripModel', () => {
  it('marks only the selected tab', () => {
    const m = tabStripModel({
      ariaLabel: 'Social',
      panelId: 'soc-body-panel',
      stripClass: 'soc-tabs',
      tabClass: 'soc-tab',
      selectedClass: 'on',
      tabs: [
        { id: 'friends', label: 'Friends' },
        { id: 'guild', label: 'Guild' },
      ],
      selected: 'guild',
    });
    expect(m.tabs).toEqual([
      { id: 'friends', label: 'Friends', extraHtml: '', buttonId: undefined, selected: false },
      { id: 'guild', label: 'Guild', extraHtml: '', buttonId: undefined, selected: true },
    ]);
  });

  it('is DOM-free / same-input-same-output regardless of caller shape', () => {
    const descriptor = {
      ariaLabel: 'x',
      panelId: 'p',
      stripClass: 's',
      tabClass: 't',
      selectedClass: 'on',
      tabs: [{ id: 'a', label: 'A' }],
      selected: 'a',
    };
    expect(tabStripModel(descriptor)).toEqual(tabStripModel({ ...descriptor }));
  });
});

describe('tabStripHtml', () => {
  it('renders role=tablist / role=tab markup with a roving tabindex and aria-selected', () => {
    const html = tabStripHtml(
      tabStripModel({
        ariaLabel: 'Social',
        panelId: 'soc-body-panel',
        stripClass: 'soc-tabs',
        tabClass: 'soc-tab',
        selectedClass: 'on',
        tabs: [
          { id: 'friends', label: 'Friends' },
          { id: 'guild', label: 'Guild' },
        ],
        selected: 'friends',
      }),
    );
    expect(html).toBe(
      '<div class="soc-tabs" role="tablist" aria-label="Social">' +
        '<button type="button" class="soc-tab on" data-tab="friends" role="tab" aria-selected="true" tabindex="0" aria-controls="soc-body-panel">Friends</button>' +
        '<button type="button" class="soc-tab " data-tab="guild" role="tab" aria-selected="false" tabindex="-1" aria-controls="soc-body-panel">Guild</button>' +
        '</div>',
    );
  });

  it('supports a div tag with a per-tab badge (extraHtml), for a talents_window-style strip', () => {
    const html = tabStripHtml(
      tabStripModel({
        ariaLabel: 'Talents',
        panelId: 'tal-body',
        stripClass: 'tal-tabs',
        tabClass: 'tal-tab',
        selectedClass: 'active',
        tag: 'div',
        tabs: [{ id: 'class', label: 'Class', extraHtml: '<span class="tt-pts">3</span>' }],
        selected: 'class',
      }),
    );
    expect(html).toBe(
      '<div class="tal-tabs" role="tablist" aria-label="Talents">' +
        '<div class="tal-tab active" data-tab="class" role="tab" aria-selected="true" ' +
        'tabindex="0" aria-controls="tal-body">Class<span class="tt-pts">3</span></div>' +
        '</div>',
    );
  });

  it('omits aria-controls when no panelId is given, and emits a per-tab id when buttonId is set', () => {
    const html = tabStripHtml(
      tabStripModel({
        ariaLabel: 'Store',
        stripClass: 'woc-store-tabs',
        tabClass: 'woc-store-tab',
        selectedClass: 'sel',
        tabs: [{ id: 'store', label: 'Store', buttonId: 'woc-store-tab-store' }],
        selected: 'store',
      }),
    );
    expect(html).not.toContain('aria-controls');
    expect(html).toContain('id="woc-store-tab-store"');
  });

  it('escapes label / aria-label / id text', () => {
    const html = tabStripHtml(
      tabStripModel({
        ariaLabel: '<x>',
        panelId: 'p',
        stripClass: 's',
        tabClass: 't',
        selectedClass: 'on',
        tabs: [{ id: 'a', label: '<b>&"\'' }],
        selected: 'a',
      }),
    );
    expect(html).toContain('aria-label="&lt;x&gt;"');
    expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;');
  });
});
