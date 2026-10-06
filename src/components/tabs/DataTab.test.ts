// @vitest-environment jsdom
// Grille de saisie : affiche les valeurs du suivi et enregistre une saisie.
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import DataTab from './DataTab.svelte';
import { store } from '../../lib/models/store.svelte';

beforeAll(() => {
  // jsdom n'a ni matchMedia (écran de bureau) ni ResizeObserver.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});

describe('DataTab', () => {
  it('affiche la valeur saisie et enregistre une modification', async () => {
    const p = store.addParameter({ name: 'CRP', unit: 'mg/L', category: 'biologie' });
    store.setMeasurement(p.id, '2025-01-10', 12);
    render(DataTab);
    const cases = screen.getAllByLabelText('CRP au 10/01/2025') as HTMLInputElement[];
    expect(cases.length).toBeGreaterThan(0);
    const c = cases[0];
    expect(c.value).toBe('12');
    await fireEvent.focus(c);
    await fireEvent.input(c, { target: { value: '4,5' } });
    await fireEvent.blur(c);
    expect(store.valueAt(p.id, '2025-01-10')!.value).toBe(4.5);
  });
});
