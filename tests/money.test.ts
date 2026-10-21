import { describe, expect, it } from 'vitest';
import { fromMinor, money, sumLines, toMinor } from '@/lib/money';

describe('money', () => {
  it('formats PayPal decimal strings without float drift', () => {
    expect(money(0.1 + 0.2, 'usd')).toEqual({ currency_code: 'USD', value: '0.30' });
    expect(sumLines([{ quantity: 3, unitPrice: 19.99 }, { quantity: 1, unitPrice: 0.03 }], 'USD')).toBe('60.00');
  });
  it('respects zero-decimal currencies', () => {
    expect(money(1234.6, 'JPY').value).toBe('1235');
    expect(toMinor('12.34', 'USD')).toBe(1234);
    expect(fromMinor(1234, 'USD')).toBe('12.34');
  });
  it('rejects garbage', () => {
    expect(() => toMinor('abc', 'USD')).toThrow();
  });
});
