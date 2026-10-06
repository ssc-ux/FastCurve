// @vitest-environment jsdom
// Tests de composants : l'aide clavier, l'écran de vérification d'une
// capture (proposition de virgule), et les règles clavier partagées.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import AideClavier from './AideClavier.svelte';
import { uiBus } from '../lib/models/ui.svelte';
import { toucheVerification, RACCOURCIS } from '../lib/clavier';

beforeAll(() => {
  // jsdom n'implémente pas encore <dialog>.showModal().
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };
});

describe('AideClavier', () => {
  it('s’ouvre sur demande, liste les raccourcis et se ferme', async () => {
    render(AideClavier);
    const dlg = document.querySelector('dialog')!;
    expect(dlg.open).toBe(false);
    uiBus.aideClavier = true; flushSync();
    expect(dlg.open).toBe(true);
    expect(screen.getAllByRole('row')).toHaveLength(RACCOURCIS.length);
    await fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    flushSync();
    expect(uiBus.aideClavier).toBe(false);
    expect(dlg.open).toBe(false);
  });
});

describe('toucheVerification', () => {
  const touche = (key: string, cible: HTMLElement, mods: Partial<KeyboardEventInit> = {}) => {
    const e = new KeyboardEvent('keydown', { key, cancelable: true, ...mods });
    Object.defineProperty(e, 'target', { value: cible });
    return e;
  };
  const div = document.createElement('div');
  const champ = document.createElement('input');

  it('Entrée valide hors champ, pas dans un champ (il faut Ctrl+Entrée)', () => {
    const valider = vi.fn(), annuler = vi.fn();
    toucheVerification(touche('Enter', div), { valider, annuler, peutValider: true });
    toucheVerification(touche('Enter', champ), { valider, annuler, peutValider: true });
    expect(valider).toHaveBeenCalledTimes(1);
    toucheVerification(touche('Enter', champ, { ctrlKey: true }), { valider, annuler, peutValider: true });
    expect(valider).toHaveBeenCalledTimes(2);
  });

  it('ne valide pas tant qu’il manque une date', () => {
    const valider = vi.fn();
    toucheVerification(touche('Enter', div), { valider, annuler: vi.fn(), peutValider: false });
    expect(valider).not.toHaveBeenCalled();
  });

  it('Échap quitte d’abord le champ, puis annule', () => {
    const annuler = vi.fn();
    document.body.append(champ); champ.focus();
    toucheVerification(touche('Escape', champ), { valider: vi.fn(), annuler, peutValider: true });
    expect(annuler).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(champ);
    toucheVerification(touche('Escape', div), { valider: vi.fn(), annuler, peutValider: true });
    expect(annuler).toHaveBeenCalledOnce();
  });
});
