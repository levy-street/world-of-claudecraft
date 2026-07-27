// Canonical binding codes for pointer inputs. Browser MouseEvent.button uses
// 0=primary, 1=middle, 2=secondary, while MMO labels conventionally call those
// Mouse 1, Mouse 3, and Mouse 2. Side buttons continue from Mouse 4.

export function mouseButtonBindingCode(button: number): string | null {
  if (!Number.isInteger(button) || button < 0 || button > 31) return null;
  if (button === 0) return 'Mouse1';
  if (button === 1) return 'Mouse3';
  if (button === 2) return 'Mouse2';
  return `Mouse${button + 1}`;
}

export function wheelBindingCode(deltaY: number): 'WheelUp' | 'WheelDown' | null {
  if (!Number.isFinite(deltaY) || deltaY === 0) return null;
  return deltaY < 0 ? 'WheelUp' : 'WheelDown';
}

export function isWheelBindingCode(combo: string): boolean {
  const code = combo.slice(combo.lastIndexOf('+') + 1);
  return code === 'WheelUp' || code === 'WheelDown';
}

export function pointerBindingLabel(code: string): string | null {
  const mouse = /^Mouse(\d+)$/.exec(code);
  if (mouse) return `Mouse ${mouse[1]}`;
  if (code === 'WheelUp') return 'Wheel Up';
  if (code === 'WheelDown') return 'Wheel Down';
  return null;
}
