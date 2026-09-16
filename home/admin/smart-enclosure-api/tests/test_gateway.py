import asyncio
import copy
import time
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
import app
from sensor_contract import new_snapshot, record

def hardware():
    data = new_snapshot()
    record(data["sensors"][0], {"temperature_c": 25, "humidity_pct": 40, "pressure_hpa": 1000})
    data["collector"] = {"status": "running", "last_progress_at": time.time()}
    return data

def response(request):
    if request.url.path == "/v1/sensors":
        return httpx.Response(200, json=hardware())
    if request.url.path == "/relays":
        return httpx.Response(200, json={str(i): "on" for i in range(1, 5)})
    if request.url.path == "/schedules":
        return httpx.Response(200, json=[{"relay_id":str(i), "on_time":"07:00", "off_time":"19:00"}
                                         for i in range(1, 5)])
    return httpx.Response(200, json={"status":"success"})

class CacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_outage_keeps_source_time_and_fails_closed(self):
        client = httpx.AsyncClient(transport=httpx.MockTransport(response), base_url="http://pi")
        gateway = app.Gateway(client)
        await gateway.refresh()
        previous = gateway.state()["snapshot"]["sensors"][0]
        with patch("app.request_json", side_effect=httpx.ConnectError("offline")):
            await gateway.refresh()
        current = gateway.state()
        self.assertEqual(current["snapshot"]["sensors"][0]["last_success_at"], previous["last_success_at"])
        self.assertEqual(current["connection"]["status"], "unavailable")
        self.assertFalse(current["controls_enabled"])
        await client.aclose()

    async def test_malformed_payloads_do_not_crash_collector(self):
        for bad in ([], {}, {"schema_version": 1}, {"sensors": None}):
            client = httpx.AsyncClient(transport=httpx.MockTransport(
                lambda req: httpx.Response(200, json=bad)), base_url="http://pi")
            gateway = app.Gateway(client)
            await gateway.refresh()
            self.assertEqual(gateway.state()["connection"]["status"], "unavailable")
            await client.aclose()

    async def test_hard_deadline_on_slow_upstream(self):
        async def slow(req):
            await asyncio.sleep(5)
            return response(req)
        async with httpx.AsyncClient(transport=httpx.MockTransport(slow), base_url="http://pi") as client:
            with patch.object(app, "REQUEST_TIMEOUT", .05):
                start = time.monotonic()
                with self.assertRaises(asyncio.TimeoutError):
                    await app.request_json(client, "GET", "/v1/sensors")
                self.assertLess(time.monotonic() - start, .5)

    async def test_reads_do_not_call_upstream(self):
        calls = []
        def handler(req):
            calls.append(req.url.path)
            return response(req)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://pi") as client:
            gateway = app.Gateway(client)
            await gateway.refresh()
            for _ in range(100):
                gateway.state()
            self.assertEqual(len(calls), 3)

    async def test_stale_network_cache_disables_controls(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(response), base_url="http://pi") as client:
            gateway = app.Gateway(client)
            await gateway.refresh()
            for part in gateway.parts.values():
                part["last_success_at"] -= 60
            self.assertFalse(gateway.state()["controls_enabled"])

    async def test_simulation_cannot_overwrite_live_cache(self):
        gateway = app.Gateway(None, simulation_enabled=True)
        before = copy.deepcopy(gateway.sensors)
        state = gateway.state("simulation", "pi_offline")
        self.assertEqual(state["source"], "simulation")
        self.assertFalse(state["controls_enabled"])
        self.assertEqual(gateway.sensors, before)

class RouteTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def handler(req):
            self.calls.append(req)
            return response(req)
        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://pi")
        self.application = app.create_app(self.upstream, simulation_enabled=True, live_enabled=False)
        self.client = TestClient(self.application)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        asyncio.run(self.upstream.aclose())

    def test_cold_start_returns_unavailable_immediately(self):
        r = self.client.get("/state")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["connection"]["status"], "unavailable")
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertEqual(self.calls, [])

    def test_simulation_has_no_upstream_requests(self):
        r = self.client.get("/state?source=simulation&scenario=sensor_error")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["snapshot"]["sensors"][1]["status"], "error")
        self.assertEqual(self.calls, [])

    def test_simulated_control_never_reaches_pi(self):
        r = self.client.post("/relays/1/off?source=simulation", headers={"X-Enclosure-Control":"1"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.calls, [])

    def test_control_without_explicit_source_is_rejected(self):
        self.assertEqual(self.client.post("/relays/1/off").status_code, 403)

    def test_invalid_modes_rejected(self):
        self.assertEqual(self.client.get("/state?source=bogus").status_code, 400)
        self.assertEqual(self.client.get("/state?source=simulation&scenario=bogus").status_code, 400)

    def test_invalid_schedule_rejected_before_network(self):
        r = self.client.put("/schedules/1?source=hardware",
                           json={"on_time":"99:00","off_time":"19:00","mode":"auto"},
                           headers={"X-Enclosure-Control":"1"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.calls, [])

if __name__ == "__main__":
    unittest.main()
