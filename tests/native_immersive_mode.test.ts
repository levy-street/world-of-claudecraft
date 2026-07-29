import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');

describe('Android immersive mode', () => {
  const activity = read('android/app/src/main/java/com/worldofclaudecraft/MainActivity.java');

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
});
