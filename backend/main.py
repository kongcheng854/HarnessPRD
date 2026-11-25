from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

if __package__ in (None, ""):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "backend"

from .api import config, conversation, session
from .core.config import settings
from .core.session_repository import initialize
from .middleware.request_id import RequestIdMiddleware

@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title="HarnessPRD", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Request-ID", "X-Session-ID"],
                   expose_headers=["X-Request-ID"])
app.add_middleware(RequestIdMiddleware)
app.include_router(conversation.router)
app.include_router(config.router)
app.include_router(session.router)


@app.exception_handler(Exception)
async def server_error(request: Request, exc: Exception):
    return PlainTextResponse("Internal Server Error", status_code=500,
                             headers={"X-Request-ID": request.state.request_id})


@app.get("/")
def index():
    return {"name": "HarnessPRD", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port)
