"""Manually entered enclosure events, independent of sensors and feeding plans."""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from history import day_bounds, ZONE
import asyncio
import json

router = APIRouter()
CATEGORIES = ('feeding', 'cleaning', 'bulb_change', 'other')


def validate(body, deleting=False):
    fields = {'id', 'version'} if deleting else {'id', 'version', 'local_time', 'fold', 'category', 'note'}
    if not isinstance(body, dict) or set(body) != fields:
        raise ValueError('Invalid event fields')
    try:
        event_id = UUID(body['id'])
    except (ValueError, TypeError, AttributeError):
        raise ValueError('Invalid event ID')
    version = body['version']
    if type(version) is not int or not 0 <= version < 2**63 - 1:
        raise ValueError('Invalid event version')
    if deleting:
        if version == 0:
            raise ValueError('Invalid event version')
        return event_id, version
    if body['category'] not in CATEGORIES:
        raise ValueError('Choose an event category')
    if not isinstance(body['note'], str) or not 1 <= len(body['note'].strip()) <= 2000:
        raise ValueError('Enter a note of 1–2000 characters')
    if type(body['fold']) is not int or body['fold'] not in (0, 1):
        raise ValueError('Invalid time occurrence')
    try:
        local = datetime.strptime(body['local_time'], '%Y-%m-%dT%H:%M')
        if local.strftime('%Y-%m-%dT%H:%M') != body['local_time'] or not 2000 <= local.year <= 2100:
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Choose a valid date and time between 2000 and 2100')
    stamp = local.replace(tzinfo=ZONE, fold=body['fold']).astimezone(timezone.utc)
    if stamp.astimezone(ZONE).replace(tzinfo=None) != local:
        raise ValueError('That time does not exist because clocks move forward. Choose another time.')
    if stamp > datetime.now(timezone.utc):
        raise ValueError('Events must be in the past or present')
    return event_id, version, stamp, body['category'], body['note'].strip()


def present(row):
    local = row['occurred_at'].astimezone(ZONE)
    return dict(id=str(row['id']), version=row['version'], occurred_at=row['occurred_at'].timestamp(),
                local_time=local.strftime('%Y-%m-%dT%H:%M'), fold=local.fold,
                category=row['category'], note=row['note'],
                created_at=row['created_at'].timestamp(), updated_at=row['updated_at'].timestamp())


class Events:
    def __init__(self, history):
        self.history = history

    async def database(self):
        if not self.history.dsn:
            raise RuntimeError('Event storage disabled')
        return await self.history.database()

    async def read(self, start, end):
        pool = await self.database()
        async with pool.acquire(timeout=1) as conn:
            rows = await conn.fetch('''SELECT * FROM enclosure_history.events
                WHERE occurred_at >= $1 AND occurred_at < $2 AND deleted_at IS NULL
                ORDER BY occurred_at, id LIMIT 2001''', start, end)
        if len(rows) > 2000:
            raise HTTPException(422, 'Too many events in this range. Select fewer days.')
        return {'events': [present(row) for row in rows], 'start': start.timestamp(), 'end': end.timestamp()}

    async def save(self, body):
        event_id, version, stamp, category, note = validate(body)
        pool = await self.database()
        async with pool.acquire(timeout=1) as conn:
            if version == 0:
                # Stable client UUID makes retries after a lost response safe.
                row = await conn.fetchrow('''INSERT INTO enclosure_history.events
                    (id, occurred_at, category, note) VALUES ($1,$2,$3,$4)
                    ON CONFLICT (id) DO NOTHING RETURNING *''', event_id, stamp, category, note)
                if row is None:
                    row = await conn.fetchrow('SELECT * FROM enclosure_history.events WHERE id=$1', event_id)
                    if row is None or row['deleted_at'] is not None or row['occurred_at'] != stamp or row['category'] != category or row['note'] != note:
                        raise HTTPException(409, 'This event changed elsewhere. Reload events before retrying.')
            else:
                row = await conn.fetchrow('''UPDATE enclosure_history.events SET occurred_at=$3,
                    category=$4, note=$5, version=version+1, updated_at=CURRENT_TIMESTAMP
                    WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING *''', event_id, version, stamp, category, note)
                if row is None:
                    raise HTTPException(409, 'This event changed or was deleted elsewhere. Reload events before editing.')
        return present(row)

    async def delete(self, body):
        event_id, version = validate(body, deleting=True)
        pool = await self.database()
        async with pool.acquire(timeout=1) as conn:
            # Retain deleted notes for recovery; ordinary history excludes them.
            row = await conn.fetchrow('''UPDATE enclosure_history.events SET deleted_at=CURRENT_TIMESTAMP,
                updated_at=CURRENT_TIMESTAMP, version=version+1
                WHERE id=$1 AND version=$2 AND deleted_at IS NULL RETURNING id''', event_id, version)
        if row is None:
            raise HTTPException(409, 'This event changed or was deleted elsewhere. Reload events before deleting.')
        return {'deleted': str(event_id)}


@router.get('/events')
async def read_events(request: Request, start: str, end: str):
    try:
        first, _ = day_bounds(start)
        _, last = day_bounds(end)
        from datetime import date
        if not 1 <= (date.fromisoformat(end) - date.fromisoformat(start)).days + 1 <= 31:
            raise ValueError()
    except (ValueError, OverflowError):
        raise HTTPException(400, 'Select an ordered range of up to 31 days')
    try:
        return await asyncio.wait_for(request.app.state.events.read(first, last), 3)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'Events temporarily unavailable')


@router.post('/events')
@router.put('/events')
@router.delete('/events')
async def write_event(request: Request):
    if (not request.app.state.gateway.live_enabled or request.query_params.get('source') != 'hardware'
            or request.headers.get('X-Enclosure-Control') != '1'):
        raise HTTPException(403, 'Explicit event update required; unavailable in simulation-only mode')
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 16384:
            raise HTTPException(413, 'Event request too large')
    deleting = request.method == 'DELETE'
    try:
        body = json.loads(raw)
        validate(body, deleting)
        if not deleting and ((request.method == 'POST') != (body['version'] == 0)):
            raise ValueError('Invalid version for this operation')
    except (ValueError, TypeError) as error:
        raise HTTPException(400, str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else 'Invalid event request')
    try:
        store = request.app.state.events
        return await asyncio.wait_for(store.delete(body) if deleting else store.save(body), 3)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'Save could not be confirmed. Reload events before retrying; keep your note until confirmed.')
