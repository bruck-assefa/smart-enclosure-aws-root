"""Calendar-day feeding plans stored on AWS; no hardware or background jobs."""
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/New_York')
FOODS = ('salad', 'bugs')


class Conflict(Exception):
    pass


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != {'version', 'schedules'}:
        raise ValueError('Expected version and schedules')
    version = payload['version']
    if type(version) is not int or not 0 <= version < 2**63 - 1:
        raise ValueError('Invalid schedule version')
    plans = payload['schedules']
    if not isinstance(plans, dict) or set(plans) != set(FOODS):
        raise ValueError('Configure both salad and bugs')
    cleaned = {}
    for food in FOODS:
        plan = plans[food]
        if not isinstance(plan, dict) or set(plan) != {'enabled', 'mode', 'weekdays', 'every_days', 'start_date'}:
            raise ValueError('Invalid feeding schedule fields')
        if type(plan['enabled']) is not bool or plan['mode'] not in ('weekly', 'interval'):
            raise ValueError('Choose weekdays or an interval')
        days = plan['weekdays']
        if not isinstance(days, list) or len(days) > 7 or any(type(d) is not int or not 0 <= d <= 6 for d in days):
            raise ValueError('Weekdays must be Monday (0) through Sunday (6)')
        if len(days) != len(set(days)):
            raise ValueError('Weekdays must be unique')
        every = plan['every_days']
        if type(every) is not int or not 1 <= every <= 365:
            raise ValueError('Choose an interval from 1 to 365 days')
        start = plan['start_date']
        if start is not None:
            try:
                parsed = date.fromisoformat(start)
                if parsed.isoformat() != start or not 2000 <= parsed.year <= 2100:
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValueError('Choose a valid start date between 2000 and 2100')
        if plan['enabled'] and plan['mode'] == 'weekly' and not days:
            raise ValueError('Select at least one weekday for ' + food)
        if plan['enabled'] and plan['mode'] == 'interval' and start is None:
            raise ValueError('Choose a start date for ' + food)
        cleaned[food] = dict(plan, weekdays=sorted(days))
    return version, cleaned


def occurs(plan, day):
    if not plan['enabled']:
        return False
    if plan['mode'] == 'weekly':
        return day.weekday() in plan['weekdays']
    start = date.fromisoformat(plan['start_date'])
    elapsed = (day - start).days
    return elapsed >= 0 and elapsed % plan['every_days'] == 0


def next_day(plan, today):
    """Next occurrence strictly after today, so 'today' is never repeated."""
    if not plan['enabled']:
        return None
    tomorrow = today + timedelta(days=1)
    if plan['mode'] == 'weekly':
        return next(tomorrow + timedelta(days=i) for i in range(7)
                    if occurs(plan, tomorrow + timedelta(days=i)))
    start = date.fromisoformat(plan['start_date'])
    steps = max(0, ((tomorrow - start).days + plan['every_days'] - 1) // plan['every_days'])
    return start + timedelta(days=steps * plan['every_days'])


def outstanding(plan, since, today):
    first = next_day(plan, since - timedelta(days=1))
    return first if first and first <= today else None


def validate_completion(body):
    if not isinstance(body, dict) or set(body) != {'version', 'food', 'date'}:
        raise ValueError('Expected version, food and date')
    if type(body['version']) is not int or not 0 <= body['version'] < 2**63 - 1:
        raise ValueError('Invalid version')
    if body['food'] not in FOODS or not isinstance(body['date'], str):
        raise ValueError('Invalid feeding')
    if date.fromisoformat(body['date']).isoformat() != body['date']:
        raise ValueError('Invalid date')


def present(row, now=None, history=()):
    now = now or datetime.now(ZONE)
    today = now.astimezone(ZONE).date()
    plans = row['schedules']
    if isinstance(plans, str):
        plans = json.loads(plans)
    _, plans = validate({'version': row['version'], 'schedules': plans})
    tracking = row.get('tracking') or {food: today.isoformat() for food in FOODS}
    if isinstance(tracking, str):
        tracking = json.loads(tracking)
    due = {food: outstanding(plans[food], date.fromisoformat(tracking[food]), today) for food in FOODS}
    next_dates = {food: next_day(plans[food], today) for food in FOODS}
    return {'version': row['version'], 'schedules': plans, 'timezone': str(ZONE),
            'date': today.isoformat(), 'generated_at': now.timestamp(),
            'today': [food for food in FOODS if due[food]],
            'due': {food: d.isoformat() if d else None for food, d in due.items()},
            'history': [dict(item, scheduled_date=item['scheduled_date'].isoformat(),
                             completed_date=item['completed_date'].isoformat(),
                             completed_at=item['completed_at'].isoformat()) for item in history],
            'next': {food: d.isoformat() if d else None for food, d in next_dates.items()},
            'upcoming': [{'date': (today + timedelta(days=i)).isoformat(),
                          'foods': [food for food in FOODS if (due[food] if i == 0 else occurs(plans[food], today + timedelta(days=i)))]}
                         for i in range(7)]}


class Feeding:
    def __init__(self, history):
        self.history = history

    async def snapshot(self, conn):
        row = await conn.fetchrow('SELECT schedules, version, tracking FROM enclosure_settings.feeding WHERE id = TRUE')
        if row is None:
            raise RuntimeError('Feeding storage not initialized')
        records = await conn.fetch("""SELECT food, scheduled_date, completed_date, completed_at
            FROM enclosure_settings.feeding_history ORDER BY completed_at DESC, food LIMIT 100""")
        return present(row, history=records)

    async def read(self):
        if not self.history.dsn:
            raise RuntimeError('Feeding storage disabled')
        pool = await self.history.database()
        async with pool.acquire(timeout=1) as conn:
            async with conn.transaction(isolation='repeatable_read', readonly=True):
                return await self.snapshot(conn)

    async def save(self, payload):
        version, plans = validate(payload)
        if not self.history.dsn:
            raise RuntimeError('Feeding storage disabled')
        pool = await self.history.database()
        async with pool.acquire(timeout=1) as conn:
            async with conn.transaction():
                row = await conn.fetchrow("""UPDATE enclosure_settings.feeding
                    SET tracking=jsonb_build_object(
                        'salad', CASE WHEN schedules->'salad' = $1::jsonb->'salad' THEN tracking->>'salad' ELSE GREATEST($3, tracking->>'salad') END,
                        'bugs', CASE WHEN schedules->'bugs' = $1::jsonb->'bugs' THEN tracking->>'bugs' ELSE GREATEST($3, tracking->>'bugs') END),
                    schedules=$1::jsonb, version=version+1, updated_at=CURRENT_TIMESTAMP
                    WHERE id=TRUE AND version=$2 RETURNING schedules, version""",
                    json.dumps(plans), version, datetime.now(ZONE).date().isoformat())
                if row is None:
                    raise Conflict('Feeding settings changed elsewhere. Reload the saved plan before editing again.')
                return await self.snapshot(conn)

    async def complete(self, body):
        validate_completion(body)
        if not self.history.dsn:
            raise RuntimeError('Feeding storage disabled')
        pool = await self.history.database()
        async with pool.acquire(timeout=1) as conn:
            async with conn.transaction():
                row = await conn.fetchrow('SELECT schedules, version, tracking FROM enclosure_settings.feeding WHERE id=TRUE FOR UPDATE')
                if row is None:
                    raise RuntimeError('Feeding storage not initialized')
                now = datetime.now(ZONE)
                state = present(row, now)
                food = body['food']
                if body['version'] != state['version'] or body['date'] != state['date'] or food not in state['today']:
                    raise Conflict('The feeding plan changed or this feeding is already complete. Refresh before retrying.')
                today = now.date()
                await conn.execute("""INSERT INTO enclosure_settings.feeding_history
                    (food, scheduled_date, completed_date, completed_at) VALUES ($1, $2, $3, $4)""",
                    food, date.fromisoformat(state['due'][food]), today, now)
                await conn.execute("""UPDATE enclosure_settings.feeding SET
                    tracking=jsonb_set(tracking, ARRAY[$1::text], to_jsonb($2::text)),
                    version=version+1 WHERE id=TRUE""", food, (today + timedelta(days=1)).isoformat())
                return await self.snapshot(conn)
