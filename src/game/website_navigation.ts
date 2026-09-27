/** Keep the browser login page resident while preserving embedded-shell navigation. */
export function openHeaderWiki(embeddedShell: boolean): void {
  if (embeddedShell) {
    window.location.assign('/wiki');
  } else {
    window.open('/wiki', '_blank', 'noopener,noreferrer');
  }
}
