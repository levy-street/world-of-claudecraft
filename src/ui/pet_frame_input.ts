import { bindTouchDoubleTap } from './touch_tap';

/** The pet portrait and its target-frame counterpart use the same live pet menu. */
export function bindPetFrameInput(
  frame: HTMLElement,
  deps: {
    editing(): boolean;
    mobile(): boolean;
    pet(): { id: number; name: string; dead: boolean } | null;
    select(): void;
    menu(id: number, name: string, dead: boolean, x: number, y: number): void;
  },
): (x: number, y: number) => void {
  const open = (x: number, y: number) => {
    if (deps.editing()) return;
    const pet = deps.pet();
    if (pet) deps.menu(pet.id, pet.name, pet.dead, x, y);
  };
  frame.addEventListener('click', () => {
    if (!deps.editing()) deps.select();
  });
  frame.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    open(event.clientX, event.clientY);
  });
  frame.addEventListener('keydown', (event) => {
    if (deps.editing()) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const box = frame.getBoundingClientRect();
      open(box.left, box.bottom);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      deps.select();
    }
  });
  bindTouchDoubleTap(frame, (event) => {
    const pointer = event as PointerEvent;
    if (deps.mobile()) open(pointer.clientX, pointer.clientY);
  });
  return open;
}
