import { describe, it, expect } from 'vitest';
import { parseDate, formatDate, dayNumber } from './types';

describe('parseDate', () => {
  it('accepte le format ISO', () => {
    expect(parseDate('2023-04-09')).toBe('2023-04-09');
  });

  it('convertit JJ/MM/AAAA', () => {
    expect(parseDate('09/04/2023')).toBe('2023-04-09');
    expect(parseDate('9/4/2023')).toBe('2023-04-09');
  });

  it('accepte les séparateurs - et .', () => {
    expect(parseDate('09-04-2023')).toBe('2023-04-09');
    expect(parseDate('09.04.2023')).toBe('2023-04-09');
  });

  it('gère l’année sur 2 chiffres (pivot 70)', () => {
    expect(parseDate('01/01/23')).toBe('2023-01-01');
    expect(parseDate('01/01/85')).toBe('1985-01-01');
  });

  it('rejette les dates invalides', () => {
    expect(parseDate('32/01/2023')).toBeNull();
    expect(parseDate('01/13/2023')).toBeNull();
    expect(parseDate('2023-13-01')).toBeNull();
    expect(parseDate('pas une date')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('ne devine pas JJ/MM sans année', () => {
    expect(parseDate('09/04')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formate ISO → JJ/MM/AAAA', () => {
    expect(formatDate('2023-04-09')).toBe('09/04/2023');
  });
  it('laisse inchangé un format inconnu', () => {
    expect(formatDate('bidon')).toBe('bidon');
  });
});

describe('dayNumber', () => {
  it('est monotone croissant dans le temps', () => {
    expect(dayNumber('2023-01-02')).toBe(dayNumber('2023-01-01') + 1);
  });
});
