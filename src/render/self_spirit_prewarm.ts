// Warms the LOCAL player's OWN body ghost (spirit) TRANSPARENT shader variants
// ahead of death. When a player dies and releases their spirit the body renders
// translucent (CharacterVisual.setGhost), which flips `transparent` and makes
// three key a SECOND program per body material. The local player's view is
// UNGATED by design (it must be visible immediately), and the boot player
// prewarm only warms the GENERIC default-look class archetypes, never the
// player's own equipped/composed look, so those ~20 transparent variants link
// SYNCHRONOUSLY on the first spirit release: a measured ~2.2 s submit stall on a
// geared, customized character. This scheduler links them off-thread on an idle
// slot instead, so the spirit flip reuses cached, already-linked programs.
//
// The scheduler owns only the WHEN: warm once per distinct local look, coalesce
// bursts (a gear-swap sequence warms once), never overlap two warms, and always
// re-read the current visual when a warm actually fires. The compile itself
// (the setGhost -> compileAsync -> restore dance, which needs the renderer's
// private WebGL state) is the injected `warm` callback. A Vitest drives the
// scheduling with fake warm/idle.

export interface SelfSpiritPrewarmDeps {
  /** Link the local player's spirit variants off-thread. Re-reads the current
   *  self visual itself; resolves true only when a compile actually ran. */
  warm: () => Promise<boolean>;
  /** Await an idle slot before the warm, so it never lands on a live frame. */
  idle: () => Promise<void>;
}

/** Opaque marker for the local visual instance whose look has been warmed. Kept
 *  as an object identity (the CharacterVisual) plus the material-affecting wire
 *  fields, so a rebuild (new instance) or an in-place skin/weapon swap both
 *  re-arm, while an unchanged frame does nothing. */
type WarmedLook = {
  visual: object | null;
  skin: number;
  mainhand: string | null;
  offhand: string | null;
  weaponSkin: string | null;
};

export class SelfSpiritPrewarmer {
  private warmed: WarmedLook = {
    visual: null,
    skin: -1,
    mainhand: null,
    offhand: null,
    weaponSkin: null,
  };
  private inFlight = false;
  private active: WarmedLook | null = null;
  private pending: WarmedLook | null = null;

  constructor(private readonly deps: SelfSpiritPrewarmDeps) {}

  /** Call once per frame for the local player once its visual exists. A change
   *  in the visual instance (a recompose) or in the skin/weapon ids re-arms the
   *  warm; an identical call is a no-op. */
  observe(
    visual: object,
    skin: number,
    mainhand: string | null,
    offhand: string | null,
    weaponSkin: string | null,
  ): void {
    const look = { visual, skin, mainhand, offhand, weaponSkin };
    if (sameLook(look, this.warmed)) return;
    if (this.active && sameLook(look, this.active)) return;
    if (this.pending && sameLook(look, this.pending)) return;
    this.pending = look;
    this.schedule();
  }

  private schedule(): void {
    if (this.inFlight || !this.pending) return;
    this.inFlight = true;
    void this.run();
  }

  private async run(): Promise<void> {
    try {
      while (this.pending) {
        const idleLook = this.pending;
        this.pending = null;
        await this.deps.idle();
        const look = this.pending ?? idleLook;
        this.pending = null;
        this.active = look;
        const warmed = await this.deps.warm();
        this.active = null;
        if (warmed) {
          this.warmed = look;
          if (this.pending && sameLook(this.pending, this.warmed)) this.pending = null;
        }
      }
    } catch {
      // Soft-fail: a context loss or shutdown race must never wedge the lane.
      // Whatever stays cold still links on the spirit flip, same as before.
    } finally {
      this.active = null;
      this.inFlight = false;
      this.schedule();
    }
  }
}

function sameLook(a: WarmedLook, b: WarmedLook): boolean {
  return (
    a.visual === b.visual &&
    a.skin === b.skin &&
    a.mainhand === b.mainhand &&
    a.offhand === b.offhand &&
    a.weaponSkin === b.weaponSkin
  );
}
