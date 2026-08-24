export interface ActionCameraCrosshair {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Owns the optional action-camera crosshair and elides unchanged visibility writes. */
export function createActionCameraCrosshair(doc: Document = document): ActionCameraCrosshair {
  const element = doc.createElement('div');
  element.id = 'action-camera-crosshair';
  element.setAttribute('aria-hidden', 'true');
  element.hidden = true;
  doc.body.appendChild(element);
  let shown = false;
  return {
    setVisible(visible) {
      if (visible === shown) return;
      shown = visible;
      element.hidden = !visible;
    },
    dispose() {
      element.remove();
    },
  };
}
