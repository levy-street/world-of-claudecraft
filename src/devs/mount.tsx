// Mounts the native React Devs portal into a DOM node owned by the vanilla-TS
// game client. Dynamically imported on first open so React ships in its own
// chunk and costs nothing during normal play.
import { createRoot, type Root } from 'react-dom/client';
import { DevsPortal } from './DevsPortal';
import type { DevsApiConfig } from './api';

let root: Root | null = null;

export function mountDevsPortal(el: HTMLElement, config: DevsApiConfig): void {
  if (!root) root = createRoot(el);
  root.render(<DevsPortal config={config} />);
}
