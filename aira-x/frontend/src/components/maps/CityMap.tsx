import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { City, GridCell } from "@/lib/aira-data";
import { aqiCategory } from "@/lib/aira-data";

// Clean, light positron-style basemap from CARTO (no token required)
const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "carto-light": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap, © CARTO",
    },
  },
  layers: [{ id: "carto-light", type: "raster", source: "carto-light" }],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
};

function aqiToColor(aqi: number): string {
  if (aqi <= 50) return "#54bf6a";
  if (aqi <= 100) return "#f0c020";
  if (aqi <= 150) return "#f08a3e";
  if (aqi <= 200) return "#e1483b";
  if (aqi <= 300) return "#8a3ea1";
  return "#5a1a1a";
}

type Props = {
  city: City;
  cells: GridCell[];
  className?: string;
  showHeatmap?: boolean;
  showGrid?: boolean;
  mode?: "forecast" | "attribution";
};

export function CityMap({ 
  city, 
  cells, 
  className, 
  showHeatmap = true, 
  showGrid = true,
  mode = "forecast"
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: BASEMAP_STYLE,
      center: city.center,
      zoom: 10.2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      // Convert center coordinates to 1km x 1km grid polygons
      const features = cells.map((c) => {
        const latOffset = 0.0045; // ~500m north/south
        const lngOffset = 0.0045 / Math.cos(city.center[1] * Math.PI / 180); // ~500m east/west adjusted for latitude
        
        return {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[
              [c.lng - lngOffset, c.lat - latOffset],
              [c.lng + lngOffset, c.lat - latOffset],
              [c.lng + lngOffset, c.lat + latOffset],
              [c.lng - lngOffset, c.lat + latOffset],
              [c.lng - lngOffset, c.lat - latOffset]
            ]]
          },
          properties: {
            aqi: c.aqi,
            pm25: c.pm25,
            color: mode === "attribution" ? (c as any).sourceColor || "#00E5FF" : aqiToColor(c.aqi),
            sourceName: (c as any).sourceName || "Traffic",
            sourcePercent: (c as any).sourcePercent || 35,
            evidence: (c as any).evidence || "Elevated sensor telemetry logs."
          }
        };
      });

      map.addSource("aqi", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: features as any,
        },
      });

      // Keep underlying heatmap layer for general trends if selected (forecast mode only)
      if (showHeatmap && mode === "forecast") {
        // Create duplicate center points for heatmap density calculations
        map.addSource("aqi-points-src", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: cells.map((c) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [c.lng, c.lat] },
              properties: { aqi: c.aqi },
            })),
          },
        });

        map.addLayer({
          id: "aqi-heat",
          type: "heatmap",
          source: "aqi-points-src",
          maxzoom: 13,
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "aqi"], 0, 0, 400, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 13, 2.5],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 13, 40],
            "heatmap-opacity": 0.5,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(0,0,0,0)",
              0.15, "rgba(84,191,106,0.4)",
              0.3, "rgba(240,192,32,0.5)",
              0.5, "rgba(240,138,62,0.6)",
              0.7, "rgba(225,72,59,0.7)",
              0.9, "rgba(138,62,161,0.75)",
              1, "rgba(90,26,26,0.8)",
            ],
          },
        });
      }

      // Render actual 1km x 1km grid polygons
      if (showGrid) {
        map.addLayer({
          id: "aqi-grid-fill",
          type: "fill",
          source: "aqi",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": mode === "attribution" ? 0.45 : 0.35,
          },
        });

        map.addLayer({
          id: "aqi-grid-outline",
          type: "line",
          source: "aqi",
          paint: {
            "line-color": "#ffffff",
            "line-width": 0.5,
            "line-opacity": 0.25,
          },
        });
      }

      const popup = new maplibregl.Popup({ closeButton: false, offset: 8 });
      map.on("mousemove", "aqi-grid-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const aqi = f.properties?.aqi as number;
        const pm25 = f.properties?.pm25 as number;
        const cat = aqiCategory(aqi);
        map.getCanvas().style.cursor = "pointer";
        
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            mode === "attribution"
              ? `<div style="font: 500 11px Inter, sans-serif; min-width: 140px; padding: 4px">
                  <div style="color:#6b7280;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Attribution Grid</div>
                  <div style="font-size:13px;font-weight:600;color:${f.properties?.color};margin-bottom:2px">${f.properties?.sourceName}</div>
                  <div style="font-size:15px;font-weight:700">${f.properties?.sourcePercent}% <span style="font-size:10px;font-weight:400;color:#6b7280">contribution</span></div>
                  <div style="margin-top:6px;font-size:10px;line-height:1.2;color:#6b7280">${f.properties?.evidence}</div>
                 </div>`
              : `<div style="font: 500 11px Inter, sans-serif; min-width: 120px; padding: 4px">
                  <div style="color:#6b7280;margin-bottom:4px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px">Forecast Grid</div>
                  <div style="font-size:18px;font-weight:700;line-height:1">${aqi} <span style="font-size:11px;font-weight:400;color:#6b7280">AQI</span></div>
                  <div style="color:${aqiToColor(aqi)};font-size:11px;font-weight:600;margin-top:2px">${cat.label}</div>
                  <div style="margin-top:6px;color:#6b7280;font-size:10px">PM2.5: ${pm25} µg/m³</div>
                 </div>`
          )
          .addTo(map);
      });

      map.on("mouseleave", "aqi-grid-fill", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.id, mode]);

  // Update data sources dynamically when cells change in real-time
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateMapData = () => {
      if (!map.isStyleLoaded()) return;

      // 1. Update polygon grid source
      const gridSource = map.getSource("aqi") as maplibregl.GeoJSONSource | undefined;
      if (gridSource) {
        const latOffset = 0.0045;
        const lngOffset = 0.0045 / Math.cos(city.center[1] * Math.PI / 180);
        const features = cells.map((c) => ({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[
              [c.lng - lngOffset, c.lat - latOffset],
              [c.lng + lngOffset, c.lat - latOffset],
              [c.lng + lngOffset, c.lat + latOffset],
              [c.lng - lngOffset, c.lat + latOffset],
              [c.lng - lngOffset, c.lat - latOffset]
            ]]
          },
          properties: {
            aqi: c.aqi,
            pm25: c.pm25,
            color: mode === "attribution" ? (c as any).sourceColor || "#00E5FF" : aqiToColor(c.aqi),
            sourceName: (c as any).sourceName || "Traffic",
            sourcePercent: (c as any).sourcePercent || 35,
            evidence: (c as any).evidence || "Elevated sensor telemetry logs."
          }
        }));
        gridSource.setData({
          type: "FeatureCollection",
          features: features as any,
        });
      }

      // 2. Update heatmap point source
      const pointSource = map.getSource("aqi-points-src") as maplibregl.GeoJSONSource | undefined;
      if (pointSource) {
        pointSource.setData({
          type: "FeatureCollection",
          features: cells.map((c) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [c.lng, c.lat] },
            properties: { aqi: c.aqi },
          })) as any,
        });
      }
    };

    if (map.loaded()) {
      updateMapData();
    } else {
      map.once("load", updateMapData);
    }
  }, [cells, city, mode]);

  return <div ref={ref} className={className} />;
}
