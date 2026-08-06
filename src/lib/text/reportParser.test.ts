import { describe, it, expect } from 'vitest';
import { parseReport } from './reportParser';

describe('parseReport', () => {
  it('extrait un médicament daté avec sa dose', () => {
    const list = parseReport('Mai 2020 : CELLCEPT 3 g/jour');
    const cc = list.find(t => /cellcept/i.test(t.name));
    expect(cc).toBeTruthy();
    expect(cc!.date).toBe('2020-05-01');
    expect(cc!.dose.replace(/\s/g, '')).toContain('3g');
    expect(cc!.kind).toBe('continuous');
  });

  it('associe la date antérieure la plus proche', () => {
    const txt = '01/03/2021 SOLUMEDROL 1000 mg. 15/03/2021 PLAQUENIL 400 mg';
    const list = parseReport(txt);
    const plaq = list.find(t => /plaquenil/i.test(t.name));
    expect(plaq!.date).toBe('2021-03-15');
  });

  it('marque un arrêt comme isStop', () => {
    const list = parseReport('06/2021 : arrêt CELLCEPT');
    const cc = list.find(t => /cellcept/i.test(t.name));
    expect(cc).toBeTruthy();
    expect(cc!.isStop).toBe(true);
  });

  it('détecte une cure comme événement ponctuel', () => {
    const list = parseReport('03/2022 : cure de RITUXIMAB 1 g');
    const rtx = list.find(t => /rituximab/i.test(t.name));
    expect(rtx!.kind).toBe('event');
  });

  it('ignore les acronymes de la liste noire', () => {
    const list = parseReport('EFR normale, DLCO à 80%, VEMS conservé');
    expect(list).toHaveLength(0);
  });

  it('résout les dates relatives Mn depuis la première date absolue', () => {
    const list = parseReport('Janvier 2020 : SOLUMEDROL. M6 : ENDOXAN 500 mg');
    const endo = list.find(t => /endoxan/i.test(t.name));
    expect(endo!.date).toBe('2020-07-01');
  });

  it('ne contamine pas un traitement continu avec le « bolus » du précédent', () => {
    // Régression : le « bolus x3 » du SOLUMEDROL faisait basculer le
    // CORTANCYL en événement — une corticothérapie de plusieurs mois se
    // réduisait alors à une flèche ponctuelle sur le graphique.
    const list = parseReport(
      'Depuis le 12 juin 2024, SOLUMEDROL 1 g en bolus x3 puis CORTANCYL 60 mg/j.',
    );
    const smd = list.find(t => /solumedrol/i.test(t.name));
    const ctc = list.find(t => /cortancyl/i.test(t.name));
    expect(smd!.kind).toBe('event');
    expect(ctc!.kind).toBe('continuous');
    expect(ctc!.dose).toBe('60 mg/j');
  });

  it('reconnaît encore un qualificatif placé avant le médicament', () => {
    const list = parseReport('Mars 2023 : bolus de SOLUMEDROL 1 g');
    expect(list.find(t => /solumedrol/i.test(t.name))!.kind).toBe('event');
  });

  it('renvoie une liste vide pour un texte vide', () => {
    expect(parseReport('')).toEqual([]);
  });
});
