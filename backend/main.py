import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

if __package__ in (None, ""):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "backend"

from .api import config, conversation
from .core.config import settings

app = FastAPI(title="HarnessPRD")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.include_router(conversation.router)
app.include_router(config.router)


@app.get("/")
def index():
    return {"name": "HarnessPRD", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port)
