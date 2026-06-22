from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import json
import random
from datetime import datetime
from core.logging import logger

router = APIRouter(prefix="/ws", tags=["websocket"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Total connections: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send WS message: {e}")
                pass

manager = ConnectionManager()

@router.websocket("")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Simulate real-time updates every 5 seconds
            await asyncio.sleep(5)
            
            # Simulated micro-variance for AQI
            delta = random.choice([-2, -1, 0, 1, 2])
            alert = None
            
            # 10% chance of generating a new alert
            if random.random() < 0.15:
                alert = {
                    "id": f"a{random.randint(10, 99)}",
                    "severity": random.choice(["critical", "high", "medium"]),
                    "ward": random.choice(["Anand Vihar", "Connaught Place", "Rohini", "Dwarka", "Okhla Vihar", "Lajpat Nagar"]),
                    "message": random.choice([
                        "CPCB sensor reports sudden PM2.5 rise due to traffic congestion",
                        "Construction dust threshold violation warning issued",
                        "Upwind crop fire smoke plume boundary entering city limits",
                        "Electrostatic Precipitator failure suspected at industrial unit"
                    ]),
                    "time": "Just now"
                }
            
            # Dynamic twin grid updates
            twin_update = {
                "ward": random.choice(["Anand Vihar", "Connaught Place", "Rohini", "Dwarka", "Okhla Vihar", "Lajpat Nagar"]),
                "aqi": random.randint(140, 290),
                "pm25": random.randint(70, 195),
                "pm10": random.randint(110, 310),
                "no2": random.randint(25, 98),
                "so2": random.randint(8, 32),
                "o3": random.randint(20, 80)
            }
            
            # Dynamic attribution map & hotspot updates
            attribution_update = {
                "dominant_source": random.choice(["Traffic", "Industrial emissions", "Construction", "Crop residue burning"]),
                "traffic_pct": round(30 + random.uniform(-4, 4), 1),
                "industrial_pct": round(25 + random.uniform(-3, 3), 1),
                "construction_pct": round(15 + random.uniform(-2, 2), 1),
                "crop_burning_pct": round(12 + random.uniform(-5, 5), 1),
                "biomass_burning_pct": round(8 + random.uniform(-2, 2), 1),
                "waste_burning_pct": round(5 + random.uniform(-1.5, 1.5), 1),
                "hotspot_lat": 28.6139 + random.uniform(-0.015, 0.015),
                "hotspot_lon": 77.2090 + random.uniform(-0.015, 0.015),
                "evidence_log": random.choice([
                    "Sentinel-5P NO2 plume detected at hotspot location",
                    "MODIS active thermal anomaly detected in upwind crop areas",
                    "Ground-truth station validation shows localized emission peak",
                    "Vehicle tracking systems indicate high traffic density congestion",
                    "Aerial drone reports heavy dust plume from construction site"
                ])
            }
            
            # Dynamic Neo4j Graph Path Traversal updates
            graph_update = {
                "traversed_path": random.choice([
                    "Anand Vihar Station ➔ MEASURES ➔ PM2.5 ➔ IMPACTS ➔ Okhla Residential Cluster",
                    "Ring Road Expressway ➔ EMITS ➔ NO2 ➔ EXCEEDS ➔ Clean Air Act Threshold",
                    "Apex Brick Kiln ➔ SOURCE_OF ➔ SO2 ➔ IMPACTS ➔ Jamia Nagar School Zone",
                    "Connaught Place Station ➔ MEASURES ➔ PM10 ➔ LOCATED_IN ➔ New Delhi District",
                    "Okhla Waste Site ➔ FIRES_CAUSED ➔ PM2.5 ➔ THREATENS ➔ Residential Demographics"
                ]),
                "latency_ms": random.randint(8, 22),
                "query_type": random.choice(["Upstream Root Cause", "Downstream Impact", "Regulatory Remedy", "Ontology Path"])
            }
                
            payload = {
                "type": "realtime_update",
                "timestamp": datetime.utcnow().isoformat(),
                "aqi_delta": delta,
                "new_alert": alert,
                "twin_update": twin_update,
                "attribution_update": attribution_update,
                "graph_update": graph_update
            }
            await websocket.send_text(json.dumps(payload))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
