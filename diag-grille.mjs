// Reproduction du grief « je peux pas modifier les dates ça enregistre trop vite ».
// Tape une date au clavier, segment par segment, et observe ce qui arrive au focus.
import { chromium } from 'playwright';

const ETUDE = {
  version: 1, patientLabel: 'Diag', parameters: [
    { id: 'p1', name: 'CRP', unit: 'mg/L', category: 'biologie', refLow: 0, refHigh: 5, display: 'absolute', color: '#2a78d6', order: 0 },
    { id: 'p2', name: 'Créatinine', unit: 'µmol/L', category: 'biologie', display: 'absolute', color: '#e34948', order: 1 },
  ],
  measurements: [
    { id: 'm1', parameterId: 'p1', date: '2026-01-10', value: 148, qualifier: null },
    { id: 'm2', parameterId: 'p2', date: '2026-01-10', value: 245, qualifier: null },
    { id: 'm3', parameterId: 'p1', date: '2026-02-10', value: 92, qualifier: null },
    { id: 'm4', parameterId: 'p2', date: '2026-02-10', value: 190, qualifier: null },
    { id: 'm5', parameterId: 'p1', date: '2026-03-10', value: 31, qualifier: null },
  ],
  treatments: [], annotations: [],
  settings: { chartMode: 'stacked', title: 'Diag', subtitle: '', showReference: true, showLegend: true, showValues: false, timeAxis: true, markOutOfRange: true },
  extraDates: ['2026-04-10'],
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
await page.addInitScript(([etude]) => {
  localStorage.setItem('fastcurve.etude.v1', etude);
  localStorage.setItem('fastcurve.welcome.v1', '1');
}, [JSON.stringify(ETUDE)]);
await page.goto('http://localhost:5211/');
await page.waitForSelector('.dgrid');

const etat = async (label) => {
  const info = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      actif: a ? (a.className || a.tagName) : 'aucun',
      valeurActif: a && 'value' in a ? a.value : null,
      dates: [...document.querySelectorAll('.dateinput')].map(i => i.value),
    };
  });
  console.log(label, JSON.stringify(info));
};

// On se place sur la 3e colonne (2026-03-10) et on tape 05/12/2026 au clavier.
const inputs = page.locator('.dgrid thead .dateinput');
console.log('colonnes au départ :', await inputs.evaluateAll(l => l.map(i => i.value)));
await inputs.nth(2).click();
await etat('avant frappe :');
await page.screenshot({ path: 'captures/diag-avant.png' });

for (const k of ['0', '5', '1', '2', '2', '0', '2', '6']) {
  await page.keyboard.press(`Digit${k}`);
  await etat(`  après « ${k} » :`);
}
await page.screenshot({ path: 'captures/diag-apres.png' });

console.log('mesures finales :', await page.evaluate(() => {
  const e = JSON.parse(localStorage.getItem('fastcurve.etude.v1'));
  return { mesures: e.measurements.map(m => `${m.parameterId}@${m.date}=${m.value}`), extra: e.extraDates };
}));

await b.close();
