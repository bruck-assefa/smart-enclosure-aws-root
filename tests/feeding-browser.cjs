const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert/strict');
const dist = path.resolve(__dirname, '../home/admin/smart-enclosure-frontend/dist');
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
 const page = await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const now=Date.now()/1000;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let data={version:0,date,today:['bugs'],due:{bugs:'2026-01-01'},next:{},history:[],upcoming:[],schedules:{bugs:{enabled:true,mode:'weekly',weekdays:[0],every_days:1,start_date:null},salad:{enabled:false,mode:'weekly',weekdays:[],every_days:1,start_date:null}}};
 await page.route('https://enclosure.test/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  if(p.startsWith('/smart/')) {const file=path.join(dist,p==='/smart/'?'index.html':p.slice(7));return route.fulfill({path:file,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});}
  const json=body=>route.fulfill({json:body});
  if(p==='/enclosure/feeding') return json(data);
  if(p==='/enclosure/feeding/complete') {assert.deepEqual(req.postDataJSON(),{food:'bugs',version:0,date});data={...data,version:1,today:[],history:[{food:'bugs',scheduled_date:'2026-01-01',completed_date:date}]};return json(data);}
  if(p==='/enclosure/state') return json({snapshot:{generated_at:now,sensors:[]},connection:{status:'disconnected'},history:{status:'recording'}});
  if(p==='/enclosure/zones') return json({zones:[]});
  if(p==='/enclosure/events') return json({events:[],start:now-86400,end:now});
  if(p==='/enclosure/history/range') return json({start:now-86400,end:now,bucket_seconds:60,series:[]});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('https://enclosure.test/smart/');
 await page.getByRole('button',{name:'Mark bugs fed'}).click();
 await page.getByText('Bugs feeding recorded.').waitFor();
 assert.equal(await page.getByRole('button',{name:'Mark bugs fed'}).count(),0);
 await page.reload();
 await page.getByText('No feeding due today').waitFor();
 await page.locator('.feeding-settings-link').click();
 await page.locator('.feeding-history tbody tr').waitFor();
 assert.equal(await page.locator('.feeding-history tbody tr').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile confirmation, reload persistence, history, enclosure date with Tokyo browser timezone.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
