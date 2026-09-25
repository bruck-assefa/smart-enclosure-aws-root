import copy
import json
import unittest
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient
from app import create_app
from feeding import Conflict, Feeding, ZONE, occurs, next_day, present, validate


def payload():
    return {'version': 0, 'schedules': {food: {
        'enabled': False, 'mode': 'weekly', 'weekdays': [], 'every_days': 1, 'start_date': None
    } for food in ('salad', 'bugs')}}


def interval(start='2026-09-28', every=4):
    return dict(enabled=True, mode='interval', weekdays=[], every_days=every, start_date=start)


class RecurrenceTests(unittest.TestCase):
    def test_defaults_are_unscheduled(self):
        result = present(payload(), datetime(2026, 9, 18, 12, tzinfo=ZONE))
        self.assertEqual(result['today'], [])
        self.assertEqual(result['next'], {'salad': None, 'bugs': None})
        self.assertTrue(all(not d['foods'] for d in result['upcoming']))

    def test_both_foods_and_multiple_weekdays(self):
        data = payload()
        for plan in data['schedules'].values():
            plan.update(enabled=True, weekdays=[0, 4])
        result = present(data, datetime(2026, 9, 18, 12, tzinfo=ZONE))
        self.assertEqual(result['today'], ['salad', 'bugs'])
        self.assertEqual(result['next']['bugs'], '2026-09-21')
        self.assertEqual(result['upcoming'][3]['foods'], ['salad', 'bugs'])

    def test_interval_crosses_month_without_resetting(self):
        plan = interval()
        self.assertTrue(occurs(plan, date(2026, 9, 28)))
        self.assertFalse(occurs(plan, date(2026, 9, 27)))
        self.assertFalse(occurs(plan, date(2026, 10, 1)))
        self.assertTrue(occurs(plan, date(2026, 10, 2)))
        self.assertEqual(next_day(plan, date(2026, 9, 29)), date(2026, 10, 2))

    def test_future_start_and_daily_and_leap_year(self):
        self.assertEqual(next_day(interval(), date(2026, 9, 18)), date(2026, 9, 28))
        plan = interval('2028-02-28', 1)
        self.assertEqual(next_day(plan, date(2028, 2, 28)), date(2028, 2, 29))
        self.assertTrue(occurs(plan, date(2028, 3, 1)))

    def test_enclosure_midnight_not_utc_midnight(self):
        data = payload()
        data['schedules']['bugs'] = interval('2026-09-18', 4)
        before = present(data, datetime(2026, 9, 18, 3, 59, tzinfo=timezone.utc))
        after = present(data, datetime(2026, 9, 18, 4, 0, tzinfo=timezone.utc))
        self.assertEqual(before['date'], '2026-09-17')
        self.assertEqual(before['today'], [])
        self.assertEqual(after['today'], ['bugs'])

    def test_dst_uses_calendar_days(self):
        data = payload()
        data['schedules']['bugs'] = interval('2026-03-07', 2)
        result = present(data, datetime(2026, 3, 9, 4, 0, tzinfo=timezone.utc))
        self.assertEqual(result['today'], ['bugs'])
        data['schedules']['bugs'] = interval('2026-10-31', 2)
        result = present(data, datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc))
        self.assertEqual(result['today'], ['bugs'])

    def test_overdue_carries_until_confirmed(self):
        data = payload()
        data['schedules']['bugs'] = interval('2026-09-18', 2)
        data['tracking'] = {'bugs': '2026-09-18', 'salad': '2026-09-18'}
        result = present(data, datetime(2026, 9, 25, 12, tzinfo=ZONE))
        self.assertEqual(result['today'], ['bugs'])
        self.assertEqual(result['due']['bugs'], '2026-09-18')
        self.assertEqual(result['upcoming'][0]['foods'], ['bugs'])
        self.assertEqual(result['next']['bugs'], '2026-09-26')
        data['tracking']['bugs'] = '2026-09-26'
        self.assertEqual(present(data, datetime(2026, 9, 25, 12, tzinfo=ZONE))['today'], [])

    def test_invalid_payloads(self):
        patches = [{'enabled': True}, {'weekdays': [True]}, {'weekdays': [7]},
                   {'weekdays': [1, 1]}, {'every_days': 0}, {'every_days': 366},
                   {'every_days': True}, {'start_date': '2026-02-30'}, {'mode': 'monthly'},
                   {'enabled': True, 'mode': 'interval', 'start_date': None}]
        for change in patches:
            data = payload()
            data['schedules']['bugs'].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError): validate(data)
        for bad in (None, [], {}, dict(payload(), version=True), dict(payload(), version=-1)):
            with self.assertRaises(ValueError): validate(bad)


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_binds_version_and_reports_conflict(self):
        conn = AsyncMock()
        conn.transaction = MagicMock(return_value=AsyncMock())
        class Context:
            async def __aenter__(self): return conn
            async def __aexit__(self, *args): pass
        class Pool:
            def acquire(self, **kwargs): return Context()
        history = AsyncMock()
        history.dsn = 'test-only'
        history.database.return_value = Pool()
        store = Feeding(history)
        row = payload()
        row['version'] = 1
        conn.fetchrow.return_value = row
        saved = await store.save(payload())
        self.assertEqual(saved['version'], 1)
        args = conn.fetchrow.call_args_list[0].args
        self.assertIn('version=$2', args[0])
        self.assertEqual(args[2], 0)
        self.assertEqual(json.loads(args[1]), payload()['schedules'])
        conn.fetchrow.return_value = None
        with self.assertRaises(Conflict): await store.save(payload())

    async def test_confirmation_records_and_advances_once(self):
        conn = AsyncMock()
        conn.transaction = MagicMock(return_value=AsyncMock())
        pool = MagicMock()
        pool.acquire.return_value = AsyncMock()
        pool.acquire.return_value.__aenter__.return_value = conn
        history = AsyncMock(dsn='test-only')
        history.database.return_value = pool
        row = payload()
        today = datetime.now(ZONE).date()
        row['schedules']['bugs'] = interval(today.isoformat(), 1)
        row['tracking'] = {food: today.isoformat() for food in ('salad', 'bugs')}
        conn.fetchrow.return_value = row
        store = Feeding(history)
        body = {'food': 'bugs', 'version': 0, 'date': today.isoformat()}
        await store.complete(body)
        self.assertEqual(conn.execute.await_count, 2)
        self.assertEqual(conn.execute.call_args_list[0].args[1:4], ('bugs', today, today))
        row['version'] = 1
        with self.assertRaises(Conflict):
            await store.complete(body)
        self.assertEqual(conn.execute.await_count, 2)
        body['version'] = 1
        body['date'] = '2000-01-01'
        with self.assertRaises(Conflict):
            await store.complete(body)



class RouteTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(live_enabled=False)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.app.state.feeding.read = AsyncMock(return_value=present(payload()))
        self.app.state.feeding.save = AsyncMock(return_value=present(payload()))
        self.app.state.feeding.complete = AsyncMock(return_value=present(payload()))
        self.headers = {'X-Enclosure-Control': '1'}

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_reads_work_without_pi(self):
        result = self.client.get('/feeding')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['today'], [])
        self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_simulation_and_unmarked_requests_never_write(self):
        self.assertEqual(self.client.put('/feeding?source=hardware', headers=self.headers, json=payload()).status_code, 403)
        self.app.state.gateway.live_enabled = True
        self.assertEqual(self.client.put('/feeding?source=simulation', headers=self.headers, json=payload()).status_code, 403)
        self.assertEqual(self.client.put('/feeding?source=hardware', json=payload()).status_code, 403)
        self.app.state.feeding.save.assert_not_awaited()

    def test_valid_save_independent_of_hardware_health(self):
        self.app.state.gateway.live_enabled = True
        self.assertFalse(self.app.state.gateway.state()['controls_enabled'])
        response = self.client.put('/feeding?source=hardware', headers=self.headers, json=payload())
        self.assertEqual(response.status_code, 200)
        self.app.state.feeding.save.assert_awaited_once()

    def test_bad_and_oversized_requests_do_not_write(self):
        self.app.state.gateway.live_enabled = True
        bad = copy.deepcopy(payload())
        bad['schedules']['salad']['enabled'] = True
        self.assertEqual(self.client.put('/feeding?source=hardware', headers=self.headers, json=bad).status_code, 400)
        self.assertEqual(self.client.put('/feeding?source=hardware', headers=self.headers, content='x'*2049).status_code, 413)
        self.app.state.feeding.save.assert_not_awaited()

    def test_conflict_and_errors_are_safe(self):
        self.app.state.gateway.live_enabled = True
        self.app.state.feeding.save.side_effect = Conflict('Settings changed elsewhere')
        self.assertEqual(self.client.put('/feeding?source=hardware', headers=self.headers, json=payload()).status_code, 409)
        self.app.state.feeding.read.side_effect = RuntimeError('secret-dsn')
        result = self.client.get('/feeding')
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('secret-dsn', result.text)
        self.assertEqual(self.client.get('/state').status_code, 200)

    def test_completion_guards_validation_and_conflict(self):
        body = {'version': 0, 'food': 'bugs', 'date': '2026-09-25'}
        url = '/feeding/complete?source=hardware'
        self.assertEqual(self.client.post(url, headers=self.headers, json=body).status_code, 403)
        self.app.state.gateway.live_enabled = True
        self.assertEqual(self.client.post(url, json=body).status_code, 403)
        self.assertEqual(self.client.post('/feeding/complete?source=simulation', headers=self.headers, json=body).status_code, 403)
        self.assertEqual(self.client.post(url, headers=self.headers, json=dict(body, food='other')).status_code, 400)
        self.assertEqual(self.client.post(url, headers=self.headers, content='x'*2049).status_code, 413)
        self.app.state.feeding.complete.assert_not_awaited()
        self.assertEqual(self.client.post(url, headers=self.headers, json=body).status_code, 200)
        self.app.state.feeding.complete.side_effect = Conflict('Already completed')
        self.assertEqual(self.client.post(url, headers=self.headers, json=body).status_code, 409)
