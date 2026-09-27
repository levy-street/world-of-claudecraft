import {
  WORLD_QUEST_LEY_FX_LIMIT,
  type WorldQuestLeyEffect,
  worldQuestLeyOutcomeEffects,
} from './world_quest_ley_fx_view';
import type { WorldQuestLeyOutcome } from './world_quest_ley_view';

/** Cosmetic effects only. No clock, timer, or frame-loop controls puzzle state. */
export class WorldQuestLeyFxController {
  private effects = new Map<HTMLElement, Animation>();
  private rotations = new Set<Animation>();
  private media: MediaQueryList | null = null;
  private forced: MediaQueryList | null = null;
  private observer: MutationObserver | null = null;
  constructor(
    private readonly root: HTMLElement,
    private readonly layer: HTMLElement,
    private readonly document: Document,
  ) {
    const view = document.defaultView;
    this.media = view?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
    this.forced = view?.matchMedia?.('(forced-colors: active)') ?? null;
    this.media?.addEventListener('change', this.onSettings);
    this.forced?.addEventListener('change', this.onSettings);
    if (view?.MutationObserver) {
      this.observer = new view.MutationObserver(this.onSettings);
      this.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      this.observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-fx-level'],
      });
    }
  }
  playCircuit(
    path: readonly number[],
    cells: readonly HTMLButtonElement[],
    turns: readonly number[],
  ): void {
    this.cancel();
    if (!this.allowed()) return;
    for (const [index, turn] of turns.entries()) {
      const rotor = cells[index]?.querySelector<HTMLElement>('.wql-core');
      if (!turn || !rotor || typeof rotor.animate !== 'function') continue;
      let animation: Animation;
      try {
        animation = rotor.animate(
          [
            { transform: `translate(-50%, -50%) rotate(${-90 * turn}deg)` },
            { transform: 'translate(-50%, -50%) rotate(0deg)' },
          ],
          { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
      } catch {
        continue;
      }
      this.rotations.add(animation);
      animation.onfinish = animation.oncancel = () => {
        this.rotations.delete(animation);
      };
    }
    for (const [order, index] of path.entries()) {
      const cell = cells[index];
      if (!cell) continue;
      this.effect(
        {
          kind: 'pulse',
          x: 50,
          y: 50,
          dx: 0,
          dy: 0,
          angle: 0,
          duration: 850,
          delay: 110 + order * 95,
          size: 42,
        },
        cell,
      );
      for (let spark = 0; spark < 3; spark++) {
        const angle = ((spark * 120 + index * 31) * Math.PI) / 180;
        this.effect(
          {
            kind: 'star',
            x: 50,
            y: 50,
            dx: Math.cos(angle) * 29,
            dy: Math.sin(angle) * 29,
            angle: spark * 45,
            duration: 640,
            delay: 180 + order * 95 + spark * 40,
            size: 5,
          },
          cell,
        );
      }
    }
  }
  playOutcome(outcome: WorldQuestLeyOutcome): void {
    this.cancel();
    if (!this.allowed()) return;
    for (const effect of worldQuestLeyOutcomeEffects(outcome)) this.effect(effect, this.layer);
  }
  cancel(): void {
    for (const animation of this.rotations) {
      animation.onfinish = animation.oncancel = null;
      animation.cancel();
    }
    this.rotations.clear();
    for (const [element, animation] of this.effects) {
      animation.onfinish = animation.oncancel = null;
      animation.cancel();
      element.remove();
    }
    this.effects.clear();
  }
  dispose(): void {
    this.cancel();
    this.media?.removeEventListener('change', this.onSettings);
    this.forced?.removeEventListener('change', this.onSettings);
    this.observer?.disconnect();
    this.media = this.forced = null;
    this.observer = null;
  }
  private allowed(): boolean {
    return (
      this.root.isConnected &&
      !this.media?.matches &&
      !this.forced?.matches &&
      !this.document.body.classList.contains('reduce-motion') &&
      this.document.documentElement.dataset.fxLevel !== 'low'
    );
  }
  private readonly onSettings = (): void => {
    if (!this.allowed()) this.cancel();
  };
  private effect(effect: WorldQuestLeyEffect, parent: HTMLElement): void {
    if (this.effects.size >= WORLD_QUEST_LEY_FX_LIMIT || typeof parent.animate !== 'function')
      return;
    const element = this.document.createElement('span');
    element.className = `wql-effect wql-effect-${effect.kind}`;
    element.setAttribute('aria-hidden', 'true');
    element.style.left = `${effect.x}%`;
    element.style.top = `${effect.y}%`;
    element.style.setProperty('--wql-effect-size', `${effect.size}px`);
    parent.appendChild(element);
    const centered = `translate(-50%, -50%) rotate(${effect.angle}deg)`;
    let frames: Keyframe[];
    if (effect.kind === 'ring' || effect.kind === 'pulse')
      frames = [
        { opacity: 0, transform: `${centered} scale(.18)` },
        { opacity: 0.85, offset: 0.18, transform: `${centered} scale(.7)` },
        { opacity: 0.3, offset: 0.6, transform: `${centered} scale(1.25)` },
        { opacity: 0, transform: `${centered} scale(1.7)` },
      ];
    else if (effect.kind === 'ray')
      frames = [
        { opacity: 0, transform: `${centered} scaleY(.15)` },
        { opacity: 0.45, offset: 0.25, transform: `${centered} scaleY(1)` },
        { opacity: 0.2, offset: 0.7, transform: `${centered} scaleY(1.2)` },
        { opacity: 0, transform: `${centered} scaleY(1.4)` },
      ];
    else
      frames = [
        { opacity: 0, transform: `${centered} scale(.15)` },
        {
          opacity: 0.95,
          offset: 0.18,
          transform: `translate(calc(-50% + ${effect.dx * 0.15}px), calc(-50% + ${effect.dy * 0.4}px)) rotate(${effect.angle + 25}deg) scale(1)`,
        },
        {
          opacity: 0.7,
          offset: 0.55,
          transform: `translate(calc(-50% + ${effect.dx * 0.65}px), calc(-50% + ${effect.dy}px)) rotate(${effect.angle + 80}deg) scale(.8)`,
        },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${effect.dx}px), calc(-50% + ${effect.dy * 0.55 + 30}px)) rotate(${effect.angle + 155}deg) scale(.1)`,
        },
      ];
    let animation: Animation;
    try {
      animation = element.animate(frames, {
        duration: effect.duration,
        delay: effect.delay,
        easing: 'linear',
        fill: 'both',
      });
    } catch {
      element.remove();
      return;
    }
    this.effects.set(element, animation);
    const clean = () => {
      animation.onfinish = animation.oncancel = null;
      this.effects.delete(element);
      element.remove();
      animation.cancel();
    };
    animation.onfinish = animation.oncancel = clean;
  }
}
