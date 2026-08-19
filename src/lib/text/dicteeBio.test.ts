import { describe, it, expect } from 'vitest';
import { parseDicteeBio } from './dicteeBio';

// Aide : reconnus sous forme { nom: valeur } pour des assertions courtes.
function valeurs(texte: string): Record<string, number | null> {
  const r = parseDicteeBio(texte);
  const out: Record<string, number | null> = {};
  for (const it of r.reconnus) out[it.nom] = it.valeur;
  return out;
}

describe('parseDicteeBio — cas de dictée réels (Dragon)', () => {
  it('« CRP 45 créatinine 90 hémoglobine 12,3 leucocytes 7,4 plaquettes 245 »', () => {
    // Espace final : dictée d'une phrase terminée, plus aucun mot ouvert.
    const texte = 'CRP 45 créatinine 90 hémoglobine 12,3 leucocytes 7,4 plaquettes 245 ';
    const r = parseDicteeBio(texte);
    expect(valeurs(texte)).toEqual({
      CRP: 45, Créatinine: 90, Hémoglobine: 12.3, Leucocytes: 7.4, Plaquettes: 245,
    });
    expect(r.inconnus).toEqual([]);
    expect(r.reconnus.every(it => it.complet)).toBe(true);
  });

  it('« créatinine à 90 micromol par litre, CRP à 45, hémoglobine 12 point 3 » — sans les unités', () => {
    const r = parseDicteeBio('créatinine à 90 micromol par litre, CRP à 45, hémoglobine 12');
    expect(valeurs('créatinine à 90 micromol par litre, CRP à 45, hémoglobine 12')).toEqual({
      Créatinine: 90, CRP: 45, Hémoglobine: 12,
    });
    // Les mots d'unité ne doivent jamais apparaître comme analyte non reconnu.
    expect(r.inconnus.map(i => i.nom)).not.toContain('micromol par litre');
  });

  it('nom multi-mots reconnu (« vitesse de sédimentation »)', () => {
    expect(valeurs('vitesse de sédimentation 22')).toEqual({ VS: 22 });
  });
});

describe('parseDicteeBio — virgule et point décimaux', () => {
  it('virgule française', () => {
    expect(valeurs('hémoglobine 12,3')).toEqual({ Hémoglobine: 12.3 });
  });
  it('point décimal', () => {
    expect(valeurs('hémoglobine 12.3')).toEqual({ Hémoglobine: 12.3 });
  });
  it('entier sans décimale', () => {
    expect(valeurs('plaquettes 245')).toEqual({ Plaquettes: 245 });
  });
});

describe('parseDicteeBio — frontière de mot (ne jamais figer une valeur en cours d’écriture)', () => {
  it('« créatinine 9 » (texte encore ouvert, sans espace final) : valeur non définitive', () => {
    const r = parseDicteeBio('créatinine 9');
    expect(r.reconnus).toHaveLength(1);
    expect(r.reconnus[0].valeur).toBe(9);
    expect(r.reconnus[0].complet).toBe(false);
  });

  it('« créatinine 90 » toujours ouvert (pas d’espace final) : encore non définitif', () => {
    const r = parseDicteeBio('créatinine 90');
    expect(r.reconnus[0].valeur).toBe(90);
    expect(r.reconnus[0].complet).toBe(false);
  });

  it('« créatinine 90 » avec espace final : la frontière est franchie, valeur définitive', () => {
    const r = parseDicteeBio('créatinine 90 ');
    expect(r.reconnus[0].valeur).toBe(90);
    expect(r.reconnus[0].complet).toBe(true);
  });

  it('un nouvel analyte reconnu après referme aussi la valeur précédente', () => {
    const r = parseDicteeBio('créatinine 90 CRP');
    const creat = r.reconnus.find(i => i.nom === 'Créatinine')!;
    expect(creat.valeur).toBe(90);
    expect(creat.complet).toBe(true);
    // CRP est là (nom reconnu) mais sans valeur, et encore ouvert.
    const crp = r.reconnus.find(i => i.nom === 'CRP')!;
    expect(crp.valeur).toBeNull();
    expect(crp.complet).toBe(false);
  });

  it('un nom en train de s’écrire (« créat ») reste marqué incomplet', () => {
    const r = parseDicteeBio('créat');
    expect(r.reconnus).toHaveLength(1);
    expect(r.reconnus[0].catalogue?.name).toBe('Créatinine');
    expect(r.reconnus[0].complet).toBe(false);
    expect(r.reconnus[0].valeur).toBeNull();
  });

  it('texte vide → rien', () => {
    expect(parseDicteeBio('')).toEqual({ reconnus: [], inconnus: [] });
  });
});

describe('parseDicteeBio — analyte non reconnu par le catalogue', () => {
  it('un nom absent du catalogue, suivi d’une valeur, est signalé (pas ignoré)', () => {
    const r = parseDicteeBio('truc bidule 42 ');
    expect(r.reconnus).toEqual([]);
    expect(r.inconnus).toHaveLength(1);
    expect(r.inconnus[0].nom).toBe('truc bidule');
    expect(r.inconnus[0].valeur).toBe(42);
    expect(r.inconnus[0].complet).toBe(true);
  });

  it('un texte de contexte sans valeur, au milieu de la dictée, n’est PAS signalé (bruit)', () => {
    const r = parseDicteeBio('biologie du jour CRP 45');
    expect(r.inconnus).toEqual([]);
    expect(valeurs('biologie du jour CRP 45')).toEqual({ CRP: 45 });
  });

  it('un nom inconnu encore en cours d’écriture (dernier mot du texte) est prévisualisé, sans valeur', () => {
    const r = parseDicteeBio('CRP 45 truc');
    const inconnu = r.inconnus.find(i => i.nom === 'truc');
    expect(inconnu).toBeTruthy();
    expect(inconnu!.valeur).toBeNull();
    expect(inconnu!.complet).toBe(false);
  });
});

describe('parseDicteeBio — robustesse', () => {
  it('deux analytes consécutifs sans valeur entre les deux : le second n’est pas avalé par le premier', () => {
    const r = parseDicteeBio('CRP créatinine 90 ');
    const creat = r.reconnus.find(i => i.nom === 'Créatinine');
    expect(creat?.valeur).toBe(90);
  });

  it('une correction orale (le même analyte redicté) : la dernière valeur l’emporte', () => {
    const r = parseDicteeBio('créatinine 90 non pardon créatinine 95 ');
    const creat = r.reconnus.find(i => i.nom === 'Créatinine')!;
    expect(creat.valeur).toBe(95);
    expect(r.reconnus).toHaveLength(1);
  });

  it('une valeur numérique isolée, sans nom qui précède, est ignorée', () => {
    expect(parseDicteeBio('45 90').reconnus).toEqual([]);
  });

  it('espaces multiples et retours à la ligne sont tolérés', () => {
    expect(valeurs('CRP   45\ncréatinine\t90 ')).toEqual({ CRP: 45, Créatinine: 90 });
  });

  it('le texte édité en cours de route (correction manuelle) est relu à l’identique — pas de dépendance à l’historique', () => {
    const a = parseDicteeBio('CRP 45 créatinine 90 ');
    const b = parseDicteeBio('CRP 145 créatinine 90 '); // le médecin a corrigé « 45 » en « 145 »
    expect(a.reconnus.find(i => i.nom === 'CRP')?.valeur).toBe(45);
    expect(b.reconnus.find(i => i.nom === 'CRP')?.valeur).toBe(145);
  });
});
