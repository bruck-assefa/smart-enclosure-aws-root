const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const SunCalc = require('suncalc');
const { DateTime } = require('luxon');

const DEFAULT_LAT = 38.9461;   // DC example
const DEFAULT_LON = -77.4030;
const DEFAULT_TZ  = 'America/New_York';


dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const PORT = process.env.PORT || 3011;

app.use(express.json());

app.use(cors({
  origin: ['https://bruck.gg', 'https://api.bruck.gg', 'https://bruck.gg:5173', 'bruck.gg:5173'],
  credentials: true
}))

const RASPI_API_URL = 'http://100.96.44.128:3010';

const http = require('http');
let lastDbInsertAt = null;

// after inserting sensor-data
// inside your /sensor-data handler, when insert succeeds:
lastDbInsertAt = new Date().toISOString();

const logBuffer = [];
const sseClients = new Set();
function pushLog(level, ...args) {
  const entry = { ts: new Date().toISOString(), level, msg: args.map(a => String(a)).join(' ') };
  logBuffer.push(entry);
  if (logBuffer.length > 5000) logBuffer.shift();
  for (const res of sseClients) res.write(`data: ${JSON.stringify(entry)}\n\n`);
}
['log','warn','error'].forEach(k => {
  const orig = console[k].bind(console);
  console[k] = (...a) => { pushLog(k, ...a); orig(...a); };
});

app.get('/logs', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': 'https://bruck.gg'
  });
  for (const e of logBuffer) res.write(`data: ${JSON.stringify(e)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()'); // lightweight ping
    res.json({
      status: 'ok',
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss/1024/1024),
      db: 'ok',
      lastDbInsertAt,
      now: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ status: 'degraded', db: 'error', error: e.message });
  }
});

// Proxy Pi live sensors
app.get('/pi/sensors-now', (req, res) => {
  http.get(`${RASPI_API_URL}/api/sensors-now`, r => {
    res.setHeader('Content-Type','application/json');
    r.pipe(res);
  }).on('error', (e) => res.status(502).json({ error: e.message }));
});

// Proxy Pi logs (SSE)
app.get('/pi/logs', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': 'https://bruck.gg'
  });
  const upstream = http.get(`${RASPI_API_URL}/logs`, r => r.pipe(res));
  req.on('close', () => { try { upstream.destroy(); } catch {} });
});


// PostgreSQL DB config
const pool = new Pool({
  user: 'smart_user',
  host: 'localhost',
  database: 'smart_enclosure',
  password: 'sh9mKM&$Nk68',
  port: 5432,
});

// Receive sensor data and insert into TimescaleDB
app.post('/sensor-data', async (req, res) => {
  const readings = req.body;
  let inserted = 0;

  try {
    for (const r of readings) {
      const { timestamp, sensor_id, temperature, humidity, pressure } = r;
      if (!sensor_id || !timestamp) continue;

      await pool.query(
        `INSERT INTO sensor_data (timestamp, sensor_id, temperature, humidity, pressure)
         VALUES (to_timestamp($1), $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [timestamp / 1000, sensor_id, temperature, humidity, pressure]
      );
      inserted++;
    }
    console.log(`✅ Inserted ${inserted} sensor readings to DB`);
    res.status(200).json({ message: 'Sensor data stored' });
  } catch (err) {
    console.error('❌ DB insert error:', err.message);
    res.status(500).json({ error: 'Failed to store sensor data' });
  }
});

// Query latest values and join zones from sensor_attributes
app.get('/zones/averages', async (req, res) => {
  const sql = `
    WITH latest_readings AS (
      SELECT DISTINCT ON (sensor_id) *
      FROM sensor_data
      ORDER BY sensor_id, timestamp DESC
    )
    SELECT
      sa.zone,
      AVG(lr.temperature) AS avg_temp
    FROM latest_readings lr
    JOIN sensor_attributes sa ON lr.sensor_id = sa.sensor_id
    WHERE lr.temperature IS NOT NULL
    GROUP BY sa.zone;
  `;

  try {
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Failed to fetch zone averages:', err.message);
    res.status(500).json({ error: 'Failed to fetch averages' });
  }
});

app.get('/api/temperature-daily', async (req, res) => {
  const { date, interval = '22 minutes' } = req.query;
  if (!date) return res.status(400).json({ error: 'Missing date parameter' });

  try {
    // Convert date to timestamp range in your local timezone
    const startTime = `${date} 00:00:00-04:00`; // Eastern Time
    const endTime = `${date} 23:59:59-04:00`;   // Eastern Time
    
    // First, get the raw data
    const rawData = await pool.query(`
      SELECT 
        time_bucket($3::interval, sd.timestamp) AS bucket,
        sa.zone,
        AVG(sd.temperature) AS raw_temp
      FROM sensor_data sd
      JOIN sensor_attributes sa ON sd.sensor_id = sa.sensor_id
      WHERE sd.timestamp >= $1::timestamptz AND sd.timestamp <= $2::timestamptz
      GROUP BY bucket, sa.zone
      ORDER BY bucket, sa.zone;
    `, [startTime, endTime, interval]);
    
    // Process the data in JavaScript to filter out the spikes
    const processedData = [];
    const zoneData = {};
    
    // Configuration parameters for spike detection
    const deviationThreshold = 8;  // Temperature difference to consider a spike
    const windowSize = 7;          // Number of points to consider on each side
    
    // Group by zone first
    rawData.rows.forEach(row => {
      if (!zoneData[row.zone]) {
        zoneData[row.zone] = [];
      }
      zoneData[row.zone].push({
        bucket: row.bucket,
        raw_temp: row.raw_temp
      });
    });
    
    // Process each zone to detect and fix spikes
    Object.keys(zoneData).forEach(zone => {
      const zonePoints = zoneData[zone];
      
      // Sort by bucket to ensure time order
      zonePoints.sort((a, b) => new Date(a.bucket) - new Date(b.bucket));
      
      // Process each point looking for spikes
      for (let i = 0; i < zonePoints.length; i++) {
        let filteredTemp = zonePoints[i].raw_temp;
        
        // Check if we have enough points on both sides for the window
        if (i >= windowSize && i < zonePoints.length - windowSize) {
          // Calculate average of preceding points
          let prevSum = 0;
          for (let j = 1; j <= windowSize; j++) {
            prevSum += zonePoints[i-j].raw_temp;
          }
          const prevAvg = prevSum / windowSize;
          
          // Calculate average of following points
          let nextSum = 0;
          for (let j = 1; j <= windowSize; j++) {
            nextSum += zonePoints[i+j].raw_temp;
          }
          const nextAvg = nextSum / windowSize;
          
          // If this point deviates significantly from both neighbor averages
          if (Math.abs(filteredTemp - prevAvg) > deviationThreshold && 
              Math.abs(filteredTemp - nextAvg) > deviationThreshold) {
            // Replace with average of neighboring averages
            filteredTemp = (prevAvg + nextAvg) / 2;
          }
        }
        
        processedData.push({
          bucket: zonePoints[i].bucket,
          zone: zone,
          avg_temp: filteredTemp
        });
      }
    });
    
    // Return the processed data
    res.json(processedData);
  } catch (err) {
    console.error('Failed to fetch daily data:', err.message);
    res.status(500).json({ error: 'Query failed' });
  }
});

app.post('/relay-control', async (req, res) => {
  const { relay_id, state } = req.body;

  if (!['1', '2', '3', '4'].includes(relay_id) || !['on', 'off'].includes(state)) {
    return res.status(400).json({ error: 'Invalid relay_id or state' });
  }

  try {
    const response = await axios.post(`${RASPI_API_URL}/api/relay-control`, { relay_id, state });
    res.json(response.data);
  } catch (error) {
    console.error('Failed to control relay on Pi:', error.message);
    res.status(502).json({ error: 'Failed to control relay on Raspberry Pi' });
  }
});

app.get('/relay-status', async (req, res) => {
  try {
    const response = await axios.get(`${RASPI_API_URL}/api/relay-status`);
    res.json(response.data);
  } catch (error) {
    console.error("Error fetching relay status from Pi:", error.message);
    res.status(502).json({ error: 'Failed to fetch relay status from Raspberry Pi' });
  }
});


app.get('/sun', (req, res) => {
  try {
    const lat = parseFloat(req.query.lat ?? DEFAULT_LAT);
    const lon = parseFloat(req.query.lon ?? DEFAULT_LON);
    const tz  = (req.query.tz || DEFAULT_TZ).trim();

    // date input like "2025-10-04"
    const todayLocal = req.query.date
      ? DateTime.fromISO(req.query.date, { zone: tz })
      : DateTime.now().setZone(tz);

    // Use local **noon** to avoid DST edge cases
    const localNoon = todayLocal.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });

    // Compute in UTC instant for that local-noon moment
    const times = SunCalc.getTimes(localNoon.toJSDate(), lat, lon);

    const sunriseUtc = DateTime.fromJSDate(times.sunrise).toUTC();
    const sunsetUtc  = DateTime.fromJSDate(times.sunset).toUTC();

    const sunriseLocal = sunriseUtc.setZone(tz);
    const sunsetLocal  = sunsetUtc.setZone(tz);

    res.json({
      date: todayLocal.toISODate(),
      lat, lon, tz,
      sunrise_utc: sunriseUtc.toISO(),
      sunset_utc:  sunsetUtc.toISO(),
      sunrise_local: sunriseLocal.toFormat("h:mm a"),
      sunset_local:  sunsetLocal.toFormat("h:mm a"),
      sunrise_local_iso: sunriseLocal.toISO(),
      sunset_local_iso:  sunsetLocal.toISO()
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server running on port ${PORT}`);
});
