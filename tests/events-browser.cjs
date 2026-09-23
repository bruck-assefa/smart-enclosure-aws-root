const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert/strict');
const dist = path.resolve(__dirname, '../home/admin/smart-enclosure-frontend/dist');
(async () => {
 const browser = await chromium.launch({headless: true});
 try {
 const context = await browser.newContext({viewport: {width: 1200, height: 1000}, timezoneId:'Asia/Tokyo'});
 const page = await context.newPage(); page.setDefaultTimeout(10000);
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const now=Math.floor(Date.now()/1000), start=now-86400, end=now+3600;
 let events=[], failEvents=false, failSave=false;
 await page.route('https://enclosure.test/**', async route=>{
  const req=route.request(), url=new URL(req.url()), p=url.pathname;
  const json = body=>route.fulfill({json:body});
  if (p.startsWith('/smart/')) {
   const file=path.join(dist,p === '/smart/'?'index.html':p.slice('/smart/'.length));
   return route.fulfill({path:file,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  }
  if(p==='/enclosure/state') return json({snapshot:{generated_at:now,sensors:[]},connection:{status:'disconnected'},history:{status:'recording'}});
  if(p==='/enclosure/zones') return json({zones:[]});
  if(p==='/enclosure/feeding') return route.fulfill({status:503,json:{detail:'Fixture feeding unavailable'}});
  if(p==='/enclosure/history/range') return json({start,end,bucket_seconds:60,series:[]});
  if(p==='/enclosure/events') {
   if(req.method()==='GET') return failEvents?route.fulfill({status:503,json:{detail:'Fixture unavailable'}}):json({events,start,end});
   if(failSave) return route.fulfill({status:503,json:{detail:'Fixture save failure'}});
   const body=req.postDataJSON();
   if(req.method()==='DELETE') { events=events.filter(e=>e.id!==body.id);return json({deleted:body.id}); }
   const event={...body,version:body.version+1,occurred_at:now-120,created_at:now,updated_at:now};
   events=[...events.filter(e=>e.id!==body.id),event]; return json(event);
  }
  return route.fulfill({status:404,body:''});
 });
 await page.goto('https://enclosure.test/smart/');
 await page.getByRole('button',{name:'Add event now',exact:true}).click();
 await page.getByRole('combobox').first().selectOption('feeding');
 await page.getByLabel('Note',{exact:true}).fill('Fed bugs; doors open briefly.');
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await page.locator('.event-list li').waitFor();
 assert.equal(await page.locator('.event-marker').count(),1);
 await page.reload();
 await page.locator('.event-marker').waitFor();
 assert.equal(await page.locator('.event-list li').count(),1);
 await page.locator('.event-marker').focus(); await page.keyboard.press('Enter');
 assert.equal(await page.locator('.event-selected').count(),1);
 await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await page.getByLabel('Note',{exact:true}).fill('Updated manual feeding note');
 failSave=true;
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await page.getByText(/Your draft is retained/).waitFor();
 assert.equal(await page.getByLabel('Note',{exact:true}).inputValue(),'Updated manual feeding note');
 failSave=false;
 await page.getByRole('button',{name:'Save event',exact:true}).click();
 await page.locator('.event-list p').filter({hasText:'Updated manual feeding note'}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Edit event',exact:true}).click();
 await page.locator('.event-form').screenshot({path:path.join(require('os').tmpdir(), 'enclosure-event-form-mobile.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth), false);
 await page.getByRole('button',{name:'Delete event',exact:true}).click();
 await page.getByRole('button',{name:'Confirm delete',exact:true}).click();
 await page.getByText('No events recorded in this range.').waitFor();
 assert.equal(await page.locator('.event-marker').count(),0);
 failEvents=true;
 await page.getByRole('button',{name:'Reload events',exact:true}).click();
 await page.getByText(/Events could not be refreshed/).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: manual create, persistence after reload, marker keyboard selection without temperature data, edit, retained failed-save draft, mobile layout, delete, independent event errors; browser timezone Asia/Tokyo.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
