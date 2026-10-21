/**
 * PayPal transports money as decimal strings ("12.50"). We do arithmetic in integer
 * minor units to avoid float drift, and only convert back at the API boundary.
 * Zero-decimal currencies per PayPal's currency-code table: HUF, JPY, TWD.
 */
export type Money = { currency_code: string; value: string };

const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);

export const decimalsFor = (currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2);

export function toMinor(value: string | number, currency: string): number {
  const d = decimalsFor(currency);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`);
  return Math.round(n * 10 ** d);
}

export function fromMinor(minor: number, currency: string): string {
  const d = decimalsFor(currency);
  return (minor / 10 ** d).toFixed(d);
}

export function money(value: string | number, currency: string): Money {
  const c = currency.toUpperCase();
  return { currency_code: c, value: fromMinor(toMinor(value, c), c) };
}

export const amountOf = (m?: Partial<Money> | null): number => (m?.value === undefined ? 0 : Number(m.value));

export function sumLines(lines: { quantity: number; unitPrice: number }[], currency: string): string {
  const total = lines.reduce((acc, l) => acc + Math.round(l.quantity * toMinor(l.unitPrice, currency)), 0);
  return fromMinor(total, currency);
}

export function formatMoney(value: number, currency: string): string {
  try {
    return value.toLocaleString('en-US', { style: 'currency', currency });
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
