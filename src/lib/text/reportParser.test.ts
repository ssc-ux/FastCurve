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

  // ── Robustesse « carré bleu » réel (photo CHU fournie par le médecin) ──
  // Ligne pharmacothérapeutique : CELLCEPT / PREDNISONE / LANSOPRAZOLE / ZYMAD.
  // Ces comptes-rendus sont « plus ou moins précis » et « ne suivent aucun
  // plan précis » (dixit le médecin) : liste à puces, paragraphe narratif ou
  // dictée Dragon doivent tous les trois donner un résultat exploitable, et
  // le bruit clinique alentour ne doit jamais produire de faux traitement.

  it('liste à puces propre (carré bleu type CHU) : les 4 lignes, doses et rythmes complets', () => {
    const txt = [
      'CELLCEPT 1,5 g matin et soir',
      'PREDNISONE 10 mg le matin',
      'LANSOPRAZOLE 30 mg le soir',
      'ZYMAD 50 000 UI 1 ampoule par mois',
    ].join('\n');
    const list = parseReport(txt);
    expect(list).toHaveLength(4);
    const byName = (re: RegExp) => list.find(t => re.test(t.name));
    expect(byName(/cellcept/i)!.dose).toBe('1,5 g matin et soir');
    expect(byName(/prednisone/i)!.dose).toBe('10 mg le matin');
    expect(byName(/lansoprazole/i)!.dose).toBe('30 mg le soir');
    // Séparateur de milliers façon compte-rendu imprimé (« 50 000 UI » et non
    // « 000 UI » en perdant les dizaines de mille) + rythme « 1 ampoule par mois ».
    expect(byName(/zymad/i)!.dose).toBe('50 000 UI 1 ampoule par mois');
  });

  it('dictée Dragon (mêmes traitements, nombres épelés, sans ponctuation soignée)', () => {
    const dicte = parseReport(
      'la patiente est actuellement sous cellcept un virgule cinq grammes matin et soir ' +
      'et prednisone dix milligrammes le matin',
    );
    const propre = parseReport('CELLCEPT 1,5 g matin et soir\nPREDNISONE 10 mg le matin');
    const norm = (l: ReturnType<typeof parseReport>) =>
      l.map(t => `${t.name.toLowerCase()}|${t.dose}`).sort();
    expect(norm(dicte)).toEqual(norm(propre));
  });

  it('dictée : rythme « par cure » et unité « g/kg » (immunoglobulines)', () => {
    const list = parseReport(
      'relais par des immunoglobulines intraveineuses deux grammes par kilo par cure',
    );
    // Le mot-nombre isolé (sans « virgule ») doit aussi être reconstruit.
    const ig = list.find(t => /immunoglobulines/i.test(t.name));
    expect(ig).toBeTruthy();
  });

  it('paragraphe narratif (pas une liste) : dose, rythme et date d\'un relais par IgIV', () => {
    const txt = 'La patiente a reçu un traitement par CELLCEPT à la dose de 2 g par jour depuis ' +
      'mars 2022, avec relais par des immunoglobulines intraveineuses à la dose de 2 g/kg ' +
      'par cure, à raison d\'une cure par mois. Une réévaluation est prévue à 6 mois.';
    const list = parseReport(txt);
    const cc = list.find(t => /cellcept/i.test(t.name));
    const ig = list.find(t => /immunoglobulines/i.test(t.name));
    expect(cc!.dose).toBe('2 g par jour');
    expect(ig!.dose).toBe('2 g/kg par cure');
    expect(ig!.date).toBe('2022-03-01');
    expect(ig!.kind).toBe('event'); // « cure » → événement, pas continu
  });

  it('bruit clinique mélangé (examen, antécédents, biologie) : aucun faux traitement', () => {
    const txt = [
      'EXAMEN CLINIQUE : patiente stable, apyrétique, poids 62 kg.',
      'BIOLOGIE : CRP 5 mg/L, créatinine 90 µmol/L, hémoglobine 12 g/dL.',
      'ANTECEDENTS : HTA, diabète de type 2, tabagisme sevré.',
      'TRAITEMENT ACTUEL : CELLCEPT 1,5 g matin et soir, PREDNISONE 10 mg le matin.',
    ].join('\n');
    const list = parseReport(txt);
    // Seuls les deux vrais traitements doivent apparaître — pas EXAMEN,
    // CLINIQUE, BIOLOGIE, ANTECEDENTS ni TRAITEMENT (avec leur « valeur »
    // numérique voisine prise pour une dose).
    expect(list).toHaveLength(2);
    expect(list.some(t => /cellcept/i.test(t.name))).toBe(true);
    expect(list.some(t => /prednisone/i.test(t.name))).toBe(true);
  });

  it('rythme « 1 ampoule par mois » sans médicament de la liste blanche à proximité ne fabrique rien', () => {
    // Bruit pur : aucun nom de médicament, juste une valeur numérique avec
    // unité — ne doit rien produire (pas de token MAJ ni connu à proximité).
    const list = parseReport('poids 70 kg, une ampoule par mois de complément vitaminique');
    expect(list).toHaveLength(0);
  });
});
