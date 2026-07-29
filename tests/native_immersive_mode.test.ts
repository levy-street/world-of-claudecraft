import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

// PR #2423 split the Android app into product flavors (play, solanaStore): the shared
// behavior moved to BaseMainActivity, and each flavor now ships its own thin MainActivity
// that only overrides plugin registration. The immersive-mode code this suite guards lives
// in the base, so that is what it reads; the old single-activity path stopped existing and
// took this file's whole collection down with it.
const ACTIVITY_DIR = 'android/app/src/main/java/com/worldofclaudecraft';

/** Every flavor that ships its own MainActivity, discovered rather than listed. */
function flavorActivities(): { flavor: string; source: string }[] {
  const srcDir = new URL('android/app/src/', root);
  return readdirSync(srcDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'main')
    .map((entry) => ({
      flavor: entry.name,
      path: `android/app/src/${entry.name}/java/com/worldofclaudecraft/MainActivity.java`,
    }))
    .filter(({ path }) => {
      try {
        readFileSync(new URL(path, root));
        return true;
      } catch {
        return false; // test-only and androidTest source sets have no activity
      }
    })
    .map(({ flavor, path }) => ({ flavor, source: read(path) }));
}

describe('Android immersive mode', () => {
  const activity = read(`${ACTIVITY_DIR}/BaseMainActivity.java`);

  it('hides every system bar while preserving transient swipe access', () => {
    expect(activity).toContain('WindowCompat.getInsetsController(');
    expect(activity).toContain(
      'WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE',
    );
    expect(activity).toContain('controller.hide(WindowInsetsCompat.Type.systemBars());');
  });

  it('enters immersive mode on creation and whenever the activity regains focus', () => {
    expect(activity).toMatch(/super\.onCreate\(savedInstanceState\);\s+enterImmersiveMode\(\);/);
    expect(activity).toMatch(
      /onWindowFocusChanged\(boolean hasFocus\)[\s\S]*?super\.onWindowFocusChanged\(hasFocus\);[\s\S]*?if \(hasFocus\) \{[\s\S]*?enterImmersiveMode\(\);/,
    );
    expect(activity.match(/enterImmersiveMode\(\);/g)).toHaveLength(2);
  });

  it('reaches every shipped flavor, not just the base class it is written in', () => {
    // The guard above reads ONE file. After the flavor split that only proves the shipped
    // app enters immersive mode if every flavor's activity actually inherits it: a new
    // flavor extending BridgeActivity directly would ship without immersive mode while
    // this suite stayed green over a surface that no longer matched it.
    const flavors = flavorActivities();
    expect(flavors.map((f) => f.flavor).sort()).toEqual(['play', 'solanaStore']);
    for (const { flavor, source } of flavors) {
      expect(source, `${flavor} MainActivity must inherit the immersive base`).toMatch(
        /class MainActivity extends BaseMainActivity/,
      );
    }
  });
});
