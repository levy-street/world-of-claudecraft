import type { Input, TouchMoveInput } from './input';

export const PHONE_TOUCH_QUERY = '(pointer: coarse) and (max-width: 940px), (pointer: coarse) and (max-height: 760px)';
const DEADZONE = 0.22;
const CAMERA_SENSITIVITY = 0.8;

export interface MobileControlCallbacks {
  onAttackNearest(): void;
  onTarget(): void;
  onInteract(): void;
  onChat(): void;
  onMenu(): void;
  onSocial(): void;
  onArena(): void;
  onQuestLog(): void;
  onSpellbook(): void;
  onTalents(): void;
  onMeters(): void;
  onMap(): void;
}

export function isPhoneTouchDevice(win: Pick<Window, 'matchMedia'> = window): boolean {
  return win.matchMedia(PHONE_TOUCH_QUERY).matches;
}

export function mapJoystickVector(x: number, y: number, deadzone = DEADZONE): TouchMoveInput {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { forward: false, back: false, strafeLeft: false, strafeRight: false };
  const axis = deadzone * 0.85;
  return {
    forward: y < -axis,
    back: y > axis,
    strafeLeft: x < -axis,
    strafeRight: x > axis,
  };
}

export class MobileControls {
  private active = false;
  private joyPointer: number | null = null;
  private lookPointer: number | null = null;
  private mq: MediaQueryList | null = null;

  private root = document.getElementById('mobile-controls') as HTMLElement | null;
  private moveJoystick = document.getElementById('mobile-move-joystick') as HTMLElement | null;
  private moveStick = document.getElementById('mobile-move-stick') as HTMLElement | null;
  private cameraJoystick = document.getElementById('mobile-camera-joystick') as HTMLElement | null;
  private cameraStick = document.getElementById('mobile-camera-stick') as HTMLElement | null;

  constructor(private input: Input, private callbacks: MobileControlCallbacks) {}

  start(): void {
    if (!this.root || !this.moveJoystick || !this.moveStick || !this.cameraJoystick || !this.cameraStick) return;
    this.mq = window.matchMedia(PHONE_TOUCH_QUERY);
    this.setActive(this.mq.matches);
    this.mq.addEventListener?.('change', (e) => this.setActive(e.matches));

    this.moveJoystick.addEventListener('pointerdown', (e) => this.onMoveDown(e));
    this.moveJoystick.addEventListener('pointermove', (e) => this.onMoveMove(e));
    this.moveJoystick.addEventListener('pointerup', (e) => this.onMoveEnd(e));
    this.moveJoystick.addEventListener('pointercancel', (e) => this.onMoveEnd(e));

    this.cameraJoystick.addEventListener('pointerdown', (e) => this.onCameraDown(e));
    this.cameraJoystick.addEventListener('pointermove', (e) => this.onCameraMove(e));
    this.cameraJoystick.addEventListener('pointerup', (e) => this.onCameraEnd(e));
    this.cameraJoystick.addEventListener('pointercancel', (e) => this.onCameraEnd(e));

    this.bindButton('mobile-attack-nearest', () => this.callbacks.onAttackNearest());
    this.bindButton('mobile-target', () => this.callbacks.onTarget());
    this.bindButton('mobile-interact', () => this.callbacks.onInteract());
    this.bindButton('mobile-chat', () => this.toggleChat());
    this.bindButton('mobile-menu', () => this.callbacks.onMenu());
    this.bindButton('mobile-social', () => this.callbacks.onSocial());
    this.bindButton('mobile-arena', () => this.callbacks.onArena());
    this.bindButton('mobile-quest', () => this.callbacks.onQuestLog());
    this.bindButton('mobile-spellbook', () => this.callbacks.onSpellbook());
    this.bindButton('mobile-talents', () => this.callbacks.onTalents());
    this.bindButton('mobile-meters', () => this.callbacks.onMeters());
    this.bindButton('mobile-map', () => this.callbacks.onMap());
    this.bindButton('mobile-more', () => {
      this.root?.classList.toggle('expanded');
      document.body.classList.toggle('mobile-more-open', this.root?.classList.contains('expanded') ?? false);
    });
  }

  private setActive(active: boolean): void {
    this.active = active;
    document.body.classList.toggle('mobile-touch', active);
    if (!active) {
      this.root?.classList.remove('expanded');
      document.body.classList.remove('mobile-more-open', 'mobile-chat-open');
      this.releaseMove();
      this.releaseCamera();
    } else {
      document.body.classList.remove('mobile-chat-open');
    }
  }

  private bindButton(id: string, cb: () => void): void {
    const button = document.getElementById(id);
    button?.addEventListener('click', (e) => {
      if (!this.active) return;
      e.preventDefault();
      cb();
      if (button.closest('#mobile-extra-controls')) {
        this.root?.classList.remove('expanded');
        document.body.classList.remove('mobile-more-open');
      }
    });
  }

  private toggleChat(): void {
    document.body.classList.toggle('mobile-chat-open');
    if (document.body.classList.contains('mobile-chat-open')) {
      this.callbacks.onChat();
    } else {
      const input = document.getElementById('chat-input') as HTMLInputElement | null;
      if (input) {
        input.value = '';
        input.style.display = 'none';
        input.blur();
      }
    }
  }

  private onMoveDown(e: PointerEvent): void {
    if (!this.active || this.joyPointer !== null) return;
    e.preventDefault();
    this.joyPointer = e.pointerId;
    try { this.moveJoystick?.setPointerCapture(e.pointerId); } catch { /* synthetic test event */ }
    this.onMoveMove(e);
  }

  private onMoveMove(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.joyPointer || !this.moveJoystick || !this.moveStick) return;
    e.preventDefault();
    const r = this.moveJoystick.getBoundingClientRect();
    const radius = Math.max(1, r.width / 2);
    const rawX = (e.clientX - (r.left + radius)) / radius;
    const rawY = (e.clientY - (r.top + radius)) / radius;
    const mag = Math.max(1, Math.hypot(rawX, rawY));
    const x = rawX / mag;
    const y = rawY / mag;
    this.moveStick.style.transform = `translate(${(x * radius * 0.46).toFixed(1)}px, ${(y * radius * 0.46).toFixed(1)}px)`;
    this.input.setTouchMove(mapJoystickVector(x, y));
  }

  private onMoveEnd(e: PointerEvent): void {
    if (e.pointerId !== this.joyPointer) return;
    e.preventDefault();
    this.releaseMove();
  }

  private releaseMove(): void {
    this.joyPointer = null;
    this.input.clearTouchMove();
    if (this.moveStick) this.moveStick.style.transform = '';
  }

  private onCameraDown(e: PointerEvent): void {
    if (!this.active || this.lookPointer !== null) return;
    e.preventDefault();
    this.lookPointer = e.pointerId;
    this.input.setTouchLook(true);
    try { this.cameraJoystick?.setPointerCapture(e.pointerId); } catch { /* synthetic test event */ }
    this.onCameraMove(e);
  }

  private onCameraMove(e: PointerEvent): void {
    if (!this.active || e.pointerId !== this.lookPointer || !this.cameraJoystick || !this.cameraStick) return;
    e.preventDefault();
    const r = this.cameraJoystick.getBoundingClientRect();
    const radius = Math.max(1, r.width / 2);
    const rawX = (e.clientX - (r.left + radius)) / radius;
    const rawY = (e.clientY - (r.top + radius)) / radius;
    const mag = Math.max(1, Math.hypot(rawX, rawY));
    const x = rawX / mag;
    const y = rawY / mag;
    this.cameraStick.style.transform = `translate(${(x * radius * 0.42).toFixed(1)}px, ${(y * radius * 0.42).toFixed(1)}px)`;
    this.input.setTouchLookVector(mapLookVector(x, y));
  }

  private onCameraEnd(e: PointerEvent): void {
    if (e.pointerId !== this.lookPointer) return;
    e.preventDefault();
    this.releaseCamera();
  }

  private releaseCamera(): void {
    this.lookPointer = null;
    this.input.setTouchLook(false);
    this.input.setTouchLookVector({ x: 0, y: 0 });
    if (this.cameraStick) this.cameraStick.style.transform = '';
  }
}

export function mapLookVector(x: number, y: number, deadzone = DEADZONE): { x: number; y: number } {
  if (Math.hypot(x, y) < deadzone) return { x: 0, y: 0 };
  return { x: x * CAMERA_SENSITIVITY, y: y * CAMERA_SENSITIVITY };
}
