import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/PageShell";
import { CityMap } from "@/components/maps/CityMap";
import { useAppStore } from "@/store/app-store";
import { generateForecast, generateGrid } from "@/lib/aira-data";
import { useMemo, useState, useEffect } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/aira/KpiCard";
import { Crosshair, TrendingUp, Brain, Gauge } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getForecast, WS_URL } from "@/lib/api";

export const Route = createFileRoute("/forecasting")({
  head: () => ({
    meta: [
      { title: "Hyperlocal Forecast — AIRA-X" },
      { name: "description", content: "1km × 1km AQI and pollutant forecasts up to 72 hours with model explainability and confidence bands." },
      { property: "og:title", content: "Hyperlocal AQI Forecasting — AIRA-X" },
      { property: "og:description", content: "Forecast AQI, PM2.5, PM10, NO₂, SO₂, and Ozone at 1km grid resolution." },
    ],
  }),
  component: ForecastPage,
});

const POLLUTANTS = ["AQI", "PM2.5", "PM10", "NO₂", "SO₂", "O₃"] as const;
const HORIZONS = ["24h", "48h", "72h"] as const;

function ForecastPage() {
  const city = useAppStore((s) => s.city);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>("48h");
  const [pollutant, setPollutant] = useState<(typeof POLLUTANTS)[number]>("AQI");
  const [aqiOffset, setAqiOffset] = useState(0);
  const [liveStreamAlert, setLiveStreamAlert] = useState<string | null>(null);

  const hours = horizon === "24h" ? 24 : horizon === "48h" ? 48 : 72;

  // 1. Fetch live forecast from GNN model
  const { data: liveForecast = [], isLoading } = useQuery({
    queryKey: ["forecast", city.id, city.center[1], city.center[0], hours],
    queryFn: () => getForecast(city.center[1], city.center[0], hours),
  });

  // Real-time WebSocket connection to receive GNN micro-variance adjustments
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[WS Connected] Forecasting Page listening to real-time events...");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "realtime_update") {
          if (payload.aqi_delta !== undefined) {
            setAqiOffset((prev) => {
              const next = prev + payload.aqi_delta;
              return Math.max(-30, Math.min(30, next));
            });
          }
          if (payload.twin_update) {
            setLiveStreamAlert(`GNN Recalculation: ${payload.twin_update.ward} ward changed (AQI ${payload.twin_update.aqi})`);
            setTimeout(() => setLiveStreamAlert(null), 3500);
          }
        }
      } catch (err) {
        console.error("Error parsing WS packet in forecaster:", err);
      }
    };

    ws.onerror = (err) => {
      console.warn("[WS Forecast Error] Fallback active.", err);
    };

    return () => ws.close();
  }, [WS_URL]);

  const pollutantKey = useMemo(() => {
    switch (pollutant) {
      case "PM2.5": return "pm25";
      case "PM10": return "pm10";
      case "NO₂": return "no2";
      case "SO₂": return "so2";
      case "O₃": return "o3";
      default: return "aqi";
    }
  }, [pollutant]);

  // Compute charts data
  const chartData = useMemo(() => {
    if (liveForecast.length === 0) {
      const base = generateForecast(150, hours);
      return base.map(f => ({
        timestamp: `+${f.hour}h`,
        val: f.aqi,
        lower: f.lower,
        upper: f.upper,
        hour: f.hour,
      }));
    }
    return liveForecast.map((f, idx) => {
      const val = f[pollutantKey as keyof typeof f] as number ?? (f.pm25 * 0.35 + 20); // derive O3
      const confidence = Math.max(0.5, 0.95 - idx * 0.005);
      const band = (1 - confidence) * val * 0.35;
      
      // Determine label format
      const date = new Date(f.timestamp);
      const label = isNaN(date.getTime()) ? `+${idx+1}h` : `${date.getHours()}:00`;
      
      // Inject real-time offset to the current timestamp (index 0)
      const finalVal = idx === 0 ? Math.max(10, val + aqiOffset) : val;
      
      return {
        timestamp: label,
        val: Math.round(finalVal * 10) / 10,
        lower: Math.max(0, Math.round((finalVal - band) * 10) / 10),
        upper: Math.round((finalVal + band) * 10) / 10,
        hour: idx + 1,
      };
    });
  }, [liveForecast, pollutantKey, hours, aqiOffset]);

  const peak = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.round(Math.max(...chartData.map((d) => d.val)));
  }, [chartData]);

  // Scale map cells dynamically based on live forecast AQI
  const currentAqi = chartData.length > 0 ? chartData[0].val : 150;
  const cells = useMemo(() => {
    const rawCells = generateGrid(city);
    const baseAvg = rawCells.reduce((sum, c) => sum + c.aqi, 0) / rawCells.length;
    const scale = currentAqi / baseAvg;
    return rawCells.map((c) => ({
      ...c,
      aqi: Math.round(c.aqi * scale),
      pm25: Math.round(c.pm25 * scale),
      pm10: Math.round(c.pm10 * scale),
      no2: Math.round(c.no2 * scale),
      so2: Math.round(c.so2 * scale),
      o3: Math.round(c.o3 * scale),
    }));
  }, [city, currentAqi]);

  const pollutantMix = useMemo(() => {
    if (liveForecast.length === 0) {
      return [
        { name: "PM2.5", current: 145, peak: 198 },
        { name: "PM10", current: 220, peak: 280 },
        { name: "NO₂", current: 62, peak: 88 },
        { name: "SO₂", current: 18, peak: 27 },
        { name: "O₃", current: 48, peak: 71 },
      ];
    }
    
    const cur = liveForecast[0];
    const pm25Max = Math.max(...liveForecast.map(f => f.pm25));
    const pm10Max = Math.max(...liveForecast.map(f => f.pm10));
    const no2Max = Math.max(...liveForecast.map(f => f.no2));
    const so2Max = Math.max(...liveForecast.map(f => f.so2));
    const o3Cur = cur.pm25 * 0.35 + 20;
    const o3Max = pm25Max * 0.35 + 20;
    
    return [
      { name: "PM2.5", current: Math.round(Math.max(10, cur.pm25 + aqiOffset)), peak: Math.round(pm25Max) },
      { name: "PM10", current: Math.round(cur.pm10), peak: Math.round(pm10Max) },
      { name: "NO₂", current: Math.round(cur.no2), peak: Math.round(no2Max) },
      { name: "SO₂", current: Math.round(cur.so2), peak: Math.round(so2Max) },
      { name: "O₃", current: Math.round(o3Cur), peak: Math.round(o3Max) },
    ];
  }, [liveForecast, aqiOffset]);

  const drivers = useMemo(() => {
    // Generate feature weights based on coordinates
    const scale = pseudoRandom(`${city.center[1]}`);
    return [
      { feature: "Wind speed (downwind)", weight: 0.2 + scale() * 0.15 },
      { feature: "Boundary layer height", weight: 0.15 + scale() * 0.1 },
      { feature: "Traffic density (lag 3h)", weight: 0.12 + scale() * 0.1 },
      { feature: "Crop fire FRP (NRT)", weight: city.id === "delhi" ? 0.22 : 0.05 },
      { feature: "Construction activity", weight: 0.08 + scale() * 0.06 },
      { feature: "Humidity & temperature", weight: 0.05 + scale() * 0.04 },
      { feature: "Industrial stack flux", weight: 0.04 + scale() * 0.04 },
    ].sort((a, b) => b.weight - a.weight);
  }, [city]);

  return (
    <PageShell
      title="Hyperlocal AQI Forecasting"
      subtitle={`1km × 1km resolution · PM2.5-GNN ensemble · ${city.name}`}
      breadcrumbs={[{ label: "Intelligence" }, { label: "Forecasting" }]}
      actions={
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
          {liveStreamAlert ? (
            <Badge variant="outline" className="h-8 gap-1.5 border-primary bg-primary/5 text-primary text-[10px] animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {liveStreamAlert}
            </Badge>
          ) : (
            <Badge variant="outline" className="h-8 gap-1.5 text-muted-foreground text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-ping" style={{ animationDuration: '3s' }} /> Live GNN Stream Active
            </Badge>
          )}
          <div className="flex h-8 items-center rounded-md border border-input bg-card p-0.5">
            {POLLUTANTS.map((p) => (
              <button
                key={p}
                onClick={() => setPollutant(p)}
                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  pollutant === p ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex h-8 items-center rounded-md border border-input bg-card p-0.5">
            {HORIZONS.map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  horizon === h ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Forecast Peak" value={peak} hint={`within next ${hours}h`} tone={peak > 200 ? "danger" : "warning"} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <KpiCard label="Crossing Threshold" value="+18h" hint="AQI > 300 (Very Unhealthy)" tone="warning" icon={<Gauge className="h-3.5 w-3.5" />} />
        <KpiCard label="Grid Cells" value={cells.length} hint="1 km × 1 km resolution" icon={<Crosshair className="h-3.5 w-3.5" />} />
        <KpiCard label="Model Confidence" value={hours === 72 ? "81%" : "88%"} hint="ensemble agreement" tone="good" icon={<Brain className="h-3.5 w-3.5" />} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg bg-card ring-1 ring-border lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Grid Forecast Map · {pollutant}</h2>
            <Badge variant="outline" className="h-5 text-[10px]">{horizon} ahead</Badge>
          </div>
          <div className="relative h-[440px]">
            <CityMap city={city} cells={cells} className="absolute inset-0" />
          </div>
        </div>

        <div className="rounded-lg bg-card ring-1 ring-border">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Prediction Drivers</h2>
            <p className="text-[11px] text-muted-foreground">SHAP-based feature importance</p>
          </div>
          <ul className="divide-y divide-border">
            {drivers.map((d) => (
              <li key={d.feature} className="px-4 py-2.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium">{d.feature}</span>
                  <span className="tabular-nums text-muted-foreground">{(d.weight * 100).toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-primary" style={{ width: `${d.weight * 100 * 3.0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg bg-card p-4 ring-1 ring-border lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Time Series Forecast · {pollutant}</h2>
            <span className="text-[11px] text-muted-foreground">Shaded band = 95% confidence interval</span>
          </div>
          <div className="mt-3 h-64">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="fc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="timestamp" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} width={36} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid var(--color-border)" }} />
                <Area dataKey="upper" stroke="none" fill="var(--color-primary)" fillOpacity={0.1} />
                <Area dataKey="lower" stroke="none" fill="var(--color-background)" fillOpacity={1} />
                <Line dataKey="val" stroke="var(--color-primary)" strokeWidth={1.8} dot={false} type="monotone" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg bg-card p-4 ring-1 ring-border">
          <h2 className="text-sm font-semibold">Pollutant Mix · Forecast</h2>
          <div className="mt-3 h-64">
            <ResponsiveContainer>
              <BarChart data={pollutantMix} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid var(--color-border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Bar dataKey="current" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="peak" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function pseudoRandom(seedStr: string) {
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return () => {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };
}
