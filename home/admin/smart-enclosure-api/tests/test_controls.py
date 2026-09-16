import asyncio
import time
import unittest
import httpx
from fastapi.testclient import TestClient
import app


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.fail = False
        def handler(request):
            self.requests.append(request)
            if self.fail:
                raise httpx.ReadTimeout("unconfirmed")
            return httpx.Response(200, json={"status":"success"})
        self.upstream = httpx.AsyncClient(base_url="http://pi", transport=httpx.MockTransport(handler))
        self.application = app.create_app(self.upstream, live_enabled=False)
        self.client = TestClient(self.application)
        self.client.__enter__()
        gateway = self.application.state.gateway
        gateway.live_enabled = True  # No task is started; prime fixture cache only.
        for part in gateway.parts.values():
            part["error"] = None
            part["last_success_at"] = time.time()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        asyncio.run(self.upstream.aclose())

    def test_one_control_then_freshness_required(self):
        response = self.client.post("/relays/2/off?source=hardware",
                                    headers={"X-Enclosure-Control":"1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.requests[0].url.path, "/relays/2/off")
        response = self.client.post("/relays/2/off?source=hardware",
                                    headers={"X-Enclosure-Control":"1"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(self.requests), 1)

    def test_timeout_is_unknown_and_never_retried(self):
        self.fail = True
        response = self.client.post("/relays/2/off?source=hardware",
                                    headers={"X-Enclosure-Control":"1"})
        self.assertEqual(response.status_code, 504)
        self.assertIn("unknown", response.json()["detail"])
        self.assertEqual(len(self.requests), 1)
        self.assertFalse(self.application.state.gateway.state()["controls_enabled"])

    def test_schedule_preserves_payload(self):
        import json
        payload = {"on_time":"08:00", "off_time":"20:00", "mode":"auto"}
        response = self.client.put("/schedules/1?source=hardware",
                                   headers={"X-Enclosure-Control":"1"}, json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(self.requests[0].content), payload)

    def test_simulation_disabled_returns_forbidden(self):
        self.assertEqual(self.client.get("/state?source=simulation").status_code, 403)
