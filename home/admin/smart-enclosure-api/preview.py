"""Explicitly supported local simulation preview. No live collector or database."""
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app import create_app

gateway = create_app(simulation_enabled=True, live_enabled=False)

@asynccontextmanager
async def lifespan(app):
    async with gateway.router.lifespan_context(gateway):
        yield

app = FastAPI(lifespan=lifespan)
app.mount("/enclosure", gateway)
# This is a source-development preview, never a production startup target.
web_root = Path(__file__).resolve().parents[3] / "var" / "www" / "bruck.gg"
app.mount("/", StaticFiles(directory=web_root), name="dashboard")
