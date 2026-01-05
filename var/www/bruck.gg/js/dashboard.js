const relayStatusUrl = "https://api.bruck.gg/relay-status";
const relayControlUrl = "https://api.bruck.gg/relay-control";
let tempChartInstance = null;
let chartRefreshInterval = null;

function updateRelays() {
  fetch(relayStatusUrl)
    .then(res => res.json())
    .then(statuses => {
      document.querySelectorAll(".relay-toggle").forEach(toggle => {
        const relayId = toggle.dataset.relayId;
        toggle.checked = statuses[relayId] === "on";
      });
    })
    .catch(err => console.error("Failed to fetch relay status:", err));
}

const lat = 38.9461, lon = -77.4030, tz = 'America/New_York';
fetch(`https://api.bruck.gg/sun?lat=${lat}&lon=${lon}&tz=${encodeURIComponent(tz)}`)
  .then(r => r.json())
  .then(d => {
    document.querySelector('#sunrise').textContent = d.sunrise_local; // "06:58"
    document.querySelector('#sunset').textContent  = d.sunset_local;  // "18:43"
  })
  .catch(console.error);

document.querySelectorAll(".relay-toggle").forEach(toggle => {
  toggle.addEventListener("change", () => {
    const relayId = toggle.dataset.relayId;
    const state = toggle.checked ? "on" : "off";

    fetch(relayControlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ relay_id: relayId, state })
    })
      .then(res => res.json())
      .then(data => {
        console.log(`Relay ${relayId} set to ${state}:`, data);
      })
      .catch(err => console.error("Failed to update relay:", err));
  });
});

function updateDashboard() {
  fetch("https://api.bruck.gg/zones/averages")
    .then(res => res.json())
    .then(data => {
      data.forEach(zoneData => {
        const zone = zoneData.zone.toLowerCase();
        const temp = zoneData.avg_temp?.toFixed(1);
        let className;

        if (zone === "warm") className = "hot";
        else if (zone === "cool") className = "cold";
        else if (zone === "transition") className = "transition";

        const el = document.querySelector(`.zone-box.${className} .temperature`);
        if (el && temp) el.textContent = `${temp}°F`;
      });
    })
    .catch(err => console.error("Error fetching zone averages:", err));
}

updateDashboard();
updateRelays();
setInterval(() => {
  updateDashboard();
  updateRelays();
}, 30000);


const today = new Date().toISOString().slice(0, 10);
loadTemperatureData(today);

const picker = document.getElementById("datepicker");
picker.valueAsDate = new Date();
picker.addEventListener("change", () => {
  loadTemperatureData(picker.value);
});

dayjs.extend(window.dayjs_plugin_utc);  // if not already extended
const getLocalDayBounds = (dateStr) => {
    // Create bounds based on local time, not UTC
    const min = dayjs(dateStr).startOf('day').valueOf();
    const max = dayjs(dateStr).endOf('day').valueOf();
    return { min, max };
  };
  
let chart = new ApexCharts(document.querySelector("#temp-chart"), {
  chart: {
    type: 'line',
    animations: { enabled: true },
    zoom: { enabled: false },
    toolbar: { show: false }
  },
  colors: ['#e74c3c', '#f1c40f', '#3498db'], // Red, Yellow, Blue - matching your zone colors
  xaxis: {
    type: 'datetime',
    labels: {
        datetimeUTC: false, // Change this to false to use local time
        datetimeFormatter: {
          hour: 'hh:mm TT'
        }
      },
    ...getLocalDayBounds(picker.value)
  },
  yaxis: {
    min: 65, // Set your minimum temperature here
    max: 110, // Set your maximum temperature here
    labels: {
      formatter: (val) => `${val.toFixed(1)}°F`
    }
  },
  tooltip: {
    x: {
      format: 'hh:mm TT'
    },
    y: {
      formatter: (val) => `${val.toFixed(1)}°F`
    }
  },
  series: []
});

  
  chart.render();
  
  async function loadTemperatureData(dateStr) {
    const res = await fetch(`https://api.bruck.gg/api/temperature-daily?date=${dateStr}`);
    const data = await res.json();
  
    const grouped = {};
    for (const row of data) {
      if (!grouped[row.zone]) grouped[row.zone] = [];
        grouped[row.zone].push({ 
            x: dayjs.utc(row.bucket).local().valueOf(),
            y: row.avg_temp 
        });
    }
  
    // Define series in specific order instead of using Object.entries
    const orderedZones = ['Warm', 'Transition', 'Cool'];
    const series = orderedZones.map(zone => ({
    name: zone,
    data: grouped[zone] || []
    }));

    chart.updateSeries(series);

    const { min, max } = getLocalDayBounds(dateStr);
    chart.updateOptions({ xaxis: { min, max } });
    
  }

  setInterval(() => {
    const today = new Date().toLocaleDateString('en-CA'); // gives 'YYYY-MM-DD' in local time
    if (picker.value === today) {
      loadTemperatureData(today);
    }
  }, 30000);
  