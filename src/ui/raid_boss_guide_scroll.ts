// Event-driven scrolling for the raid encounter journal. The game owns global
// wheel and keyboard bindings, so the guide handles these gestures at its own
// bounded scroll region instead of relying on browser bubbling through the HUD.

export function bindRaidBossGuideScroll(journal: HTMLElement): void {
  const moveTo = (next: number, event: Event) => {
    const maximum = Math.max(0, journal.scrollHeight - journal.clientHeight);
    if (maximum <= 0) return;
    event.preventDefault();
    journal.scrollTop = Math.max(0, Math.min(maximum, next));
  };
  journal.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 32
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? journal.clientHeight
            : 1;
      moveTo(journal.scrollTop + event.deltaY * unit, event);
    },
    { passive: false },
  );
  journal.addEventListener('keydown', (event) => {
    if (event.target !== journal) return;
    const page = Math.max(48, journal.clientHeight * 0.85);
    if (event.key === 'ArrowDown') moveTo(journal.scrollTop + 48, event);
    else if (event.key === 'ArrowUp') moveTo(journal.scrollTop - 48, event);
    else if (event.key === 'PageDown') moveTo(journal.scrollTop + page, event);
    else if (event.key === 'PageUp') moveTo(journal.scrollTop - page, event);
    else if (event.key === 'Home') moveTo(0, event);
    else if (event.key === 'End') moveTo(journal.scrollHeight, event);
  });
}
