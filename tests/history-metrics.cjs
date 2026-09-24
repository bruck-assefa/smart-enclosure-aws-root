// Static build with intercepted fixtures; no application runtime or hardware access.
const { chromium } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const dist = path.resolve(__dirname, '../home/admin/smart-enclosure-frontend/dist');
(async () => {
 const browser = await chromium.launch({headless: true});
 try {
  const page = await browser.newPage({viewport: {width: 390, height: 844}, timezoneId: 'Asia/Tokyo'});
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
   if (p === '/enclosure/events') return json({events:['14:30','15:00'].map((t,i)=>({id:`event-${i}`,category:'other',note:`Range event ${i}`,occurred_at:Date.parse(`2026-09-01T${t}:00Z`)/1000})),start,end:now});
   if (p === '/enclosure/history/range') return json({start,end:now,bucket_seconds:60,series:[{sensor_id:'sensor_0',points:[...[0,60,240].map(offset=>({time:now-600+offset,temperature_c:25,humidity_pct:40,pressure_hpa:1000,samples:6})), ...['13:00','14:30','15:00'].map(t=>({time:Date.parse(`2026-09-01T${t}:00Z`)/1000,temperature_c:25,humidity_pct:40,pressure_hpa:1000,samples:6}))]}]});
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
  await page.getByRole('button',{name:'Hot zone',exact:true}).click();
  await page.getByRole('button',{name:'Custom',exact:true}).click();
  await page.getByLabel('From',{exact:true}).fill('2026-09-01');
  await page.getByLabel('To',{exact:true}).fill('2026-09-01');
  await page.getByLabel('Start time',{exact:true}).fill('10:00');
  await page.getByLabel('End time',{exact:true}).fill('11:00');
  await page.getByRole('button',{name:'Apply range',exact:true}).click();
  await page.locator('.chart-host circle.point.Warm').waitFor();
  assert.equal((await page.locator('path.series.Warm').getAttribute('d')).match(/M/g).length, 1);
  await page.getByLabel('Inspect historical readings by time').fill('500');
  assert.match(await page.locator('.chart-detail').first().innerText(), /10:30 AM/);
  await page.waitForFunction(() => document.querySelector('.chart-detail').textContent.includes('1000.0 hPa'));
  assert.equal(await page.locator('.event-marker').count(), 1);
  assert.match(await page.locator('.event-marker').getAttribute('aria-label'), /Range event 0/);
  await page.getByLabel('End time',{exact:true}).fill('09:00');
  await page.getByRole('button',{name:'Apply range',exact:true}).click();
  assert.match(await page.getByRole('alert').innerText(), /must be after/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: temperature, humidity and pressure selection, units, inspection, gaps, visibility, custom time ranges, event boundaries, invalid ranges and mobile width.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
