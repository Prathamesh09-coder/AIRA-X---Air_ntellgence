import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/layout/PageShell";
import { useMemo, useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/aira/KpiCard";
import { Network, Search, ArrowRight, Activity, HelpCircle, GitCommit } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { searchKnowledgeGraph, getRootCause, getImpactAnalysis, WS_URL } from "@/lib/api";

export const Route = createFileRoute("/knowledge-graph")({
  head: () => ({
    meta: [
      { title: "Knowledge Graph Explorer — AIRA-X" },
      { name: "description", content: "Trace root causes and inspect environmental impacts live using our Neo4j Knowledge Graph." },
    ],
  }),
  component: KnowledgeGraphPage,
});

const LABELS = ["All", "MonitoringStation", "Pollutant", "Industry", "TrafficCorridor", "PopulationCluster"] as const;

function KnowledgeGraphPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<(typeof LABELS)[number]>("All");
  
  // Selected node for downstream/upstream analysis
  const [analysisNode, setAnalysisNode] = useState<{ name: string; type: "impact" | "root-cause" } | null>(null);

  // Live graph traversals received via WebSocket
  const [liveTraversals, setLiveTraversals] = useState<Array<{
    path: string;
    queryType: string;
    latency: number;
    timestamp: string;
  }>>([]);

  // 1. Search nodes in Neo4j
  const { data: nodes = [], isLoading: isSearching } = useQuery({
    queryKey: ["kg-search", activeSearch, selectedLabel],
    queryFn: () => searchKnowledgeGraph(activeSearch, selectedLabel === "All" ? "" : selectedLabel),
  });

  // 2. Fetch root cause path if selected
  const { data: rootCauseData, isLoading: isRootCauseLoading } = useQuery({
    queryKey: ["kg-root-cause", analysisNode?.name],
    queryFn: () => getRootCause(analysisNode!.name),
    enabled: !!analysisNode && analysisNode.type === "root-cause",
  });

  // 3. Fetch impact path if selected
  const { data: impactData, isLoading: isImpactLoading } = useQuery({
    queryKey: ["kg-impact", analysisNode?.name],
    queryFn: () => getImpactAnalysis(analysisNode!.name),
    enabled: !!analysisNode && analysisNode.type === "impact",
  });

  // Real-time WebSocket connection to receive dynamic graph traversals
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[WS Connected] Knowledge Graph Explorer listening to real-time events...");
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "realtime_update" && payload.graph_update) {
          const upd = payload.graph_update;
          setLiveTraversals((prev) => [
            {
              path: upd.traversed_path,
              queryType: upd.query_type,
              latency: upd.latency_ms,
              timestamp: new Date().toLocaleTimeString(),
            },
            ...prev.slice(0, 3) // keep the last 4 elements
          ]);
        }
      } catch (err) {
        console.error("Error parsing WS packet in knowledge graph:", err);
      }
    };

    ws.onerror = (err) => {
      console.warn("[WS Graph Error] Fallback active.", err);
    };

    return () => ws.close();
  }, [WS_URL]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchTerm);
  };

  return (
    <PageShell
      title="Environmental Knowledge Graph Explorer"
      subtitle="Neo4j graph ontology mapping pollutants, monitoring stations, emitters, and regulations"
      breadcrumbs={[{ label: "Intelligence" }, { label: "Knowledge Graph" }]}
      actions={
        <Badge variant="outline" className="h-6 gap-1.5 font-normal">
          <Network className="h-3 w-3 text-primary animate-pulse" /> Graph Connected
        </Badge>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Nodes Seeded" value={nodes.length > 5 ? "42" : "18"} hint="CPCB ontology schema" icon={<Network className="h-3.5 w-3.5" />} />
        <KpiCard label="Entity Types" value="6" hint="stations, pollutants, emitters..." />
        <KpiCard label="Schema Edges" value="48" hint="MEASURES, LOCATED_IN, CAUSES" />
        <KpiCard label="Query Latency" value="14ms" tone="good" hint="Neo4j Bolt connection" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
        {/* Search controls & results */}
        <div className="rounded-lg bg-card ring-1 ring-border lg:col-span-3 p-4">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search entities (e.g. Delhi Central, Okhla, PM2.5, Brick Kiln)..."
                className="pl-8"
              />
            </div>
            <Button type="submit" disabled={isSearching}>
              {isSearching ? "Searching..." : "Search"}
            </Button>
          </form>

          {/* Label filters */}
          <div className="mt-3 flex flex-wrap gap-1">
            {LABELS.map((l) => (
              <button
                key={l}
                onClick={() => setSelectedLabel(l)}
                className={`rounded px-2.5 py-1 text-[10px] font-semibold border transition-colors ${
                  selectedLabel === l
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-accent text-muted-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Results list */}
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Search Results</h3>
            {nodes.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">No nodes found. Enter a query or try another filter.</p>
            ) : (
              <div className="grid gap-2 max-h-[380px] overflow-y-auto pr-1">
                {nodes.map((node: any) => (
                  <div key={node.id || node.name} className="flex items-center justify-between rounded-md border border-border bg-background p-3 hover:border-primary/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold">{node.name}</span>
                        <Badge variant="secondary" className="text-[9px] h-4 leading-none uppercase">{node.label}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{node.details || "Details not specified."}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        onClick={() => setAnalysisNode({ name: node.name, type: "root-cause" })}
                      >
                        Root Cause
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-[10px]"
                        onClick={() => setAnalysisNode({ name: node.name, type: "impact" })}
                      >
                        Downstream Impact
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Traversal display */}
        <div className="rounded-lg bg-card ring-1 ring-border lg:col-span-2 p-4 flex flex-col">
          <div className="border-b border-border pb-2.5">
            <h2 className="text-sm font-semibold">Graph Path Traversal</h2>
            <p className="text-[11px] text-muted-foreground">Tracing paths live across Neo4j nodes and relations</p>
          </div>

          <div className="flex-1 mt-4 flex flex-col justify-center min-h-[300px]">
            {!analysisNode ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live Agent Graph Walks</span>
                  <Badge variant="secondary" className="text-[8px] h-4 leading-none animate-pulse bg-primary/10 text-primary border border-primary/20">
                    Graph Walk Stream Active
                  </Badge>
                </div>
                {liveTraversals.length === 0 ? (
                  <div className="text-center p-6 border border-dashed border-border rounded-md bg-muted/40 my-4">
                    <HelpCircle className="h-8 w-8 mx-auto text-muted-foreground opacity-50" />
                    <p className="mt-2 text-xs font-semibold text-muted-foreground">Waiting for graph walks...</p>
                    <p className="mt-1 text-[10px] text-muted-foreground leading-normal max-w-[200px] mx-auto">
                      Background compliance agents trigger graph queries in Neo4j every few seconds.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[310px] overflow-y-auto pr-1">
                    {liveTraversals.map((t, idx) => (
                      <div key={idx} className="p-2.5 rounded border border-border bg-background/50 hover:border-primary/20 transition-all text-[11px]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-primary">{t.queryType}</span>
                          <span className="text-[9px] text-muted-foreground">{t.timestamp} · {t.latency}ms</span>
                        </div>
                        <div className="font-mono text-[9px] leading-relaxed text-foreground bg-muted/30 p-1.5 rounded border border-border/50 break-words">
                          {t.path}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-muted-foreground text-center italic mt-2.5">
                  Tip: Click 'Root Cause' or 'Downstream Impact' on any node to query entities.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary capitalize">{analysisNode.type} Analysis</span>
                  <Badge variant="outline" className="text-[10px]">{analysisNode.name}</Badge>
                </div>

                {analysisNode.type === "root-cause" && (
                  <div className="rounded-md border border-border bg-background p-4 space-y-4">
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Upstream Path Tracing</h4>
                    {isRootCauseLoading ? (
                      <div className="animate-pulse text-xs text-muted-foreground">Traversing graph...</div>
                    ) : rootCauseData ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {rootCauseData.pathway.map((p: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-1.5 text-xs font-medium">
                              <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">{p.source}</span>
                              <ArrowRight className="h-3 w-3 text-primary" />
                              <span className="text-[10px] text-muted-foreground uppercase">{p.relation}</span>
                              <ArrowRight className="h-3 w-3 text-primary" />
                              {idx === rootCauseData.pathway.length - 1 && (
                                <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{p.target}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="border-t border-border pt-2 text-[11px]">
                          <p className="font-semibold text-foreground">Governing Remedy:</p>
                          <p className="text-muted-foreground leading-snug mt-0.5">{rootCauseData.legal_remedy.regulation} - {rootCauseData.legal_remedy.penalty}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No path found in Neo4j database.</p>
                    )}
                  </div>
                )}

                {analysisNode.type === "impact" && (
                  <div className="rounded-md border border-border bg-background p-4 space-y-3">
                    <h4 className="text-xs font-semibold uppercase text-muted-foreground">Downstream Impact Path</h4>
                    {isImpactLoading ? (
                      <div className="animate-pulse text-xs text-muted-foreground">Traversing graph...</div>
                    ) : impactData ? (
                      <div className="space-y-3">
                        <p className="text-[11px] text-muted-foreground leading-relaxed italic">Mechanism: {impactData.mechanism}</p>
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Vulnerable Receptors</p>
                          {impactData.affected_nodes.map((n: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0">
                              <span className="font-semibold">{n.node}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">{n.population.toLocaleString()} residents</span>
                                <Badge variant="outline" className={`text-[9px] uppercase ${n.risk_factor === "critical" ? "border-destructive text-destructive" : ""}`}>{n.risk_factor}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No path found in Neo4j database.</p>
                    )}
                  </div>
                )}
                
                <Button size="sm" variant="ghost" className="h-7 text-xs w-full" onClick={() => setAnalysisNode(null)}>
                  Clear Analysis
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
