/* History is independent of live state and controls. No Pi calls or chart CDN. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const zone = "America/New_York", svgNS = "http://www.w3.org/2000/svg";
  const colors = ["#64d8cb", "#ffbd69", "#8faeff", "#ed91bd", "#c2df70", "#cfabff", "#ff8787", "#8cd5f5"];
  const day = () => {
    const parts = new Intl.DateTimeFormat("en-US", {timeZone:zone, year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const value = name => parts.find(p => p.type === name).value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  };
  const clock = stamp => new Intl.DateTimeFormat("en-US", {timeZone:zone,hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(stamp*1000));
  let data = null, fahrenheit = true, controller = null, timer = null, generation = 0, followToday = true;
  const hidden = new Set();
  let metric = "temperature_c";
  const temp = c => metric === "temperature_c" && fahrenheit ? c*9/5+32 : c;
  const minimumKey = () => metric === "temperature_c" ? "minimum_c" : `minimum_${metric}`;
  const maximumKey = () => metric === "temperature_c" ? "maximum_c" : `maximum_${metric}`;
  const unit = () => metric === "humidity_pct" ? "% RH" : metric === "pressure_hpa" ? " hPa" : fahrenheit ? "°F" : "°C";
  const svg = (tag, attrs, text) => {
    const el = document.createElementNS(svgNS,tag);
    for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    if (text !== undefined) el.textContent=text;
    return el;
  };
  const status = text => { $("history-status").textContent=text; };
  function draw() {
    const chart = $("temperature-chart"); chart.replaceChildren();
    chart.setAttribute("aria-label", `Daily ${metric === "temperature_c" ? "temperature" : metric === "humidity_pct" ? "humidity" : "pressure"} graph in ${unit()}`);
    $("history-table").querySelector("tbody").replaceChildren();
    if (!data?.series.length) return;
    const series = data.series.filter(s => !hidden.has(s.sensor_id));
    const values = series.flatMap(s => s.points.filter(p => Number.isFinite(p[metric])).map(p => temp(p[metric])));
    if (!values.length) return;
    let low=Infinity, high=-Infinity;
    for(const value of values) { low=Math.min(low,value); high=Math.max(high,value); }
    low=Math.floor(low-2); high=Math.ceil(high+2);
    const x = t => 70+(t-data.start)/(data.end-data.start)*900;
    const y = t => 285-(temp(t)-low)/(high-low)*255;
    for(let i=0;i<=4;i++) {
      const value=low+(high-low)*i/4, yy=285-i*255/4;
      chart.append(svg("line",{x1:70,x2:970,y1:yy,y2:yy,stroke:"#454545"}),
        svg("text",{x:60,y:yy+5,fill:"#ddd","text-anchor":"end","font-size":14},value.toFixed(1)+unit()));
    }
    for(let i=0;i<=4;i++) {
      const t=data.start+(data.end-data.start)*i/4;
      chart.append(svg("text",{x:x(t),y:315,fill:"#ddd","text-anchor":i===4?"end":i===0?"start":"middle","font-size":14},clock(t)));
    }
    data.series.forEach((s,index) => {
      if(hidden.has(s.sensor_id)) return;
      let path="", previous=null, minimum=Infinity, maximum=-Infinity, count=0;
      const points = s.points.filter(p => Number.isFinite(p[metric]));
      if (!points.length) return;
      for(const p of points) {
        path += `${previous===null || p.time-previous>90 ? "M" : "L"}${x(p.time).toFixed(2)},${y(p[metric]).toFixed(2)} `;
        previous=p.time; minimum=Math.min(minimum,p[minimumKey()]); maximum=Math.max(maximum,p[maximumKey()]); count+=p.samples;
      }
      const color=colors[index%colors.length];
      chart.append(svg("path",{d:path,fill:"none",stroke:color,"stroke-width":2,"data-sensor":s.sensor_id}));
      // Dots ensure a lone reading is visible, including isolated points after an outage.
      points.forEach((p,i) => {
        if(i===0 || i===points.length-1 || p.time-points[i-1].time>90 || points[i+1].time-p.time>90)
          chart.append(svg("circle",{cx:x(p.time),cy:y(p[metric]),r:2,fill:color}));
      });
      const row=document.createElement("tr");
      for(const value of [s.label, temp(minimum).toFixed(1)+unit(), temp(maximum).toFixed(1)+unit(), count]) {
        const cell=document.createElement("td");cell.textContent=value;row.append(cell);
      }
      $("history-table").querySelector("tbody").append(row);
    });
  }
  function legend() {
    $("history-legend").replaceChildren();
    (data?.series || []).forEach((s,index) => {
      const label=document.createElement("label"), input=document.createElement("input"), text=document.createElement("span");
      input.type="checkbox";input.checked=!hidden.has(s.sensor_id);
      input.addEventListener("change",()=>{input.checked?hidden.delete(s.sensor_id):hidden.add(s.sensor_id);draw();});
      text.textContent=s.label; text.style.color=colors[index%colors.length];
      label.append(input,text);$("history-legend").append(label);
    });
  }
  $("temperature-chart").addEventListener("pointermove", event => {
    if(!data) return;
    const box=event.currentTarget.getBoundingClientRect();
    const time=data.start+(((event.clientX-box.left)/box.width*1000-70)/900)*(data.end-data.start);
    const parts=[];
    for(const s of data.series) {
      if(hidden.has(s.sensor_id)) continue;
      const p=s.points.reduce((best,p)=>!best || Math.abs(p.time-time)<Math.abs(best.time-time)?p:best,null);
      if(p && Number.isFinite(p[metric]) && Math.abs(p.time-time)<60) parts.push(`${s.label}: ${temp(p[metric]).toFixed(1)}${unit()} (${p.samples} samples)`);
    }
    $("history-cursor").textContent=clock(time)+" — "+(parts.join(" · ") || "No readings here");
  });
  async function load() {
    clearTimeout(timer);
    if(document.hidden || controller) return;
    if(followToday) $("history-date").value=day();
    $("history-date").max=day();
    if($("source").value!=="hardware") {
      data=null;legend();draw();status("Simulation: historical hardware data is hidden. Synthetic readings are never written to PostgreSQL.");return;
    }
    const version=generation, selected=$("history-date").value;
    let refresh=selected===day();
    const current=new AbortController();controller=current;
    const timeout=setTimeout(()=>current.abort(),4500);
    try {
      const response=await fetch(`/enclosure/history/temperatures?date=${encodeURIComponent(selected)}&source=hardware`, {signal:current.signal,cache:"no-store"});
      if(!response.ok) throw new Error("unavailable");
      const result=await response.json();
      if(version!==generation) return;
      if(result.status==="disabled") {data=null;status("Historical storage is not enabled yet. Live readings remain available.");}
      else if(result.status!=="available" || !Array.isArray(result.series)) throw new Error("invalid history");
      else {
        data=result;
        status(result.series.length ? `Updated ${clock(Date.now()/1000)} · ${selected===day()?"refreshes every 15 seconds":"saved historical day"}` : "No recorded readings for this day. Missing or unhealthy readings are not replaced with zeroes.");
      }
      legend();draw();
    } catch(error) {
      refresh=true;
      if(version===generation) status(data ? "History refresh failed — showing the last loaded graph. Live readings are independent." : "History is temporarily unavailable. Live readings are independent.");
    } finally {
      clearTimeout(timeout);if(controller===current) controller=null;
      if(version!==generation) timer=setTimeout(load,0);
      else if(!document.hidden && refresh) timer=setTimeout(load,15000);
    }
  }
  function change() {
    generation++;clearTimeout(timer);data=null;legend();draw();
    $("history-cursor").textContent="Point at the graph to inspect recorded readings.";
    status("Loading history…");
    if(controller) controller.abort();else load();
  }
  $("history-metric").addEventListener("change", event => {
    metric = event.target.value;
    $("history-cursor").textContent = "Point at the graph to inspect recorded readings.";
    draw();
  });
  $("history-date").value=day();$("history-date").max=day();
  $("history-date").addEventListener("change",()=>{followToday=$("history-date").value===day();change();});
  $("history-today").addEventListener("click",()=>{followToday=true;$("history-date").value=day();change();});
  $("source").addEventListener("change",change);
  document.addEventListener("enclosure-units",event=>{fahrenheit=event.detail;draw();});
  document.addEventListener("enclosure-storage",event=>{
    const s=event.detail;
    $("history-storage").textContent=s ? `Recorder: ${s.status.replaceAll("_"," ")} · eligible sensors: ${s.eligible_sensors} · last successful write: ${s.last_write_at?new Date(s.last_write_at*1000).toLocaleString("en-US",{timeZone:zone}):"none"}` : "Recorder status unavailable";
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden){clearTimeout(timer);if(controller)controller.abort();}else load();});
  load();
})();
