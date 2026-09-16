"""Bounded AWS-only history. Database errors never enter the live-state path."""
import asyncio
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)
UTC = timezone.utc
ZONE = ZoneInfo("America/New_York")
INTERVAL = 10
BUCKET = 60


def day_bounds(value):
    day = date.fromisoformat(value)
    if day.isoformat() != value:
        raise ValueError("Expected YYYY-MM-DD")
    start = datetime.combine(day, datetime.min.time(), ZONE)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), ZONE)
    return start.astimezone(UTC), end.astimezone(UTC)


def samples(state, now):
    """Sample only fresh, healthy hardware; keep actual measurement timestamps."""
    if (state["source"] != "hardware" or state["connection"]["status"] != "connected"
            or state["snapshot"]["collector"]["status"] != "running"):
        return []
    rows = []
    for s in state["snapshot"]["sensors"]:
        stamp = s["last_success_at"]
        if (s["source"] != "hardware" or not s["enabled"] or s["status"] != "healthy"
                or stamp is None or not 0 <= now - stamp <= 30):
            continue
        r, hw = s["last_good_reading"], s["hardware"]
        rows.append((datetime.fromtimestamp(stamp, UTC), s["sensor_id"],
                     datetime.fromtimestamp(now, UTC), s["label"], hw["bus"],
                     hw["multiplexer_address"], hw["channel"],
                     r["temperature_c"], r["humidity_pct"], r["pressure_hpa"]))
    return rows


INSERT = """INSERT INTO enclosure_history.readings
(measured_at, sensor_id, collected_at, label, bus, mux, channel,
 temperature_c, humidity_pct, pressure_hpa)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (measured_at, sensor_id) DO NOTHING"""
SELECT = """SELECT sensor_id, max(label) AS label,
 date_bin('1 minute', measured_at, TIMESTAMPTZ '2000-01-01') AS bucket,
 avg(temperature_c) AS temperature_c, min(temperature_c) AS minimum_c,
 max(temperature_c) AS maximum_c, count(*) AS samples
FROM enclosure_history.readings
WHERE measured_at >= $1 AND measured_at < $2
GROUP BY sensor_id, bucket ORDER BY sensor_id, bucket"""


class History:
    def __init__(self, gateway, dsn=None):
        self.gateway = gateway
        # No database access in the supported simulation-only preview, even if env is set.
        self.dsn = (dsn if dsn is not None else os.getenv("ENCLOSURE_HISTORY_DSN")) if gateway.live_enabled else None
        self.pool = None
        self.pool_lock = asyncio.Lock()
        self.readers = asyncio.Semaphore(2)
        self.cache = {}
        self.status = {"status": "starting" if self.dsn else "disabled",
                       "last_write_at": None, "last_sample_at": None,
                       "eligible_sensors": 0, "interval_seconds": INTERVAL}

    async def database(self):
        async with self.pool_lock:
            if self.pool is None:
                import asyncpg
                self.pool = await asyncpg.create_pool(self.dsn, min_size=0, max_size=3,
                    timeout=1, command_timeout=1.5,
                    server_settings={"application_name": "enclosure_history",
                                     "statement_timeout": "1500", "lock_timeout": "500"})
        return self.pool

    async def write(self, rows):
        pool = await self.database()
        async with pool.acquire(timeout=1) as conn:
            # executemany is atomic; uniqueness handles repeated cached readings/restarts.
            await conn.executemany(INSERT, rows)

    async def tick(self):
        now = time.time()
        rows = samples(self.gateway.state(), now)
        self.status.update(last_sample_at=now, eligible_sensors=len(rows))
        if not rows:
            # Do not report recovery from a DB error without a successful database operation.
            if self.status["status"] != "unavailable":
                self.status["status"] = "waiting_for_fresh_readings"
            return
        try:
            await asyncio.wait_for(self.write(rows), 3)
        except Exception:
            # Exception/DSN text can contain credentials. Never log it.
            if self.status["status"] != "unavailable":
                log.warning("Historical storage unavailable; live state continues")
            self.status["status"] = "unavailable"
        else:
            self.status.update(status="recording", last_write_at=time.time())

    async def run(self):
        while True:
            started = time.monotonic()
            await self.tick()
            await asyncio.sleep(max(0, INTERVAL - (time.monotonic() - started)))

    async def read_day(self, value):
        start, end = day_bounds(value)
        if not self.dsn:
            return {"status": "disabled", "series": []}
        cached = self.cache.get(value)
        if cached and time.monotonic() - cached[0] < 15:
            return cached[1]
        # Refuse excess work immediately, keeping DB capacity for the writer.
        if self.readers.locked():
            raise RuntimeError("History busy")
        async with self.readers:
            async def query():
                pool = await self.database()
                async with pool.acquire(timeout=1) as conn:
                    async with conn.transaction(readonly=True):
                        return await conn.fetch(SELECT, start, end)
            rows = await asyncio.wait_for(query(), 3)
        grouped = {}
        for row in rows:
            series = grouped.setdefault(row["sensor_id"], {"sensor_id": row["sensor_id"],
                         "label": row["label"], "points": []})
            series["points"].append({"time": row["bucket"].timestamp(),
                "temperature_c": row["temperature_c"], "minimum_c": row["minimum_c"],
                "maximum_c": row["maximum_c"], "samples": row["samples"]})
        result = {"status": "available", "date": value, "timezone": "America/New_York",
                  "start": start.timestamp(), "end": end.timestamp(),
                  "bucket_seconds": BUCKET, "series": list(grouped.values())}
        if len(self.cache) >= 8:
            self.cache.pop(next(iter(self.cache)))
        self.cache[value] = (time.monotonic(), result)
        return result

    async def close(self):
        if self.pool:
            try:
                await asyncio.wait_for(self.pool.close(), 3)
            except asyncio.TimeoutError:
                self.pool.terminate()
