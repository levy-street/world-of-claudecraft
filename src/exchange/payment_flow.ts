import type { WocQuoteView } from '../net/woc_market_sdk';

export class StaleExchangeOperation extends Error {}

export class ExchangeOperationGate {
  private generation = 0;
  private running = false;

  begin(): number | null {
    if (this.running) return null;
    this.running = true;
    return ++this.generation;
  }

  isRunning(): boolean {
    return this.running;
  }

  invalidate(): void {
    this.generation += 1;
    this.running = false;
  }

  finish(operation: number): void {
    if (operation === this.generation) this.running = false;
  }

  assertCurrent(operation: number): void {
    if (operation !== this.generation) throw new StaleExchangeOperation();
  }
}

export async function payServerQuote(
  quote: WocQuoteView,
  send: (transactionBase64: string) => Promise<string>,
): Promise<string> {
  if (quote.signatureRequired === false) return `devsig:${quote.reference ?? ''}`;
  if (!quote.transactionBase64) throw new Error('missing server transaction');
  return send(quote.transactionBase64);
}
