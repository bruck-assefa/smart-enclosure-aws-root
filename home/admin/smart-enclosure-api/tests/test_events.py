import unittest
from datetime import datetime, timezone
from uuid import UUID
from unittest.mock import AsyncMock
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import create_app
from events import Events, validate, present
from history import day_bounds


def payload(**changes):
    return dict({'id': '67d45c45-4376-445b-98da-b1d49a7e0b81', 'version': 0,
                 'local_time': '2025-09-01T14:30', 'fold': 0, 'category': 'feeding', 'note': 'Fed bugs'}, **changes)


def row(**changes):
    body = payload()
    stamp = validate(body)[2]
    return dict({'id': UUID(body['id']), 'version': 1, 'occurred_at': stamp, 'category': body['category'],
                 'note': body['note'], 'created_at': stamp, 'updated_at': stamp, 'deleted_at': None}, **changes)


class ValidationTests(unittest.TestCase):
    def test_enclosure_time_is_converted_to_utc(self):
        self.assertEqual(validate(payload())[2], datetime(2025, 9, 1, 18, 30, tzinfo=timezone.utc))
        self.assertEqual(present(row())['local_time'], payload()['local_time'])

    def test_dst_gap_and_repeated_hour(self):
        with self.assertRaises(ValueError): validate(payload(local_time='2025-03-09T02:30'))
        first = validate(payload(local_time='2025-11-02T01:30', fold=0))[2]
        second = validate(payload(local_time='2025-11-02T01:30', fold=1))[2]
        self.assertEqual((second - first).total_seconds(), 3600)
        self.assertEqual(present(row(occurred_at=second))['fold'], 1)

    def test_invalid_inputs(self):
        for change in ({'id': 'bad'}, {'version': True}, {'version': -1}, {'note': ''}, {'note': ' '},
                       {'note': 'a'*2001}, {'note': None}, {'category': 'scheduled'}, {'category': []},
                       {'fold': True}, {'local_time': '2025-02-30T12:00'}, {'local_time': '2100-01-01T12:00'},
                       {'local_time': '2025-09-01T12:00Z'}, {'local_time': None}):
            with self.subTest(change=change), self.assertRaises(ValueError): validate(payload(**change))


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.conn = AsyncMock()
        conn = self.conn
        class Context:
            async def __aenter__(self): return conn
            async def __aexit__(self, *args): pass
        class Pool:
            def acquire(self, **kwargs): return Context()
        self.history = AsyncMock()
        self.history.dsn = 'test-only'
        self.history.database.return_value = Pool()
        self.store = Events(self.history)

    async def test_retry_creation_is_idempotent(self):
        self.conn.fetchrow.side_effect = [None, row()]
        self.assertEqual((await self.store.save(payload()))['id'], payload()['id'])
        self.assertIn('ON CONFLICT (id) DO NOTHING', self.conn.fetchrow.call_args_list[0].args[0])
        self.conn.fetchrow.side_effect = [None, row(note='Changed elsewhere')]
        with self.assertRaises(HTTPException) as error: await self.store.save(payload())
        self.assertEqual(error.exception.status_code, 409)

    async def test_stale_update_and_delete_conflict(self):
        self.conn.fetchrow.return_value = None
        with self.assertRaises(HTTPException) as error: await self.store.save(payload(version=1))
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('version=$2', self.conn.fetchrow.call_args.args[0])
        with self.assertRaises(HTTPException) as error: await self.store.delete({'id': payload()['id'], 'version': 1})
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('deleted_at=CURRENT_TIMESTAMP', self.conn.fetchrow.call_args.args[0])

    async def test_range_and_deleted_filter_and_overflow(self):
        self.conn.fetch.return_value = [row()]
        start, end = day_bounds('2025-09-01')
        self.assertEqual(len((await self.store.read(start, end))['events']), 1)
        self.assertEqual(self.conn.fetch.call_args.args[1:], (start, end))
        self.assertIn('deleted_at IS NULL', self.conn.fetch.call_args.args[0])
        self.conn.fetch.return_value = [row()] * 2001
        with self.assertRaises(HTTPException) as error: await self.store.read(start, end)
        self.assertEqual(error.exception.status_code, 422)


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(live_enabled=False)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.app.state.events.read = AsyncMock(return_value={'events': []})
        self.app.state.events.save = AsyncMock(return_value=present(row()))
        self.app.state.events.delete = AsyncMock(return_value={'deleted': payload()['id']})
        self.headers = {'X-Enclosure-Control': '1'}

    def tearDown(self): self.client.__exit__(None, None, None)

    def test_reads_and_invalid_ranges(self):
        self.assertEqual(self.client.get('/events?start=2025-09-01&end=2025-09-01').status_code, 200)
        for query in ('start=bad&end=bad', 'start=2025-09-02&end=2025-09-01', 'start=2025-09-01&end=2025-10-31'):
            self.assertEqual(self.client.get('/events?' + query).status_code, 400)

    def test_writes_require_intent_and_live_mode(self):
        for method in ('POST', 'PUT', 'DELETE'):
            self.assertEqual(self.client.request(method, '/events?source=hardware', headers=self.headers, json=payload()).status_code, 403)
        self.app.state.gateway.live_enabled = True
        self.assertEqual(self.client.post('/events?source=hardware', json=payload()).status_code, 403)
        self.assertEqual(self.client.post('/events?source=simulation', headers=self.headers, json=payload()).status_code, 403)
        self.app.state.events.save.assert_not_awaited()
        self.app.state.events.delete.assert_not_awaited()

    def test_manual_crud_without_pi(self):
        self.app.state.gateway.live_enabled = True
        for method, body in (('POST', payload()), ('PUT', payload(version=1)), ('DELETE', {'id': payload()['id'], 'version': 2})):
            self.assertEqual(self.client.request(method, '/events?source=hardware', headers=self.headers, json=body).status_code, 200)

    def test_bad_inputs_do_not_write(self):
        self.app.state.gateway.live_enabled = True
        for body in (None, {}, payload(note=''), payload(version=1)):
            self.assertEqual(self.client.post('/events?source=hardware', headers=self.headers, json=body).status_code, 400)
        self.assertEqual(self.client.post('/events?source=hardware', headers=self.headers, content='x'*16385).status_code, 413)
        self.app.state.events.save.assert_not_awaited()

    def test_errors_are_isolated(self):
        self.app.state.events.read.side_effect = RuntimeError('secret-dsn')
        response = self.client.get('/events?start=2025-09-01&end=2025-09-01')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret-dsn', response.text)
        self.assertEqual(self.client.get('/state').status_code, 200)

    def test_feeding_never_logs_events(self):
        from test_feeding import payload as feeding_payload
        self.app.state.gateway.live_enabled = True
        self.app.state.feeding.read = AsyncMock(return_value={})
        self.app.state.feeding.save = AsyncMock(return_value={})
        self.client.get('/feeding')
        self.client.put('/feeding?source=hardware', headers=self.headers, json=feeding_payload())
        self.app.state.events.save.assert_not_awaited()
