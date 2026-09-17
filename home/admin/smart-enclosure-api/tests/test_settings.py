import json
from test_controls import ControlTests


class SettingsTests(ControlTests):
    def test_custom_name_forwarded(self):
        payload = {'name': 'UV bulb', 'mode': 'custom', 'on_time': '08:00', 'off_time': '18:00'}
        response = self.client.put('/schedules/2?source=hardware', headers={'X-Enclosure-Control': '1'}, json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(self.requests[0].content), payload)

    def test_sun_without_times(self):
        response = self.client.put('/schedules/2?source=hardware', headers={'X-Enclosure-Control': '1'}, json={'name': 'Heat', 'mode': 'sun'})
        self.assertEqual(response.status_code, 200)

    def test_invalid_schedule_never_reaches_hardware(self):
        for payload in ({'mode': 'custom', 'on_time': '08:00', 'off_time': '08:00'}, {'mode': 'sun', 'name': ''}, {'mode': 'bogus'}):
            response = self.client.put('/schedules/2?source=hardware', headers={'X-Enclosure-Control': '1'}, json=payload)
            self.assertEqual(response.status_code, 400)
        self.assertFalse(self.requests)

    def test_bounded_history_dates(self):
        for query in ('start=2026-01-01&end=2026-03-01', 'start=bad&end=bad', 'start=2026-09-16&end=2026-09-15'):
            self.assertEqual(self.client.get('/history/range?' + query).status_code, 400)
