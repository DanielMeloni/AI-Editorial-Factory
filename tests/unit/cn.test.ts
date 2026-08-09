import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';

describe('cn', () => {
  it('risolve i conflitti Tailwind facendo vincere l’ultima classe', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('ignora i valori falsy', () => {
    expect(cn('text-sm', false, undefined, null, 'font-medium')).toBe('text-sm font-medium');
  });
});
