"""Current-state gateway with independent, optional AWS historical storage."""
import asyncio
import copy
import json
import logging
import math
import os
import time
from contextlib import asynccontextmanager, suppress

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from events import Events, router as events_router
from history import History, day_bounds
from feeding import Feeding, Conflict, validate as validate_feeding, validate_completion
from sensor_contract import new_snapshot, aged, validate_snapshot
from sensor_simulator import simulate, SCENARIOS

REQUEST_TIMEOUT = 2.5
MAX_BODY = 128 * 1024
log = logging.getLogger(__name__)


async def request_json(client, method, path, body=None):
    async def bounded():
        async with client.stream(method, path, json=body) as response:
            response.raise_for_status()
            payload = bytearray()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > MAX_BODY:
                    raise ValueError("Upstream response too large")
            return json.loads(payload)
    return await asyncio.wait_for(bounded(), REQUEST_TIMEOUT)


class Gateway:
    def __init__(self, client, simulation_enabled=False, live_enabled=True):
        self.client = client
        self.simulation_enabled = simulation_enabled
        self.live_enabled = live_enabled
        self.sensors = new_snapshot()
        self.parts = {key: {"data": None, "last_success_at": None, "error": "starting"}
                      for key in ("sensors", "relays", "schedules", "daylight")}
        self.wake = asyncio.Event()
        self.command_lock = asyncio.Lock()
        self.failures = 0
        self.command_revision = 0
        self.frozen_scenarios = {}

    async def refresh_part(self, key, path):
        revision = self.command_revision
        try:
            data = await request_json(self.client, "GET", path)
            if key == "sensors":
                data = validate_snapshot(data)
                self.sensors = data
            elif key == "relays":
                if not isinstance(data, dict) or set(data) != {"1", "2", "3", "4"} or any(
                        value not in ("on", "off") for value in data.values()):
                    raise ValueError("Invalid relay state")
            elif key == 'daylight':
                if not isinstance(data, dict) or not all(k in data for k in ('date', 'sunrise', 'sunset', 'timezone')):
                    raise ValueError('Invalid daylight data')
                day_bounds(data['date'])
                if data['timezone'] != 'America/New_York' or any(
                        type(data[k]) not in (int, float) or not math.isfinite(data[k])
                        for k in ('sunrise', 'sunset')) or data['sunrise'] >= data['sunset']:
                    raise ValueError('Invalid daylight times')
            else:
                if not isinstance(data, list) or len(data) != 4 or any(not isinstance(row, dict) for row in data):
                    raise ValueError("Invalid schedules")
                import re
                if {str(row.get("relay_id")) for row in data} != {"1", "2", "3", "4"}:
                    raise ValueError("Invalid relay IDs")
                for row in data:
                    for field in ("on_time", "off_time"):
                        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", row.get(field, "")):
                            raise ValueError("Invalid schedule time")
            if key != "sensors" and (revision != self.command_revision or self.command_lock.locked()):
                return
            self.parts[key] = {"data": data, "last_success_at": time.time(), "error": None}
        except (httpx.HTTPError, asyncio.TimeoutError, ValueError, KeyError, TypeError) as error:
            if isinstance(error, (asyncio.TimeoutError, httpx.TimeoutException)):
                code = "pi_timeout"
            elif isinstance(error, httpx.HTTPStatusError):
                code = "pi_http_error"
            elif isinstance(error, httpx.HTTPError):
                code = "pi_connection_error"
            else:
                code = "invalid_snapshot"
            if self.parts[key]["error"] != code:
                log.warning("Pi %s collection: %s", key, code)
            self.parts[key]["error"] = code

    async def refresh(self):
        await asyncio.gather(self.refresh_part("sensors", "/v1/sensors"),
                             self.refresh_part("relays", "/relays"),
                             self.refresh_part("schedules", "/schedules"),
                             self.refresh_part('daylight', '/daylight'))
        self.failures = self.failures + 1 if any(p["error"] for key, p in self.parts.items() if key != "daylight") else 0

    async def run(self):
        while True:
            self.wake.clear()
            await self.refresh()
            delay = min(60, 5 * 2 ** min(self.failures, 4))
            try:
                await asyncio.wait_for(self.wake.wait(), delay)
            except asyncio.TimeoutError:
                pass

    def state(self, source="hardware", scenario="healthy"):
        if source not in ("hardware", "simulation"):
            raise HTTPException(400, "Unknown source")
        if source == "simulation":
            if not self.simulation_enabled:
                raise HTTPException(403, "Simulation is disabled")
            if scenario not in SCENARIOS:
                raise HTTPException(400, "Unknown scenario")
            if scenario in ("stale", "pi_offline"):
                if scenario not in self.frozen_scenarios:
                    self.frozen_scenarios[scenario] = simulate(scenario)
                snapshot = aged(self.frozen_scenarios[scenario])
            else:
                snapshot = simulate(scenario)
            return {"source": source, "snapshot": snapshot,
                    "connection": {"status": "unavailable" if scenario == "pi_offline" else "connected",
                                   "last_success_at": time.time() - (90 if scenario == "pi_offline" else 0)},
                    "relays": {"data": None, "last_success_at": None, "error": "simulation"},
                    "schedules": {"data": None, "last_success_at": None, "error": "simulation"},
                    "controls_enabled": False, "simulation_available": True, "live_available": self.live_enabled}
        snapshot = aged(self.sensors)
        parts = copy.deepcopy(self.parts)
        now = time.time()
        for part in parts.values():
            if part["last_success_at"] is None or now - part["last_success_at"] > 15:
                part["error"] = part["error"] or "cache_stale"
        connected = parts["sensors"]["error"] is None
        return {"source": source, "snapshot": snapshot,
                "connection": {"status": "connected" if connected else "unavailable",
                               "last_success_at": parts["sensors"]["last_success_at"],
                               "error": parts["sensors"]["error"]},
                "relays": parts["relays"], "schedules": parts["schedules"], 'daylight': parts['daylight'],
                "controls_enabled": self.live_enabled and all(
                    parts[k]["error"] is None for k in ("relays", "schedules")),
                "simulation_available": self.simulation_enabled, "live_available": self.live_enabled}


def create_app(client=None, simulation_enabled=None, live_enabled=None):
    @asynccontextmanager
    async def lifespan(app):
        owned = client is None
        upstream = client or httpx.AsyncClient(
            base_url=os.environ.get("ENCLOSURE_PI_URL", "http://100.110.157.122:8000"),
            timeout=REQUEST_TIMEOUT, trust_env=False, follow_redirects=False)
        gateway = Gateway(upstream,
            simulation_enabled if simulation_enabled is not None else os.getenv("ENCLOSURE_SIMULATION") == "1",
            live_enabled if live_enabled is not None else os.getenv("ENCLOSURE_LIVE", "1") == "1")
        app.state.gateway = gateway
        history = History(gateway)
        app.state.history = history
        app.state.feeding = Feeding(history)
        app.state.events = Events(history)
        history_task = asyncio.create_task(history.run()) if history.dsn else None
        task = asyncio.create_task(gateway.run()) if gateway.live_enabled else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            if history_task:
                history_task.cancel()
                with suppress(asyncio.CancelledError):
                    await history_task
            await history.close()
            if owned:
                await upstream.aclose()

    app = FastAPI(title="Smart Enclosure state gateway", lifespan=lifespan)
    app.include_router(events_router)

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/state")
    async def state(source: str = "hardware", scenario: str = "healthy"):
        result = app.state.gateway.state(source, scenario)
        result["history"] = dict(app.state.history.status)
        return result

    @app.get("/history/temperatures")
    async def temperatures(date: str, source: str = "hardware"):
        if source not in ("hardware", "simulation"):
            raise HTTPException(400, "Unknown source")
        if source == "simulation":
            return {"status": "simulation_not_stored", "series": []}
        try:
            day_bounds(date)
        except (ValueError, OverflowError):
            raise HTTPException(400, "Expected a valid date in YYYY-MM-DD format")
        try:
            return await app.state.history.read_day(date)
        except Exception:
            raise HTTPException(503, "History temporarily unavailable; live readings are independent")

    @app.get('/zones')
    async def zones():
        try:
            return await app.state.history.read_zones()
        except Exception:
            raise HTTPException(503, 'Zone assignments temporarily unavailable')

    @app.get('/history/range')
    async def history_range(start: str, end: str):
        try:
            from datetime import date
            days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
            day_bounds(start)
            day_bounds(end)
            if not 1 <= days <= 31:
                raise ValueError()
        except (ValueError, OverflowError):
            raise HTTPException(400, 'Select an ordered range of up to 31 days')
        try:
            return await app.state.history.read_range(start, end, days)
        except Exception:
            raise HTTPException(503, 'History temporarily unavailable; live readings are independent')

    @app.get('/feeding')
    async def feeding():
        try:
            return await asyncio.wait_for(app.state.feeding.read(), 3)
        except Exception:
            raise HTTPException(503, 'Feeding schedule temporarily unavailable')

    @app.put('/feeding')
    async def save_feeding(request: Request):
        # Same explicit write intent as other settings, but no dependency on Pi health.
        if request.query_params.get('source') != 'hardware' or request.headers.get('X-Enclosure-Control') != '1':
            raise HTTPException(403, 'Explicit settings update required')
        if not app.state.gateway.live_enabled:
            raise HTTPException(403, 'Settings updates unavailable in simulation-only mode')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 2048:
                raise HTTPException(413, 'Feeding settings request too large')
        try:
            body = json.loads(raw)
            validate_feeding(body)
        except (ValueError, TypeError):
            raise HTTPException(400, 'Choose weekdays or an interval of 1–365 days with a valid start date')
        try:
            return await asyncio.wait_for(app.state.feeding.save(body), 3)
        except Conflict as error:
            raise HTTPException(409, str(error))
        except Exception:
            raise HTTPException(503, 'Save could not be confirmed. Reload the saved plan before retrying.')

    @app.post('/feeding/complete')
    async def complete_feeding(request: Request):
        if request.query_params.get('source') != 'hardware' or request.headers.get('X-Enclosure-Control') != '1' or not app.state.gateway.live_enabled:
            raise HTTPException(403, 'Explicit live feeding confirmation required')
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 2048:
                raise HTTPException(413, 'Feeding confirmation too large')
        try:
            body = json.loads(raw)
            validate_completion(body)
        except (ValueError, TypeError):
            raise HTTPException(400, 'Invalid feeding confirmation')
        try:
            return await asyncio.wait_for(app.state.feeding.complete(body), 3)
        except Conflict as error:
            raise HTTPException(409, str(error))
        except Exception:
            raise HTTPException(503, 'Confirmation could not be verified. Refresh before retrying.')

    async def command(request, path, body=None):
        gateway = app.state.gateway
        # No global mode switch: simulation requests can never operate physical devices.
        if request.query_params.get("source") != "hardware" or request.headers.get("X-Enclosure-Control") != "1":
            raise HTTPException(403, "Explicit live control required")
        if not gateway.state()["controls_enabled"]:
            raise HTTPException(503, "Current relay state is unavailable")
        if gateway.command_lock.locked():
            raise HTTPException(429, "Another control request is in progress")
        async with gateway.command_lock:
            try:
                result = await request_json(gateway.client, request.method, path, body)
                return JSONResponse(result)
            except (httpx.HTTPError, asyncio.TimeoutError, ValueError):
                # A timeout cannot prove that a command did not reach the device.
                raise HTTPException(504, "Command outcome unknown; verify device state before retrying")
            finally:
                gateway.command_revision += 1
                gateway.parts["relays"]["error"] = "refresh_pending"
                gateway.parts["schedules"]["error"] = "refresh_pending"
                gateway.wake.set()

    @app.post("/relays/{relay_id}/{state}")
    async def relay(relay_id: str, state: str, request: Request):
        if relay_id not in ("1", "2", "3", "4") or state not in ("on", "off"):
            raise HTTPException(400, "Invalid relay command")
        return await command(request, f"/relays/{relay_id}/{state}")

    @app.put("/schedules/{relay_id}")
    async def schedule(relay_id: str, request: Request):
        import re
        if relay_id not in ("1", "2", "3", "4"):
            raise HTTPException(400, "Invalid relay")
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 1024:
                raise HTTPException(413, "Schedule request too large")
        try:
            body = json.loads(raw)
            if body.get('mode') not in ('auto', 'sun', 'custom'):
                raise ValueError()
            if body['mode'] != 'sun' and (any(not re.fullmatch(
                    r"(?:[01]\d|2[0-3]):[0-5]\d", body.get(k, "")) for k in ('on_time', 'off_time'))
                    or body['on_time'] == body['off_time']):
                raise ValueError()
            if 'name' in body and (not isinstance(body['name'], str) or
                    not 1 <= len(body['name'].strip()) <= 60 or any(ord(c) < 32 for c in body['name'])):
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(400, 'Choose a valid name, sun/custom mode, and distinct HH:MM times for custom schedules')
        return await command(request, f"/schedules/{relay_id}",
                             {k: body[k] for k in ('on_time', 'off_time', 'mode', 'name') if k in body})

    return app


app = create_app()
