import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-home-user-FastCurve/21e66cea-0a9f-583b-b58e-71bbf91ea3c5/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport:{width:1600,height:950} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:5220/'); await page.waitForTimeout(1500);
await page.getByRole('button',{name:'Commencer'}).click(); await page.waitForTimeout(500);
// grille : saisie enchaînée
for (const nom of ['CRP','Créatinine']) { await page.locator('.newrow-inp').first().click(); await page.keyboard.type(nom); await page.keyboard.press('Enter'); await page.waitForTimeout(450); }
await page.locator('.dateinput').first().click(); await page.keyboard.type('01/02/2020'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
for (const d of ['15/03/2020','02/05/2020']) { await page.locator('.dateinput.neuve').click(); await page.keyboard.type(d); await page.keyboard.press('Enter'); await page.waitForTimeout(350); }
await page.locator('input.cell').first().click();
for (const v of ['120','64','31','88','92','101']) { await page.keyboard.type(v); await page.keyboard.press('Tab'); await page.waitForTimeout(150); }
await page.waitForTimeout(600);
const svg = await page.locator('.svg-host svg').first().innerHTML().catch(()=> '');
console.log('GRILLE — points:', (svg.match(/<circle/g)||[]).length, '| CRP:', svg.includes('CRP'), '| Créatinine:', svg.includes('Créatinine'));
// import : écran nettoyé
await page.getByRole('button',{name:/Importer/}).click(); await page.waitForTimeout(700);
const txt = await page.locator('.data, .aux').first().innerText().catch(()=>'');
console.log('IMPORT — zone de collage:', txt.includes('Ctrl+V'), '| réglages restants:', await page.locator('input[type=range], select').count());
await page.screenshot({path:`${OUT}/fusion.png`});
console.log('ERREURS JS :', errs.length?errs:'aucune');
await b.close();
