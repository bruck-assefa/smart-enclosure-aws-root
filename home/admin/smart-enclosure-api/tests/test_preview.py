import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import preview

class PreviewTests(unittest.TestCase):
    def test_preview_has_no_live_collection(self):
        with patch("app.request_json", side_effect=AssertionError("Live call in preview")):
            with TestClient(preview.app) as client:
                self.assertEqual(client.get("/debug.html").status_code, 200)
                self.assertEqual(client.get("/js/enclosure.js").status_code, 200)
                result = client.get("/enclosure/state?source=simulation").json()
                self.assertEqual(result["source"], "simulation")
                self.assertFalse(result["live_available"])
                self.assertFalse(result["controls_enabled"])
                result = client.post("/enclosure/relays/1/on?source=hardware",
                                     headers={"X-Enclosure-Control":"1"})
                self.assertEqual(result.status_code, 503)
