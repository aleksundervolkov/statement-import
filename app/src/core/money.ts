import type { RecurringItem } from './types';

export function formatMinor(amountMinor: number, currency: string): string {
  return `${(amountMinor / 100).toFixed(2)} ${currency}`;
}

export function monthlyTotalMinor(items: RecurringItem[]): number {
  return items.filter(item => item.cadence === 'monthly').reduce((sum, item) => sum + item.amountMinor, 0);
}
