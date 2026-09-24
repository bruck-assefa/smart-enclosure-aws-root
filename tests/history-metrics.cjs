// Static build with intercepted fixtures; no application runtime or hardware access.
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const dist = path.resolve(__dirname, '../home/admin/smart-enclosure-frontend/dist');
(async () => {
 const browser = await chromium.launch({headless: true});
 try {
  const page = await browser.newPage({viewport: {width: 390, height: 844}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const now = Math.floor(Date.now()/1000), start = now - 86400;
  await page.route('https://enclosure.test/**', route => {
   const p = new URL(route.request().url()).pathname;
   if (p.startsWith('/smart/')) {
    const file = path.join(dist, p === '/smart/' ? 'index.html' : p.slice(7));
    return route.fulfill({path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'});
   }
   const json = body => route.fulfill({json: body});
   if (p === '/enclosure/state') return json({snapshot:{generated_at:now,sensors:[{sensor_id:'sensor_0',hardware:{multiplexer_address:'0x70',channel:0}}]},connection:{status:'disconnected'}});
   if (p === '/enclosure/zones') return json({zones:[{sensor_id:'sensor_0',zone:'Warm'}]});
   if (p === '/enclosure/events') return json({events:[],start,end:now});
   if (p === '/enclosure/history/range') return json({start,end:now,bucket_seconds:60,series:[{sensor_id:'sensor_0',points:[0,60,240].map(offset=>({time:now-600+offset,temperature_c:25,humidity_pct:40,pressure_hpa:1000,samples:6}))}]});
   return route.fulfill({status:503,json:{detail:'Unavailable fixture'}});
  });
  await page.goto('https://enclosure.test/smart/');
  await page.locator('.chart-host svg').waitFor();
  for (const [field, label, value] of [['temperature_c','Temperature','77.0 °F'], ['humidity_pct','Humidity','40.0 % RH'], ['pressure_hpa','Pressure','1000.0 hPa']]) {
   await page.getByLabel('Reading', {exact:true}).selectOption(field);
   assert.equal(await page.locator('#history-title').innerText(), `${label} history`);
   assert.equal((await page.locator('path.series.Warm').getAttribute('d')).match(/M/g).length, 2);
   await page.getByLabel('Inspect historical readings by time').fill('993');
   assert.ok((await page.locator('.chart-detail').first().innerText()).includes(value));
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('button',{name:'Hot zone',exact:true}).click();
  await page.getByText('No recorded readings in this range for the selected zones.').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: temperature, humidity and pressure selection, units, inspection, gaps, visibility and mobile width.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
