import asyncio
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app import Gateway, create_app
from history import History, samples, day_bounds
from sensor_contract import new_snapshot, record


def gateway():
    g = Gateway(None)
    g.sensors = new_snapshot()
    now = time.time()
    record(g.sensors["sensors"][0], {"temperature_c": 25, "humidity_pct": 40, "pressure_hpa": 1000}, now=now-1)
    g.sensors["collector"] = {"status": "running", "last_progress_at": now}
    g.parts["sensors"].update(last_success_at=now, error=None)
    return g


class SamplingTests(unittest.TestCase):
    def test_timestamp_and_units_preserved(self):
        g = gateway()
        rows = samples(g.state(), time.time())
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0][0].timestamp(), g.sensors["sensors"][0]["last_success_at"], places=5)
        self.assertEqual(rows[0][7:], (25, 40, 1000))
        self.assertGreater(rows[0][2], rows[0][0])

    def test_bad_health_and_outage_do_not_store_last_good(self):
        for status in ("error", "stale", "disabled", "unavailable"):
            g = gateway()
            g.sensors["sensors"][0]["status"] = status
            self.assertEqual(samples(g.state(), time.time()), [])
        g = gateway()
        g.parts["sensors"]["error"] = "pi_timeout"
        self.assertEqual(samples(g.state(), time.time()), [])
        g = gateway()
        g.sensors["sensors"][0]["last_success_at"] -= 60
        self.assertEqual(samples(g.state(), time.time()), [])

    def test_simulation_is_never_stored(self):
        g = gateway()
        g.simulation_enabled = True
        self.assertEqual(samples(g.state("simulation"), time.time()), [])

    def test_dst_days_have_correct_utc_bounds(self):
        for day, hours in (("2026-03-08", 23), ("2026-11-01", 25), ("2026-09-16", 24)):
            start, end = day_bounds(day)
            self.assertEqual((end-start).total_seconds(), hours*3600)
        for day in ("bad", "2026-02-30", "20260916"):
            with self.assertRaises(ValueError):
                day_bounds(day)


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_failure_is_isolated_and_recovers(self):
        g = gateway()
        history = History(g, "not-a-real-dsn")
        history.write = AsyncMock(side_effect=RuntimeError("secret must not escape"))
        with self.assertLogs("history", level="WARNING") as logs:
            await history.tick()
        self.assertNotIn("secret", str(logs.output))
        self.assertEqual(history.status["status"], "unavailable")
        self.assertEqual(g.state()["connection"]["status"], "connected")
        history.write = AsyncMock()
        await history.tick()
        self.assertEqual(history.status["status"], "recording")
        self.assertIsNotNone(history.status["last_write_at"])

    async def test_blocked_write_does_not_block_state(self):
        g = gateway()
        history = History(g, "not-real")
        entered = asyncio.Event()
        async def slow(rows):
            entered.set()
            await asyncio.Event().wait()
        history.write = slow
        task = asyncio.create_task(history.tick())
        await entered.wait()
        started = time.monotonic()
        for _ in range(100):
            self.assertEqual(g.state()["connection"]["status"], "connected")
        self.assertLess(time.monotonic()-started, .5)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_repeated_cache_keeps_same_unique_key(self):
        history = History(gateway(), "not-real")
        history.write = AsyncMock()
        await history.tick()
        await history.tick()
        first, second = [call.args[0][0] for call in history.write.call_args_list]
        self.assertEqual(first[:2], second[:2])

    async def test_preview_disables_configured_database(self):
        history = History(Gateway(None, live_enabled=False), "not-real")
        self.assertIsNone(history.dsn)
        self.assertEqual((await history.read_day("2026-09-16"))["status"], "disabled")

    async def test_query_result_and_cache(self):
        class Context:
            async def __aenter__(self): return conn
            async def __aexit__(self, *args): pass
        class Connection:
            def transaction(self, **kw):
                assert kw == {"readonly": True}
                return Context()
            fetch = AsyncMock(return_value=[dict(sensor_id="sensor_0",label="Sensor 0",
                bucket=datetime(2026,9,16,12,tzinfo=timezone.utc),temperature_c=25,
                minimum_c=24,maximum_c=26,samples=6)])
        conn = Connection()
        class Pool:
            def acquire(self, **kw): return Context()
        history = History(gateway(), "not-real")
        history.database = AsyncMock(return_value=Pool())
        first = await history.read_day("2026-09-16")
        second = await history.read_day("2026-09-16")
        self.assertEqual(first, second)
        self.assertEqual(first["series"][0]["points"][0]["samples"], 6)
        conn.fetch.assert_awaited_once()
        self.assertEqual(conn.fetch.call_args.args[1:], day_bounds("2026-09-16"))


class RouteTests(unittest.TestCase):
    def test_disabled_invalid_and_simulation(self):
        with TestClient(create_app(live_enabled=False)) as client:
            self.assertEqual(client.get("/history/temperatures?date=bad").status_code, 400)
            self.assertEqual(client.get("/history/temperatures?date=2026-09-16&source=bogus").status_code, 400)
            self.assertEqual(client.get("/history/temperatures?date=2026-09-16").json()["status"], "disabled")
            self.assertEqual(client.get("/history/temperatures?date=2026-09-16&source=simulation").json()["status"], "simulation_not_stored")

    def test_database_failure_is_sanitized_and_state_works(self):
        application = create_app(live_enabled=False)
        with TestClient(application) as client:
            application.state.history.read_day = AsyncMock(side_effect=RuntimeError("credential"))
            result = client.get("/history/temperatures?date=2026-09-16")
            self.assertEqual(result.status_code, 503)
            self.assertNotIn("credential", result.text)
            self.assertEqual(client.get("/state").status_code, 200)
