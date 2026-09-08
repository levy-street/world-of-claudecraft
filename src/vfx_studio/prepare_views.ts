interface PreparingView {
  compilePending?: boolean;
  formCompilePending?: unknown;
}

interface PreviewRenderer {
  views: ReadonlyMap<number, PreparingView>;
  sync(
    alpha: number,
    dt: number,
    facing: null,
    lead: number,
    motion: null,
    discontinuity: boolean,
    present: boolean,
  ): void;
}

/** Advance the existing preparation scheduler without advancing a frozen take.
 * Awaiting its promises with no frame callbacks starves its admission budget. */
export async function prepareStudioViews(
  renderer: PreviewRenderer,
  required: readonly number[],
  current: () => boolean,
  nextFrame: () => Promise<void> = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve())),
): Promise<void> {
  while (current()) {
    renderer.sync(1, 0, null, 0, null, true, false);
    if (
      required.every((id) => {
        const view = renderer.views.get(id);
        return view && !view.compilePending && !view.formCompilePending;
      })
    )
      return;
    await nextFrame();
  }
}
