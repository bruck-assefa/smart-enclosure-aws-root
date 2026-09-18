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


def present(row, now=None):
    now = now or datetime.now(ZONE)
    today = now.astimezone(ZONE).date()
    plans = row['schedules']
    if isinstance(plans, str):
        plans = json.loads(plans)
    _, plans = validate({'version': row['version'], 'schedules': plans})
    next_dates = {food: next_day(plans[food], today) for food in FOODS}
    return {'version': row['version'], 'schedules': plans, 'timezone': str(ZONE),
            'date': today.isoformat(), 'generated_at': now.timestamp(),
            'today': [food for food in FOODS if occurs(plans[food], today)],
            'next': {food: d.isoformat() if d else None for food, d in next_dates.items()},
            'upcoming': [{'date': (today + timedelta(days=i)).isoformat(),
                          'foods': [food for food in FOODS if occurs(plans[food], today + timedelta(days=i))]}
                         for i in range(7)]}


class Feeding:
    def __init__(self, history):
        self.history = history

    async def read(self):
        if not self.history.dsn:
            raise RuntimeError('Feeding storage disabled')
        pool = await self.history.database()
        async with pool.acquire(timeout=1) as conn:
            row = await conn.fetchrow('SELECT schedules, version FROM enclosure_settings.feeding WHERE id = TRUE')
        if row is None:
            raise RuntimeError('Feeding storage not initialized')
        return present(row)

    async def save(self, payload):
        version, plans = validate(payload)
        if not self.history.dsn:
            raise RuntimeError('Feeding storage disabled')
        pool = await self.history.database()
        async with pool.acquire(timeout=1) as conn:
            row = await conn.fetchrow('''UPDATE enclosure_settings.feeding
                SET schedules=$1::jsonb, version=version+1, updated_at=CURRENT_TIMESTAMP
                WHERE id=TRUE AND version=$2 RETURNING schedules, version''', json.dumps(plans), version)
        if row is None:
            raise Conflict('Feeding settings changed elsewhere. Reload the saved plan before editing again.')
        return present(row)
