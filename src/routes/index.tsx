import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Database,
  Download,
  Filter,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Users,
  X,
  ChevronDown,
} from "lucide-react";

import { normaliseAll, fmtINR, fmtHours } from "@/lib/normalize";
import type { NormalisedData } from "@/lib/normalize";
import {
  applyFilters,
  computeAnomalies,
  computeBreakdown,
  computeHeadline,
  computePriority,
  computeWeekly,
  perEmployeeProfile,
} from "@/lib/analytics";
import type { Dimension, Filters } from "@/lib/analytics";
import { AIChat } from "@/components/AIChat";
import { exportExecutivePDF } from "@/lib/export-pdf";
import { UploadDataset, type UploadedDataset } from "@/components/UploadDataset";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Workforce Pulse — where is the time & money going?" },
      {
        name: "description",
        content:
          "COO-facing analytics on 4 weeks of activity data joined against HRMS. Recoverable hours, INR impact, automation priority and a grounded AI copilot.",
      },
      { property: "og:title", content: "Workforce Pulse — where is the time & money going?" },
      {
        property: "og:description",
        content:
          "COO-facing analytics on 4 weeks of activity data joined against HRMS. Recoverable hours, INR impact, automation priority and a grounded AI copilot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

async function loadData(): Promise<NormalisedData> {
  const [empRes, csvRes] = await Promise.all([
    fetch("/data/employees.json"),
    fetch("/data/activity_logs.csv"),
  ]);
  const employees = await empRes.json();
  const csv = await csvRes.text();
  return normaliseAll(employees, csv);
}

function Dashboard() {
  const query = useQuery({
    queryKey: ["workforce-pulse-data"],
    queryFn: loadData,
    staleTime: Infinity,
  });
  const [filters, setFilters] = useState<Filters>({
    department: null,
    taskCategory: null,
    employeeId: null,
  });
  const [dim, setDim] = useState<Dimension>("taskCategory");
  const [showQuality, setShowQuality] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedDataset | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem("workforce-pulse:uploaded-dataset");
      if (!raw) return null;
      return JSON.parse(raw) as UploadedDataset;
    } catch (e) {
      console.warn("[UploadDataset] failed to restore from localStorage", e);
      return null;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (uploaded) {
        window.localStorage.setItem(
          "workforce-pulse:uploaded-dataset",
          JSON.stringify(uploaded),
        );
      } else {
        window.localStorage.removeItem("workforce-pulse:uploaded-dataset");
      }
    } catch (e) {
      console.warn("[UploadDataset] failed to persist to localStorage", e);
    }
  }, [uploaded]);

  const uploadedData = useMemo(() => {
    if (!uploaded) return null;
    try {
      return normaliseAll(uploaded.employeesJson, uploaded.activityCsvText);
    } catch (e) {
      console.error("[UploadDataset] normalisation failed", e);
      return null;
    }
  }, [uploaded]);
  const usingUploaded = uploadedData != null;
  const datasetKey = usingUploaded ? "uploaded" : "demo";
  const lastKeyRef = useRef(datasetKey);
  if (lastKeyRef.current !== datasetKey) {
    lastKeyRef.current = datasetKey;
    if (filters.department || filters.taskCategory || filters.employeeId) {
      setFilters({ department: null, taskCategory: null, employeeId: null });
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Activity className="size-5 animate-pulse text-primary" /> Loading & normalising dataset…
        </div>
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-destructive">
        Failed to load data: {(query.error as Error)?.message}
      </div>
    );
  }
  const data = uploadedData ?? query.data;


  const clearFilter = (k: keyof Filters) => setFilters((f) => ({ ...f, [k]: null }));
  const setFilter = (k: keyof Filters, v: string | null) =>
    setFilters((f) => ({ ...f, [k]: f[k] === v ? null : v }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        data={data}
        filters={filters}
        onClearAll={() => setFilters({ department: null, taskCategory: null, employeeId: null })}
        onExport={() => exportExecutivePDF(data, filters)}
        onOpenQuality={() => setShowQuality(true)}
      />

      <main className="mx-auto max-w-[1440px] px-4 pb-24 pt-6 md:px-8">
        <div className="mb-6">
          <UploadDataset
            onLoaded={(d) => {
              setUploaded(d);
              console.info("[UploadDataset] loaded", {
                employees: d.employeesFileName,
                activity: d.activityFileName,
                activityRows: d.activityRows.length,
              });
            }}
          />
          {usingUploaded ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-md border border-success/40 bg-success/5 px-2.5 py-1 text-[11px] text-success">
                Dashboard is now driven by your uploaded dataset ·{" "}
                {data.employees.length.toLocaleString()} employees ·{" "}
                {data.activity.length.toLocaleString()} activity rows
              </div>
              <button
                onClick={() => setUploaded(null)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-foreground/85 transition hover:border-primary/40 hover:text-foreground"
              >
                <X className="size-3" /> Reset to Demo Data
              </button>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Currently showing the bundled demo dataset. Upload files above to replace it.
            </div>
          )}
        </div>

        {(filters.department || filters.taskCategory || filters.employeeId) && (
          <FilterBar filters={filters} onClear={clearFilter} data={data} />
        )}

        <HeadlineSection
          data={data}
          filters={filters}
          onOpenMethod={() => setMethodOpen((v) => !v)}
          methodOpen={methodOpen}
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <BreakdownPanel
              data={data}
              filters={filters}
              dim={dim}
              setDim={setDim}
              onPick={(v) => {
                if (dim === "taskCategory") setFilter("taskCategory", v);
                else if (dim === "department") setFilter("department", v);
              }}
            />
            <PriorityPanel
              data={data}
              filters={filters}
              onPickTask={(v) => setFilter("taskCategory", v)}
            />
            <div className="grid gap-6 md:grid-cols-2">
              <TrendPanel data={data} filters={filters} />
              <AnomalyPanel data={data} filters={filters} />
            </div>
            <EmployeePanel
              data={data}
              filters={filters}
              setEmployee={(id) => setFilter("employeeId", id)}
            />
          </div>
          <aside className="lg:col-span-1 flex flex-col gap-6">
            <div className="min-h-[520px] lg:sticky lg:top-[88px]">
              <AIChat data={data} filters={filters} />
            </div>
          </aside>
        </div>
      </main>

      {showQuality && <QualityDrawer data={data} onClose={() => setShowQuality(false)} />}
      <FooterMeta data={data} />
    </div>
  );
}

// -------- Header --------
function Header({
  data,
  filters,
  onClearAll,
  onExport,
  onOpenQuality,
}: {
  data: NormalisedData;
  filters: Filters;
  onClearAll: () => void;
  onExport: () => void;
  onOpenQuality: () => void;
}) {
  const dq = data.quality;
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3 md:px-8">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="size-9 rounded-md bg-gradient-to-br from-primary via-primary/70 to-accent" />
            <div className="absolute inset-0 grid place-items-center text-primary-foreground">
              <Activity className="size-4" />
            </div>
          </div>
          <div>
            <div className="font-display text-xl leading-none">Workforce Pulse</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-widest text-muted-foreground">
              {dq.weekRange.start} → {dq.weekRange.end} · {data.employees.length} employees ·{" "}
              {data.activity.length.toLocaleString()} activity rows
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenQuality}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground/85 transition hover:border-primary/40 hover:text-foreground"
          >
            <Database className="size-3.5" /> Data quality
          </button>
          {(filters.department || filters.taskCategory || filters.employeeId) && (
            <button
              onClick={onClearAll}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground/85 hover:border-primary/40"
            >
              <X className="size-3.5" /> Clear filters
            </button>
          )}
          <button
            onClick={onExport}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110"
          >
            <Download className="size-3.5" /> Export summary
          </button>
        </div>
      </div>
    </header>
  );
}

function FilterBar({
  filters,
  onClear,
  data,
}: {
  filters: Filters;
  onClear: (k: keyof Filters) => void;
  data: NormalisedData;
}) {
  const chips: { k: keyof Filters; label: string }[] = [];
  if (filters.department) chips.push({ k: "department", label: `Dept · ${filters.department}` });
  if (filters.taskCategory)
    chips.push({ k: "taskCategory", label: `Task · ${filters.taskCategory}` });
  if (filters.employeeId) {
    const emp = data.employeeMap.get(filters.employeeId);
    chips.push({ k: "employeeId", label: `Employee · ${emp?.name ?? filters.employeeId}` });
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <Filter className="size-3.5 text-primary" />
      <span className="text-muted-foreground">Cross-filter active:</span>
      {chips.map((c) => (
        <button
          key={c.k}
          onClick={() => onClear(c.k)}
          className="chip !border-primary/40 !bg-primary/10 !text-primary hover:!brightness-110"
        >
          {c.label} <X className="size-3" />
        </button>
      ))}
    </div>
  );
}

// -------- Headline --------
function HeadlineSection({
  data,
  filters,
  methodOpen,
  onOpenMethod,
}: {
  data: NormalisedData;
  filters: Filters;
  methodOpen: boolean;
  onOpenMethod: () => void;
}) {
  const h = computeHeadline(data, filters);
  const priced = h.perEmployee.filter((e) => e.hourlyINR).length;
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-none md:text-5xl">Where the time goes.</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            One month of activity, joined against HRMS. Two headline numbers, one automation queue,
            and a grounded copilot that can defend every figure it quotes.
          </p>
        </div>
        <button
          onClick={onOpenMethod}
          className="hidden shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground md:inline-flex"
        >
          Methodology{" "}
          <ChevronDown className={`size-3 transition ${methodOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <HeadlineCard
          label="Hours recoverable per month"
          value={fmtHours(h.recoverableMinutesPerMonth)}
          sub={`out of ${fmtHours(h.repetitiveMinutes)} repetitive time observed over ${h.weeksCovered} wk`}
          tone="primary"
        />
        <HeadlineCard
          label="INR recoverable per month"
          value={fmtINR(h.recoverableINRPerMonth)}
          sub={`Priced against joined HRMS rate  ·  ${priced}/${h.perEmployee.length} employees priced`}
          tone="accent"
        />
      </div>

      {methodOpen && <Methodology />}
    </section>
  );
}

function HeadlineCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "primary" | "accent";
}) {
  return (
    <div className="panel relative overflow-hidden p-6">
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-8 -top-8 size-40 rounded-full blur-3xl ${
          tone === "primary" ? "bg-primary/20" : "bg-accent/25"
        }`}
      />
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-3 font-display text-6xl leading-none num">{value}</div>
      <div className="mt-3 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Methodology() {
  return (
    <div className="panel mt-4 p-5 text-xs leading-relaxed text-foreground/80">
      <div className="mb-2 flex items-center gap-2 text-sm text-foreground">
        <Sparkles className="size-4 text-primary" /> Methodology (auditable)
      </div>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <b>Recoverable minutes</b> per row ={" "}
          <span className="num">duration × automationFactor(task, is_repetitive)</span>. Factors are
          documented per canonical task in <code>src/lib/analytics.ts</code>. Rules-based digital
          tasks (Data Entry, CRM Updates, Invoice Processing) score 0.75-0.85; judgment tasks
          (Meetings, Client Comms) score 0.10-0.15.
        </li>
        <li>
          <b>Per-month projection</b>: sum recoverable minutes in the filtered window, divide by
          weeks observed, multiply by 4.345.
        </li>
        <li>
          <b>INR</b> = recoverable hours × HRMS hourly rate. Annual comp is converted using 2,080
          hrs/yr. Employees with no comp data contribute 0 rupees (never invented).
        </li>
        <li>
          <b>Priority score</b> = 0.30 × normalised volume + 0.30 × repetitive share + 0.20 ×
          employee concentration + 0.20 × normalised INR impact.
        </li>
        <li>
          <b>Duplicate E007</b>: kept the record with the highest annual-INR-equivalent and highest
          tenure (see Data quality drawer). <b>E099</b> (in HRMS, no activity) is retained in the
          roster but never inflates headline numbers. <b>E013</b> (in activity, missing from HRMS)
          is kept in activity charts but contributes ₹0 to the rupee headline.
        </li>
      </ol>
    </div>
  );
}

// -------- Breakdown --------
function BreakdownPanel({
  data,
  filters,
  dim,
  setDim,
  onPick,
}: {
  data: NormalisedData;
  filters: Filters;
  dim: Dimension;
  setDim: (d: Dimension) => void;
  onPick: (key: string) => void;
}) {
  const rows = computeBreakdown(data, filters, dim).slice(0, 10);
  const dims: { key: Dimension; label: string }[] = [
    { key: "taskCategory", label: "Task category" },
    { key: "app", label: "App" },
    { key: "department", label: "Department" },
  ];
  const clickable = dim === "taskCategory" || dim === "department";
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Where the time sits</div>
          <div className="text-xs text-muted-foreground">
            {clickable ? "Click a bar to cross-filter." : "Switch dimension to cross-filter."}
          </div>
        </div>
        <div className="flex rounded-md border border-border bg-surface-2 p-0.5 text-xs">
          {dims.map((d) => (
            <button
              key={d.key}
              onClick={() => setDim(d.key)}
              className={`rounded px-3 py-1 transition ${
                dim === d.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ left: 10, right: 16, top: 4, bottom: 4 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" horizontal={false} />
            <XAxis
              type="number"
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickFormatter={(v) => `${Math.round(v / 60)}h`}
            />
            <YAxis
              dataKey="key"
              type="category"
              stroke="var(--muted-foreground)"
              fontSize={11}
              width={130}
              tick={{ fill: "var(--foreground)" }}
            />
            <Tooltip content={<BreakdownTooltip />} cursor={{ fill: "oklch(1 0 0 / 0.04)" }} />
            <Bar
              dataKey="totalMinutes"
              radius={[0, 4, 4, 0]}
              onClick={(_d, i) => clickable && onPick(rows[i].key)}
              cursor={clickable ? "pointer" : "default"}
            >
              {rows.map((r, i) => (
                <Cell
                  key={r.key}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  opacity={r.repetitiveMinutes / Math.max(1, r.totalMinutes) > 0.5 ? 1 : 0.65}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded bg-chart-1" /> High repetitive share
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded bg-chart-1/50" /> Low repetitive share
        </span>
      </div>
    </div>
  );
}

function BreakdownTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <div className="font-medium">{r.key}</div>
      <div className="num text-muted-foreground">
        {fmtHours(r.totalMinutes)} logged ·{" "}
        {Math.round((r.repetitiveMinutes / Math.max(1, r.totalMinutes)) * 100)}% repetitive
      </div>
      <div className="num text-muted-foreground">
        {r.uniqueEmployees} people · {fmtINR(r.recoverableINR)}/mo recoverable
      </div>
    </div>
  );
}

// -------- Priority --------
function PriorityPanel({
  data,
  filters,
  onPickTask,
}: {
  data: NormalisedData;
  filters: Filters;
  onPickTask: (t: string) => void;
}) {
  const rows = computePriority(data, filters).slice(0, 8);
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Automate this first</div>
          <div className="text-xs text-muted-foreground">
            Volume · repetitiveness · people affected · rupee impact — click a row to cross-filter
            the dashboard.
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {rows.map((r, i) => (
          <button
            key={r.taskCategory}
            onClick={() => onPickTask(r.taskCategory)}
            className={`group grid grid-cols-[24px_1fr_auto] items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition hover:border-primary/30 hover:bg-surface-2/70 ${
              filters.taskCategory === r.taskCategory ? "border-primary/50 bg-primary/5" : ""
            }`}
          >
            <div className="num text-xs text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{r.taskCategory}</span>
                <span className="chip num">{r.concentration} people</span>
                <span className="chip num">{Math.round(r.repetitiveShare * 100)}% repetitive</span>
                <span className="chip num">{fmtHours(r.volume)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <ScoreBar score={r.score} />
                <span className="num shrink-0 text-[11px] text-muted-foreground">
                  score {r.score.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="num text-sm font-semibold text-primary">
                {fmtINR(r.recoverableINRPerMonth)}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                / month
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary via-primary to-accent"
        style={{ width: `${Math.round(score * 100)}%` }}
      />
    </div>
  );
}

// -------- Trend --------
function TrendPanel({ data, filters }: { data: NormalisedData; filters: Filters }) {
  const { data: weekly, keys } = computeWeekly(data, filters, 5);
  return (
    <div className="panel p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <TrendingUp className="size-4 text-accent" /> Week-over-week · top 5 tasks
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Minutes logged per week, filtered to current view.
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer>
          <LineChart data={weekly} margin={{ left: -12, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" />
            <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickFormatter={(v) => `${Math.round(v / 60)}h`}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// -------- Anomaly --------
function AnomalyPanel({ data, filters }: { data: NormalisedData; filters: Filters }) {
  const anomalies = computeAnomalies(data, filters);
  return (
    <div className="panel p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 text-warning" /> Anomalies to know about
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Statistical outliers, terminations still logging, and steep WoW spikes.
      </div>
      <div className="space-y-2">
        {anomalies.length === 0 && (
          <div className="rounded-md border border-border bg-surface-2/60 px-3 py-4 text-center text-xs text-muted-foreground">
            No anomalies in this filter slice.
          </div>
        )}
        {anomalies.map((a, i) => (
          <div key={i} className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
            <div className="text-sm font-medium">{a.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{a.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// -------- Employees --------
function EmployeePanel({
  data,
  filters,
  setEmployee,
}: {
  data: NormalisedData;
  filters: Filters;
  setEmployee: (id: string | null) => void;
}) {
  const rows = useMemo(() => {
    const activity = applyFilters(data.activity, filters);
    const perEmp = new Map<string, { min: number; rep: number }>();
    for (const r of activity) {
      const cur = perEmp.get(r.employeeId) ?? { min: 0, rep: 0 };
      cur.min += r.durationMinutes;
      if (r.isRepetitive) cur.rep += r.durationMinutes;
      perEmp.set(r.employeeId, cur);
    }
    return Array.from(perEmp.entries())
      .map(([id, v]) => {
        const emp = data.employeeMap.get(id);
        return {
          id,
          emp,
          total: v.min,
          repShare: v.min ? v.rep / v.min : 0,
          inrRecoverable: emp?.hourlyINR ? (v.rep / 60) * emp.hourlyINR * 0.5 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [data, filters]);

  const selected = filters.employeeId ? perEmployeeProfile(data, filters.employeeId) : null;

  return (
    <div className="panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="size-4 text-accent" /> People — click to drill down
        </div>
        {filters.employeeId && (
          <button onClick={() => setEmployee(null)} className="chip">
            clear selection <X className="size-3" />
          </button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="max-h-[360px] overflow-y-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Dept</th>
                <th className="px-3 py-2 text-right">Logged</th>
                <th className="px-3 py-2 text-right">Rep %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = filters.employeeId === r.id;
                const orphan = !r.emp;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setEmployee(r.id)}
                    className={`cursor-pointer border-t border-border/60 hover:bg-surface-2/60 ${isSel ? "bg-primary/10" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`num text-[10px] text-muted-foreground`}>{r.id}</span>
                        <span className="font-medium">{r.emp?.name ?? "(no HRMS record)"}</span>
                        {orphan && (
                          <span className="chip !border-destructive/40 !text-destructive">
                            orphan
                          </span>
                        )}
                        {r.emp?.status === "terminated" && (
                          <span className="chip !border-warning/40 !text-warning">terminated</span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{r.emp?.role}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.emp?.department ?? "—"}</td>
                    <td className="px-3 py-2 text-right num">{fmtHours(r.total)}</td>
                    <td className="px-3 py-2 text-right num">{Math.round(r.repShare * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          {selected?.employee ? (
            <EmployeeDrilldown p={selected} />
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              <div>
                <ChevronRight className="mx-auto mb-2 size-5 text-muted-foreground" />
                Click any employee to see their repetitive-task profile and peer comparison.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmployeeDrilldown({ p }: { p: ReturnType<typeof perEmployeeProfile> }) {
  const emp = p.employee!;
  return (
    <div className="rounded-md border border-border bg-surface-2/60 p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-display text-2xl leading-tight">{emp.name}</div>
          <div className="text-xs text-muted-foreground">
            {emp.role} · {emp.department}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-sm">
            {emp.annualINR ? fmtINR(emp.annualINR) : "no comp"}
            <span className="text-[10px] text-muted-foreground"> /yr</span>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {emp.compSource !== "none" ? emp.compSource : "unpriced"}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded border border-border/60 p-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Logged</div>
          <div className="num text-lg">{fmtHours(p.totalMinutes)}</div>
        </div>
        <div className="rounded border border-border/60 p-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Repetitive share
          </div>
          <div className="num text-lg">{Math.round(p.repetitiveShare * 100)}%</div>
          <div className="text-[10px] text-muted-foreground">
            peer avg {Math.round(p.peerRepetitiveShare * 100)}%
          </div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Top repetitive tasks
        </div>
        {p.topRepetitive.length === 0 && (
          <div className="text-xs text-muted-foreground">No repetitive activity logged.</div>
        )}
        <div className="space-y-1">
          {p.topRepetitive.map(([task, min]) => (
            <div
              key={task}
              className="flex items-center justify-between rounded bg-surface px-2 py-1.5 text-xs"
            >
              <span>{task}</span>
              <span className="num text-muted-foreground">{fmtHours(min)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -------- Data quality drawer --------
function QualityDrawer({ data, onClose }: { data: NormalisedData; onClose: () => void }) {
  const q = data.quality;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" />
            <span className="font-medium">Data quality</span>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-surface-2">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 text-xs">
          <section>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Activity CSV
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Raw rows" value={q.activityRaw} />
              <Stat label="Kept" value={q.activityKept} tone="ok" />
              <Stat
                label="Dropped · dur ≤ 0"
                value={q.activityDropped.negativeOrZero}
                tone="warn"
              />
              <Stat label="Dropped · > 8h" value={q.activityDropped.tooLarge} tone="warn" />
              <Stat
                label="Dropped · bad timestamp"
                value={q.activityDropped.badTimestamp}
                tone="warn"
              />
              <Stat label="Dropped · duplicates" value={q.activityDropped.duplicates} tone="warn" />
              <Stat
                label="Apps canonicalised"
                value={q.activityFixed.appsCanonicalised}
                tone="ok"
              />
              <Stat
                label="Tasks canonicalised"
                value={q.activityFixed.tasksCanonicalised}
                tone="ok"
              />
              <Stat
                label="Booleans normalised"
                value={q.activityFixed.booleansNormalised}
                tone="ok"
              />
            </div>
          </section>
          <section>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              HRMS join
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Raw records" value={q.employeesRaw} />
              <Stat label="Unique employees" value={q.employeesKept} />
              <Stat label="Duplicate IDs" value={q.duplicateIds.length} tone="warn" />
              <Stat
                label="Orphans (activity, no HRMS)"
                value={q.activityIdsWithoutEmployee.length}
                tone="warn"
              />
              <Stat
                label="HRMS w/o activity"
                value={q.employeesWithoutActivity.length}
                tone="warn"
              />
              <Stat
                label="Comp conflicts resolved"
                value={q.compensationConflicts.length}
                tone="ok"
              />
            </div>
            {q.duplicateIds.length > 0 && (
              <p className="mt-2 text-muted-foreground">
                Duplicates: <span className="num">{q.duplicateIds.join(", ")}</span> — kept highest
                annual-INR equivalent with tenure as tiebreak.
              </p>
            )}
            {q.activityIdsWithoutEmployee.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Orphan IDs kept in activity totals, excluded from INR:{" "}
                <span className="num">{q.activityIdsWithoutEmployee.join(", ")}</span>
              </p>
            )}
            {q.employeesWithoutActivity.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                HRMS with no activity:{" "}
                <span className="num">{q.employeesWithoutActivity.join(", ")}</span>
              </p>
            )}
          </section>
          <section>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Compensation conflicts
            </div>
            <div className="mt-2 space-y-2">
              {q.compensationConflicts.length === 0 && (
                <p className="text-muted-foreground">No conflicts.</p>
              )}
              {q.compensationConflicts.map((c) => (
                <div key={c.id} className="rounded border border-border bg-surface-2/60 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.id}</span>
                    <span className="num text-primary">{fmtINR(c.chosen)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    candidates: <span className="num">{c.alternates.map(fmtINR).join(" · ")}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Strategy: {c.strategy}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: number;
  tone?: "" | "ok" | "warn";
}) {
  const color =
    tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded border border-border bg-surface-2/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`num text-base ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function FooterMeta({ data }: { data: NormalisedData }) {
  return (
    <footer className="border-t border-border/70 py-6 text-center text-[11px] text-muted-foreground">
      Data snapshot{" "}
      {data.meta.generatedAt ? new Date(data.meta.generatedAt).toISOString().slice(0, 10) : "—"} ·
      source: {data.meta.source ?? "HRMS export"} · every headline number is traceable to its source
      rows.
    </footer>
  );
}
