import { selectLoadingBackdropPath } from './loading_backdrop_core';

type AssetUrlResolver = (logicalPath: string) => string;
type RandomUnitSource = () => number;
type SaveDataSource = () => boolean;

/** Data Saver preference via the nonstandard Network Information API; guarded
 *  so the read is safe on engines without it (and in plain-Node tests). */
function navigatorPrefersReducedData(): boolean {
  try {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    return connection?.saveData === true;
  } catch {
    return false;
  }
}

export class LoadingBackdropController {
  private readonly preloadLink: HTMLLinkElement;
  private currentPath: string | undefined;
  private preparedPath: string | undefined;
  private initialBackdropPrepared = false;

  constructor(
    private readonly curtain: HTMLElement,
    private readonly resolveAssetUrl: AssetUrlResolver,
    private readonly randomUnit: RandomUnitSource = Math.random,
    private readonly prefersReducedData: SaveDataSource = navigatorPrefersReducedData,
  ) {
    const documentRef = curtain.ownerDocument;
    const existing = documentRef.head.querySelector<HTMLLinkElement>(
      'link[data-loading-backdrop-preload]',
    );
    this.preloadLink = existing ?? documentRef.createElement('link');
    this.preloadLink.setAttribute('rel', 'preload');
    this.preloadLink.setAttribute('as', 'image');
    this.preloadLink.setAttribute('type', 'image/webp');
    this.preloadLink.setAttribute('fetchpriority', 'high');
    this.preloadLink.setAttribute('data-loading-backdrop-preload', '');
    if (!existing) documentRef.head.appendChild(this.preloadLink);
  }

  prepareInitial(): void {
    if (this.currentPath) return;
    this.applyBackdrop(this.selectNextPath(), 'high');
    this.initialBackdropPrepared = true;
  }

  enterNewCycle(): void {
    if (this.initialBackdropPrepared) {
      this.initialBackdropPrepared = false;
      return;
    }
    const nextPath = this.preparedPath ?? this.selectNextPath();
    this.preparedPath = undefined;
    this.applyBackdrop(nextPath, 'high');
  }

  /** Select and preload the next cycle without changing the visible curtain. */
  prepareNextCycle(): void {
    if (this.preparedPath) return;
    // Data Saver: the next cycle is a speculative full-size WebP for a cycle
    // many sessions never reach, so skip the fetch and let enterNewCycle
    // select and load on demand when a cycle actually starts.
    if (this.prefersReducedData()) return;
    this.preparedPath = this.selectNextPath();
    this.setPreload(this.preparedPath, 'low');
  }

  private selectNextPath(): string {
    return selectLoadingBackdropPath(this.randomUnit(), this.currentPath);
  }

  private setPreload(path: string, priority: 'high' | 'low'): string {
    const resolvedUrl = this.resolveAssetUrl(path);
    this.preloadLink.setAttribute('fetchpriority', priority);
    this.preloadLink.setAttribute('href', resolvedUrl);
    return resolvedUrl;
  }

  private applyBackdrop(path: string, priority: 'high' | 'low'): void {
    const resolvedUrl = this.setPreload(path, priority);
    this.currentPath = path;
    this.curtain.style.setProperty(
      '--loading-backdrop-image',
      `url(${JSON.stringify(resolvedUrl)})`,
    );
  }
}
