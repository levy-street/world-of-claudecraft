// Unit coverage for the reviewer-facing static pre-screen (server/plugin_screen.ts):
// every rule fires on a minimal snippet, flags anchor to the FIRST matching 1-based
// line with at most one flag per code, clean woc-API source stays flag-free, word
// boundaries keep look-alike identifiers (prefetch, windowSeconds) quiet, and
// decodeScreenFlags round-trips stored values while dropping malformed rows. Pure
// module test: no db, no HTTP, plain Node.

import { describe, expect, it } from 'vitest';
import { decodeScreenFlags, screenPluginSource } from '../../server/plugin_screen';

describe('screenPluginSource rules', () => {
  it('flags each dynamic-code surface on a minimal one-line snippet', () => {
    const snippets = [
      "eval('1 + 1');",
      'var f = new Function("return 1");',
      "import('some-module');",
      "createElement('script');",
      "var w = new Worker('w.js');",
    ];
    for (const snippet of snippets) {
      expect(screenPluginSource(snippet)).toEqual([{ code: 'dynamic-code', line: 1 }]);
    }
  });

  it('flags each network egress surface on a minimal one-line snippet', () => {
    const snippets = [
      "fetch('/api/x');",
      'var xhr = new XMLHttpRequest();',
      "var ws = new WebSocket('wss://example.test');",
      "navigator.sendBeacon('/collect', payload);",
    ];
    for (const snippet of snippets) {
      expect(screenPluginSource(snippet)).toEqual([{ code: 'network', line: 1 }]);
    }
  });

  it('flags direct browser storage instead of woc.storage', () => {
    expect(screenPluginSource("localStorage.setItem('k', 'v');")).toEqual([
      { code: 'browser-storage', line: 1 },
    ]);
    expect(screenPluginSource("indexedDB.open('mydb');")).toEqual([
      { code: 'browser-storage', line: 1 },
    ]);
    // document.cookie is both a storage read and a global document reach, so it
    // carries BOTH codes (rule order: browser-storage before global-dom).
    expect(screenPluginSource('var jar = document.cookie;')).toEqual([
      { code: 'browser-storage', line: 1 },
      { code: 'global-dom', line: 1 },
    ]);
  });

  it('flags global document/window/globalThis access as global-dom', () => {
    expect(screenPluginSource("document.title = 'x';")).toEqual([{ code: 'global-dom', line: 1 }]);
    expect(screenPluginSource("window.alert('hi');")).toEqual([{ code: 'global-dom', line: 1 }]);
    expect(screenPluginSource('globalThis.woc = null;')).toEqual([{ code: 'global-dom', line: 1 }]);
  });

  it('flags credential-shaped string literals as credential-text', () => {
    expect(screenPluginSource("var h = 'authorization';")).toEqual([
      { code: 'credential-text', line: 1 },
    ]);
    expect(screenPluginSource('var k = "api_key";')).toEqual([
      { code: 'credential-text', line: 1 },
    ]);
    expect(screenPluginSource("var b = 'bearer';")).toEqual([{ code: 'credential-text', line: 1 }]);
  });

  it('flags decoder chains and packed lines as obfuscation', () => {
    expect(screenPluginSource("atob('aGk=');")).toEqual([{ code: 'obfuscation', line: 1 }]);
    expect(screenPluginSource('String.fromCharCode(72, 105);')).toEqual([
      { code: 'obfuscation', line: 1 },
    ]);
    // A single physical line of 1000+ characters is itself an obfuscation smell.
    expect(screenPluginSource('x'.repeat(1000))).toEqual([{ code: 'obfuscation', line: 1 }]);
    // One character under the threshold stays quiet.
    expect(screenPluginSource('x'.repeat(999))).toEqual([]);
  });
});

describe('flag anchoring', () => {
  it('anchors to the FIRST matching 1-based line and emits at most one flag per code', () => {
    const source = [
      "var a = 'safe';",
      "fetch('/one');",
      "fetch('/two');",
      'var xhr = new XMLHttpRequest();',
    ].join('\n');
    // Three network matches across lines 2-4 collapse to one flag on line 2.
    expect(screenPluginSource(source)).toEqual([{ code: 'network', line: 2 }]);
  });

  it('orders flags by rule severity (display order), not by line number', () => {
    const source = ["var secret = 'api_key';", "fetch('/exfil');", "eval('payload');"].join('\n');
    expect(screenPluginSource(source)).toEqual([
      { code: 'dynamic-code', line: 3 },
      { code: 'network', line: 2 },
      { code: 'credential-text', line: 1 },
    ]);
  });

  it('skips the long-line fallback when a regex arm already flagged obfuscation', () => {
    const source = ['var a = 1;', "var b = atob('aGk=');", 'var c = 2;', 'y'.repeat(1200)].join(
      '\n',
    );
    // One obfuscation flag total, anchored to the atob line, not the packed line.
    expect(screenPluginSource(source)).toEqual([{ code: 'obfuscation', line: 2 }]);
  });
});

describe('clean and near-miss sources', () => {
  it('returns [] for a plugin that sticks to the woc API', () => {
    const source = [
      "var panel = woc.ui.panel({ title: 'Greeter' });",
      "woc.on('chat', function (msg) {",
      "  panel.setText('last message: ' + msg.text);",
      '});',
      "woc.storage.set('greeted', true);",
    ].join('\n');
    expect(screenPluginSource(source)).toEqual([]);
  });

  it('does not trip network or global-dom on look-alike identifiers (word boundaries)', () => {
    const source = [
      'var windowSeconds = 60;',
      'function prefetchAssets(list) { return list.length + windowSeconds.valueOf(); }',
      "prefetchAssets(['a']);",
      "prefetch('/asset');",
    ].join('\n');
    expect(screenPluginSource(source)).toEqual([]);
  });
});

describe('decodeScreenFlags', () => {
  it('round-trips screenPluginSource output through a JSON store', () => {
    const source = ["eval('x');", "fetch('/y');", "var t = 'password';"].join('\n');
    const flags = screenPluginSource(source);
    expect(flags).toHaveLength(3);
    expect(decodeScreenFlags(JSON.parse(JSON.stringify(flags)))).toEqual(flags);
  });

  it('drops malformed rows and unknown codes, keeping the valid rows', () => {
    expect(
      decodeScreenFlags([
        null,
        'network',
        { code: 'network' },
        { line: 4 },
        { code: 'network', line: 2.5 },
        { code: 'network', line: '3' },
        { code: 'not-a-rule', line: 1 },
        { code: 'obfuscation', line: 7 },
      ]),
    ).toEqual([{ code: 'obfuscation', line: 7 }]);
  });

  it('returns [] for any non-array input', () => {
    expect(decodeScreenFlags(null)).toEqual([]);
    expect(decodeScreenFlags(undefined)).toEqual([]);
    expect(decodeScreenFlags('[]')).toEqual([]);
    expect(decodeScreenFlags({ code: 'network', line: 1 })).toEqual([]);
    expect(decodeScreenFlags(12)).toEqual([]);
  });
});
