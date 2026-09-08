type Form = 'bear' | 'cat' | 'moonkin' | 'travel' | 'metamorph';
type Slot = `${Form}Visual`;
interface FormView extends Partial<Record<Slot, unknown>> {
  formCompilePending?: unknown;
}

/** Prepare the actual retained preview rigs, serially: the existing compile
 * gate owns one pending root. No gameplay aura or preview clock is advanced. */
export async function prepareStudioForms(
  cls: string,
  view: FormView,
  build: (key: `form_${Form}`, slot: Slot) => void,
  pump: () => void,
  current: () => boolean,
  nextFrame: () => Promise<void> = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve())),
): Promise<void> {
  const forms: readonly Form[] =
    cls === 'druid'
      ? ['bear', 'cat', 'moonkin', 'travel']
      : cls === 'shaman'
        ? ['cat']
        : cls === 'warlock'
          ? ['metamorph']
          : [];
  for (const form of forms) {
    const slot = `${form}Visual` as Slot;
    while (current()) {
      // Never overwrite another pending root, including a form already being shown.
      if (!view.formCompilePending && !view[slot]) build(`form_${form}`, slot);
      pump();
      if (view[slot] && !view.formCompilePending) break;
      await nextFrame();
    }
    if (!current()) return;
  }
}
