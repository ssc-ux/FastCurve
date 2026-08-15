// Données sources du banc d'épreuve : les bilans qui servent à fabriquer les
// captures ET à noter les lectures. Séparés du générateur pour que le banc
// puisse s'en servir sans relancer Chromium — c'est de là que viennent les
// bornes de normes utilisées par les cas de test du médecin.

export const BILAN_A = {
  dates: ['2025-03-12', '2025-04-09', '2025-05-14'],
  entetes: ['12/03/2025', '09/04/2025', '14/05/2025'],
  lignes: [
    { nom: 'Hemoglobine', unite: 'g/dL', valeurs: ['9.8', '10.9', '11.7'], normes: '12.0 - 16.0' },
    { nom: 'Leucocytes', unite: 'G/L', valeurs: ['14.2', '9.1', '7.4'], normes: '4.0 - 10.0' },
    { nom: 'Plaquettes', unite: 'G/L', valeurs: ['480', '365', '288'], normes: '150 - 400' },
    { nom: 'Creatinine', unite: 'umol/L', valeurs: ['168', '132', '115'], normes: '60 - 110' },
    { nom: 'CRP', unite: 'mg/L', valeurs: ['96', '28', '7'], normes: '< 5' },
    { nom: 'Albumine', unite: 'g/L', valeurs: ['28', '33', '37'], normes: '35 - 50' },
  ],
};

export const BILAN_B = {
  dates: ['2024-01-15', '2024-03-04', '2024-06-18', '2024-09-02'],
  entetes: ['15/01/2024', '04/03/2024', '18/06/2024', '02/09/2024'],
  lignes: [
    { nom: 'Sodium', unite: 'mmol/L', valeurs: ['138', '141', '136', '140'], normes: '135 - 145' },
    { nom: 'Potassium', unite: 'mmol/L', valeurs: ['4,1', '3,8', '4,6', '4,0'], normes: '3,5 - 5,0' },
    { nom: 'Uree', unite: 'mmol/L', valeurs: ['8,2', '6,4', '12,1', '7,3'], normes: '2,5 - 7,5' },
    { nom: 'Creatinine', unite: 'umol/L', valeurs: ['142', '118', '205', '131'], normes: '60 - 110' },
    { nom: 'Calcium', unite: 'mmol/L', valeurs: ['2,31', '2,44', '2,18', '2,39'], normes: '2,20 - 2,60' },
    { nom: 'Phosphore', unite: 'mmol/L', valeurs: ['1,12', '0,94', '1,48', '1,05'], normes: '0,80 - 1,45' },
    { nom: 'Albumine', unite: 'g/L', valeurs: ['34', '38', '29', '36'], normes: '35 - 50' },
    { nom: 'CRP', unite: 'mg/L', valeurs: ['12', '<5', '48', '6'], normes: '< 5' },
  ],
};

export const BILAN_C = {
  dates: ['2023-11-08', '2023-12-06'],
  entetes: ['08/11/2023', '06/12/2023'],
  lignes: [
    { nom: 'ASAT', unite: 'UI/L', valeurs: ['62', '38'], normes: '< 40' },
    { nom: 'ALAT', unite: 'UI/L', valeurs: ['81', '45'], normes: '< 40' },
    { nom: 'GGT', unite: 'UI/L', valeurs: ['155', '98'], normes: '< 55' },
    { nom: 'PAL', unite: 'UI/L', valeurs: ['210', '176'], normes: '40 - 130' },
    { nom: 'Bilirubine totale', unite: 'umol/L', valeurs: ['24', '15'], normes: '< 17' },
    { nom: 'TP', unite: '%', valeurs: ['68', '84'], normes: '70 - 100' },
    { nom: 'Fibrinogene', unite: 'g/L', valeurs: ['5,2', '3,7'], normes: '2,0 - 4,0' },
    { nom: 'Ferritine', unite: 'ug/L', valeurs: ['1240', '860'], normes: '30 - 300' },
    { nom: 'TSH', unite: 'mUI/L', valeurs: ['0,42', '1,85'], normes: '0,40 - 4,00' },
    { nom: 'Vitamine D', unite: 'nmol/L', valeurs: ['38', '62'], normes: '> 75' },
  ],
};

export const BILAN_D = {
  dates: ['2026-02-03', '2026-02-17', '2026-03-10'],
  entetes: ['03/02/2026', '17/02/2026', '10/03/2026'],
  lignes: [
    { nom: 'Leucocytes', unite: 'G/L', valeurs: ['3,8', '5,1', '6,9'], normes: '4,0 - 10,0' },
    { nom: 'PNN', unite: 'G/L', valeurs: ['1,4', '2,7', '4,1'], normes: '1,5 - 7,0' },
    { nom: 'Lymphocytes', unite: 'G/L', valeurs: ['1,9', '1,7', '2,2'], normes: '1,0 - 4,0' },
    { nom: 'Plaquettes', unite: 'G/L', valeurs: ['96', '145', '232'], normes: '150 - 400' },
    { nom: 'Hemoglobine', unite: 'g/dL', valeurs: ['8,4', '9,6', '11,2'], normes: '12,0 - 16,0' },
    { nom: 'VGM', unite: 'fL', valeurs: ['104', '98', '92'], normes: '80 - 100' },
    { nom: 'IgG', unite: 'g/L', valeurs: ['4,8', '6,2', '8,1'], normes: '7,0 - 16,0' },
    { nom: 'C3', unite: 'g/L', valeurs: ['0,72', '0,95', '1,24'], normes: '0,90 - 1,80' },
    { nom: 'Anticorps anti-DNA', unite: 'UI/mL', valeurs: ['>300', '184', '46'], normes: '< 20' },
  ],
};

// ── La capture du médecin, reconstituée ─────────────────────────────
// Cinq analytes, trois dates (dont deux SANS année), une colonne « Unité »,
// une colonne « Normes », les valeurs pathologiques en orange avec une flèche,
// une ligne sur deux en gris clair. C'est la capture sur laquelle l'ancienne
// chaîne écrivait 104 pour la créatinine et 400 pour les plaquettes.
export const BILAN_MEDECIN = {
  dates: ['2024-03-12', '2024-06-15', '2024-09-20'],
  entetes: ['12/03', '15/06', '20/09/24'],
  lignes: [
    { nom: 'Creatinine', unite: 'umol/L', valeurs: ['85', '92', '110'], normes: '59 - 104' },
    { nom: 'CRP', unite: 'mg/L', valeurs: ['3', '12', '45'], normes: '< 5' },
    { nom: 'Hemoglobine', unite: 'g/dL', valeurs: ['13,2', '12,8', '11,9'], normes: '13 - 17' },
    { nom: 'Leucocytes', unite: 'G/L', valeurs: ['7,4', '9,1', '12,2'], normes: '4 - 10' },
    { nom: 'Plaquettes', unite: 'G/L', valeurs: ['245', '198', '312'], normes: '150 - 400' },
  ],
};
