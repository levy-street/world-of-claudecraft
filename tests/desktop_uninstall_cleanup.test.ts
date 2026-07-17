import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { USER_GPU_PREFERENCES_KEY } from '../electron/gpu_preference.cjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { build: { nsis: { include: string } } };

// The packaged Windows app writes a per-app GPU preference on every launch
// (electron/gpu_preference.cjs) under HKCU\Software\Microsoft\DirectX\
// UserGpuPreferences, keyed by the installed exe path. build/installer.nsh gives
// the electron-builder NSIS uninstaller a customUnInstall macro that deletes that
// one value on a real uninstall. These pins keep the write and the delete from
// drifting apart, and keep the uninstaller wiring (auto-included at
// build/installer.nsh, pinned by package.json's nsis.include) from silently
// breaking.

// The registry PATH under HKCU that both the write and the uninstall delete target.
// Raw single backslashes here match the literal text stored in the .nsh file.
const GPU_PREFERENCES_SUBKEY = 'Software\\Microsoft\\DirectX\\UserGpuPreferences';

const installerNsh = readFileSync(
  fileURLToPath(new URL('../build/installer.nsh', import.meta.url)),
  'utf8',
);

describe('desktop uninstall cleanup (build/installer.nsh)', () => {
  it('defines a customUnInstall macro that deletes the per-app GPU preference value', () => {
    // electron-builder's uninstaller template inserts customUnInstall inside the
    // uninstall Section; this is the only hook that runs at uninstall time.
    expect(installerNsh).toContain('customUnInstall');
    // The VALUE is deleted, never the key: DeleteRegValue, not DeleteRegKey.
    expect(installerNsh).toContain('DeleteRegValue');
    expect(installerNsh).not.toContain('DeleteRegKey');
    // The exact key path (no HKCU prefix in the DeleteRegValue argument; the root
    // is passed separately as HKCU).
    expect(installerNsh).toContain(GPU_PREFERENCES_SUBKEY);
    // The value NAME is the installed exe path, matching what the launch write keys
    // it by. APP_EXECUTABLE_FILENAME is the productName-derived exe name that
    // electron-builder's NSIS template defines. Matched as a regex so the literal
    // NSIS placeholder does not read as a JS template string.
    expect(installerNsh).toMatch(/\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}/);
  });

  it('removes the value only on a real uninstall, not during an auto-update', () => {
    // Guarding with the isUpdated negation keeps the Settings > Graphics entry from
    // flickering off and on across every auto-update (which reruns the uninstaller).
    // Matched as a regex so the literal NSIS placeholders do not read as a JS
    // template string.
    expect(installerNsh).toMatch(/\$\{ifNot\} \$\{isUpdated\}/);
  });

  it('deletes exactly the key the launch write targets (write and delete cannot drift)', () => {
    // gpu_preference.cjs writes under HKCU + this subkey; the uninstaller deletes
    // under HKCU with the same subkey. Deriving one from the other pins them together.
    expect(USER_GPU_PREFERENCES_KEY).toBe(`HKCU\\${GPU_PREFERENCES_SUBKEY}`);
  });

  it('pins build/installer.nsh as the electron-builder NSIS custom include', () => {
    // app-builder-lib 26 auto-includes build/installer.nsh, but the explicit
    // nsis.include keeps the wiring reviewable and guards against a future move.
    expect(pkg.build.nsis.include).toBe('build/installer.nsh');
  });
});
