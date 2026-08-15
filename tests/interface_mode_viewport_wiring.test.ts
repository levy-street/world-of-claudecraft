import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('live interface-mode viewport wiring', () => {
  it('activates touch controls before the immediate and settled viewport measurements', () => {
    const caseStart = mainTs.indexOf("case 'interfaceMode':");
    const caseEnd = mainTs.indexOf("case 'gamepadStickDeadzone':", caseStart);
    const branch = mainTs.slice(caseStart, caseEnd);
    const setMode = branch.indexOf('setInterfaceMode(interfaceModeFromSetting(v));');
    const syncClass = branch.indexOf('syncPhoneTouchClass();');
    const refreshControls = branch.indexOf('mobileControls.refreshInterfaceMode();');
    const syncViewport = branch.indexOf('syncSettledAppViewport(syncAppViewport);');

    expect(caseStart).toBeGreaterThanOrEqual(0);
    expect(caseEnd).toBeGreaterThan(caseStart);
    expect(setMode).toBeGreaterThanOrEqual(0);
    expect(syncClass).toBeGreaterThan(setMode);
    expect(refreshControls).toBeGreaterThan(syncClass);
    expect(syncViewport).toBeGreaterThan(refreshControls);
    expect(branch).not.toContain('\n        syncAppViewport();');
  });
});
