// Run with node; Playwright must be available. All HTTP is intercepted locally.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "var/www/bruck.gg/debug.html"), "utf8");
const js = fs.readFileSync(path.join(root, "var/www/bruck.gg/js/enclosure.js"), "utf8");

function state(source = "hardware", scenario = "healthy") {
  const now = Date.now() / 1000;
  return {source, simulation_available:true, controls_enabled:source === "hardware",
    connection:{status:"connected", last_success_at:now},
    snapshot:{source, collector:{status:"running"}, sensors:Array.from({length:16}, (_,i) => ({
      sensor_id:`sensor_${i}`, label:`Sensor ${i}`, enabled:i<8, source,
      status:i>=8 ? "disabled" : scenario === "sensor_error" && i===1 ? "error" : "healthy",
      hardware:{bus:1,multiplexer_address:i<8?"0x70":"0x72",channel:i%8,sensor_addresses:["0x76","0x77"]},
      last_good_reading:i<8?{temperature_c:25,humidity_pct:40,pressure_hpa:1000}:null,
      last_success_at:i<8?now:null,last_attempt_at:i<8?now:null,
      age_seconds:i<8?0:null,consecutive_failures:0,error_code:null
    }))},
    relays:{data:{"1":"on","2":"off","3":"on","4":"off"},error:null},
    schedules:{data:[1,2,3,4].map(i=>({relay_id:String(i),on_time:"07:00",off_time:"19:00"})),error:null}
  };
}
(async () => {
  let browser;
  try {
    try { browser = await chromium.launch({headless:true}); }
    catch { browser = await chromium.launch({headless:true,channel:"msedge"}); }
    const page = await browser.newPage();
    const errors = [], requests = [];
    let failState = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url());
      requests.push({path:url.pathname,method:req.method(),query:url.search});
      if (url.hostname !== "enclosure.test") throw new Error("Unexpected external request");
      if (url.pathname === "/debug.html") return route.fulfill({contentType:"text/html",body:html});
      if (url.pathname === "/js/enclosure.js") return route.fulfill({contentType:"text/javascript",body:js});
      if (url.pathname === "/enclosure/state") {
        if(failState) return route.fulfill({status:503,contentType:"application/json",body:'{"detail":"offline"}'});
        return route.fulfill({contentType:"application/json",body:JSON.stringify(state(
          url.searchParams.get("source"),url.searchParams.get("scenario")))});
      }
      if (url.pathname.startsWith("/enclosure/relays/")) {
        return route.fulfill({status:504,contentType:"application/json",body:'{"detail":"Command outcome unknown"}'});
      }
      return route.abort();
    });
    await page.goto("https://enclosure.test/debug.html");
    await page.waitForFunction(() => document.querySelectorAll(".sensor-box").length === 16);
    assert.match(await page.locator("#summary").innerText(), /8 healthy/);
    await page.locator("details summary").first().click();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("details").first().getAttribute("open"), "");
    await page.locator("#on-1").fill("08:30");
    await page.waitForTimeout(1100);
    assert.equal(await page.locator("#on-1").inputValue(), "08:30");
    await page.locator("#toggle-1").click();
    await page.waitForFunction(() => document.querySelector("#message").textContent.includes("not confirmed"));
    assert.equal(requests.filter(r=>r.method==="POST").length,1);
    await page.locator("#source").selectOption("simulation");
    await page.waitForFunction(() => document.querySelector("#connection").textContent.includes("SIMULATION"));
    assert.equal(await page.locator("#simulation-banner").isVisible(),true);
    assert.equal(await page.locator("#relay-container button").count(),0);
    assert.equal(await page.locator("#load-camera").isDisabled(),true);
    await page.locator("#scenario").selectOption("sensor_error");
    await page.waitForFunction(() => document.querySelector("#summary").textContent.includes("1 error"));
    assert.equal(requests.filter(r=>r.method!=="GET").length,1);
    assert.equal(requests.some(r=>r.path.includes("system/scan")),false);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    failState = true;
    await page.locator("#source").selectOption("hardware");
    await page.waitForFunction(() => document.querySelector("#connection").textContent.includes("AWS state unavailable"));
    assert.equal(await page.locator("#toggle-1").isDisabled(),true);
    assert.deepEqual(errors,[]);
    console.log("PASS: health cards, diagnostics persistence, unsaved schedules, failed commands, simulation isolation, mobile layout, gateway outage");
  } finally { if(browser) await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
