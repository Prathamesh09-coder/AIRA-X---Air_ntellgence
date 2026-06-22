import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core.config import settings
from core.logging import logger
from db.database import engine, Base
from db.neo4j_db import neo4j_db
from db.redis_db import redis_db

# Include Routers
from api.routers import auth, forecast, source_attribution, enforcement, health_risk, policy, knowledge_graph, analytics, ws

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup Events
    logger.info("Starting Urban AQI API...")
    
    # Initialize PostgreSQL Tables
    async with engine.begin() as conn:
        # Enable PostGIS extension for geometry/geography types
        from sqlalchemy import text
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
        # Note: In production use Alembic. We create tables here for rapid runnable testing.
        await conn.run_sync(Base.metadata.create_all)
        
    # Connect to Redis
    await redis_db.connect()
    
    # Connect to Neo4j
    await neo4j_db.connect()
    
    yield
    
    # Shutdown Events
    logger.info("Shutting down Urban AQI API...")
    await redis_db.close()
    await neo4j_db.close()
    await engine.dispose()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all API routes
app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(forecast.router, prefix=settings.API_V1_STR)
app.include_router(source_attribution.router, prefix=settings.API_V1_STR)
app.include_router(enforcement.router, prefix=settings.API_V1_STR)
app.include_router(health_risk.router, prefix=settings.API_V1_STR)
app.include_router(policy.router, prefix=settings.API_V1_STR)
app.include_router(knowledge_graph.router, prefix=settings.API_V1_STR)
app.include_router(analytics.router, prefix=settings.API_V1_STR)
app.include_router(ws.router, prefix=settings.API_V1_STR)

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": settings.VERSION}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
