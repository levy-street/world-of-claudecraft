import type { HeroicVendorTab } from './heroic_vendor_view';

export class HeroicVendorOperationState {
  pending: HeroicVendorTab | null = null;
  status: string | null = null;

  begin(tab: HeroicVendorTab, pendingText: string): boolean {
    if (this.pending !== null) return false;
    this.pending = tab;
    this.status = pendingText;
    return true;
  }

  resolve(successText: string): boolean {
    if (this.pending === null) return false;
    this.pending = null;
    this.status = successText;
    return true;
  }

  reject(errorText: string): boolean {
    if (this.pending === null) return false;
    this.pending = null;
    this.status = errorText;
    return true;
  }

  clearStatus(): void {
    if (this.pending === null) this.status = null;
  }

  reset(): void {
    this.pending = null;
    this.status = null;
  }
}
