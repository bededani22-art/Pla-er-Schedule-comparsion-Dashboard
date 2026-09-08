import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  buildSnapshot,
  compareSnapshots,
  fmtDate,
  fmtMoney,
  parseXer,
  type ActivityTag,
  type Comparison,
} from "@/lib/xer";
import { BrandMark } from "@/components/PlanerLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Schedule Comparison Dashboard | Primavera P6 XER Delta Review" },
      {
        name: "description",
        content:
          "Compare two Primavera P6 XER files in your browser: date movement, added and dropped activities, critical path shifts, resource and WBS deltas.",
      },
      { property: "og:title", content: "Schedule Comparison Dashboard" },
      {
        property: "og:description",
        content:
          "Upload a baseline and an updated P6 XER file to get a full schedule delta review, entirely offline in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Loaded = { name: string; snapshot: ReturnType<typeof buildSnapshot> } | null;

function DropZone({
  label,
  hint,
  loaded,
  onFile,
  error,
}: {
  label: string;
  hint: string;
  loaded: Loaded;
  onFile: (file: File) => void;
  error?: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`relative rounded-md border-2 border-dashed p-6 text-center transition-colors ${
        over ? "border-accent bg-accent/5" : "border-border bg-panel"
      }`}
    >
      <span className="mono-label absolute -top-3 left-6 rounded-sm bg-primary px-2 py-1 text-primary-foreground">
        {label}
      </span>
      {loaded ? (
        <div className="py-1">
          <p className="font-mono text-sm font-medium text-accent">{loaded.name}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {loaded.snapshot.activities.size} activities · {loaded.snapshot.resources.size} resources
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{loaded.snapshot.projectName}</p>
        </div>
      ) : (
        <>
          <p className="text-base font-semibold">{hint}</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">or click to browse</p>
        </>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mono-label mt-4 rounded-sm bg-primary px-4 py-2 text-primary-foreground transition-opacity hover:opacity-90"
      >
        {loaded ? "Replace file" : "Choose file"}
      </button>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept=".xer,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function Table({
  head,
  rows,
  scroll = false,
}: {
  head: string[];
  rows: React.ReactNode[][];
  scroll?: boolean;
}) {
  if (!rows.length) {
    return <p className="font-mono text-sm text-muted-foreground">No entries in this category.</p>;
  }
  const table = (
    <table className="w-full border-collapse text-sm">
      <thead className={scroll ? "sticky top-0 z-10 bg-panel shadow-[0_1px_0_var(--border)]" : ""}>
        <tr className="border-b border-border">
          {head.map((h) => (
            <th key={h} className="mono-label bg-panel px-3 py-2 text-left text-muted-foreground">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-secondary/60">
            {r.map((c, j) => (
              <td key={j} className="px-3 py-2 align-top">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!scroll) return <div className="overflow-x-auto">{table}</div>;

  return (
    <div className="table-scroll h-full rounded-sm border border-border bg-panel">{table}</div>
  );
}

function Delta({ value, suffix = "d" }: { value: number; suffix?: string }) {
  const tone =
    value > 0 ? "text-destructive" : value < 0 ? "text-success" : "text-muted-foreground";
  return (
    <span className={`font-mono font-medium ${tone}`}>
      {value > 0 ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

const TAG_STYLES: Record<ActivityTag, string> = {
  added: "bg-success/15 text-success",
  removed: "bg-destructive/15 text-destructive",
  delayed: "bg-destructive/15 text-destructive",
  accelerated: "bg-success/15 text-success",
  duration: "bg-warning/20 text-foreground",
  progress: "bg-accent/15 text-accent",
};

const FILTERS: { key: "all" | ActivityTag; label: string }[] = [
  { key: "all", label: "All" },
  { key: "added", label: "Added" },
  { key: "removed", label: "Removed" },
  { key: "delayed", label: "Delayed" },
  { key: "accelerated", label: "Accelerated" },
  { key: "duration", label: "Duration changed" },
  { key: "progress", label: "Progress made" },
];

type TabKey = "cover" | "movement" | "activities" | "critical" | "resources" | "wbs";

const TABS: { key: TabKey; index: string; label: string }[] = [
  { key: "cover", index: "00", label: "Cover Sheet" },
  { key: "movement", index: "01", label: "Schedule Movement" },
  { key: "activities", index: "02", label: "Activity Changes" },
  { key: "critical", index: "03", label: "Critical Path Shift" },
  { key: "resources", index: "04", label: "Resource Changes" },
  { key: "wbs", index: "05", label: "WBS Comparison" },
];

function Report({ comparison }: { comparison: Comparison }) {
  const [tab, setTab] = useState<TabKey>("cover");
  const [filter, setFilter] = useState<"all" | ActivityTag>("all");
  const s = comparison.summary;

  const rows = comparison.activities.filter((a) => filter === "all" || a.tags.includes(filter));

  const stats = [
    { label: "Finish slip", value: `${s.slipDays > 0 ? "+" : ""}${s.slipDays} d` },
    { label: "Activities added", value: String(s.added) },
    { label: "Activities dropped", value: String(s.removed) },
    { label: "Delayed", value: String(s.delayed) },
    { label: "Accelerated", value: String(s.accelerated) },
    { label: "Cost delta", value: fmtMoney(s.currentCost - s.originalCost) },
  ];

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4">
      <nav className="hidden w-56 shrink-0 overflow-hidden rounded-sm border border-border bg-primary text-primary-foreground lg:flex">
        <div className="weave-rail shrink-0 opacity-90" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <p className="mono-label mb-2 px-2 text-primary-foreground/60">Report sections</p>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-sm px-3 py-2 text-left font-mono text-sm transition-colors ${
              tab === t.key
                ? "bg-mustard text-ink"
                : "text-primary-foreground/80 hover:bg-primary-foreground/10"
            }`}
          >
            <span className="opacity-60">{t.index}</span> {t.label}
          </button>
        ))}
        <div className="weave-braid mt-auto" />
        </div>
      </nav>


      <section className="panel flex min-h-0 min-w-0 flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 lg:hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`mono-label rounded-sm border px-2 py-1 ${
                tab === t.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              }`}
            >
              {t.index}
            </button>
          ))}
        </div>

        <h2 className="font-mono text-lg font-bold">
          <span className="text-accent">{current.index}</span> {current.label}
        </h2>
        <div className="weave-chevron mt-2 opacity-70" />

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          {tab === "cover" ? (
            <div className="table-scroll min-h-0 flex-1 pr-1">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-sm border border-border p-4">
                  <p className="mono-label text-muted-foreground">Original / baseline</p>
                  <p className="mt-2 font-semibold">{comparison.original.projectName}</p>
                  <p className="font-mono text-sm text-muted-foreground">
                    Finish {fmtDate(s.originalFinish)} · {comparison.original.activities.size}{" "}
                    activities
                  </p>
                </div>
                <div className="rounded-sm border border-border p-4">
                  <p className="mono-label text-muted-foreground">Current / updated</p>
                  <p className="mt-2 font-semibold">{comparison.current.projectName}</p>
                  <p className="font-mono text-sm text-muted-foreground">
                    Finish {fmtDate(s.currentFinish)} · {comparison.current.activities.size}{" "}
                    activities
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {stats.map((st) => (
                  <div key={st.label} className="rounded-sm border border-border p-3">
                    <p className="mono-label text-muted-foreground">{st.label}</p>
                    <p className="mt-1 font-mono text-lg font-bold">{st.value}</p>
                  </div>
                ))}
              </div>
              <div className="weave-tibeb mt-5" />
            </div>
          ) : null}

          {tab === "movement" ? (
            <div className="table-scroll min-h-0 flex-1 space-y-3 pr-1">
              {comparison.activities
                .filter((a) => a.original && a.current && a.finishDelta !== 0)
                .slice(0, 40)
                .map((a) => {
                  const width = Math.min(100, Math.abs(a.finishDelta) * 2);
                  return (
                    <div
                      key={a.code}
                      className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4"
                    >
                      <div>
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <div className="mt-1 h-2 rounded-full bg-secondary">
                          <div
                            className={`h-2 rounded-full ${a.finishDelta > 0 ? "bg-destructive" : "bg-success"}`}
                            style={{ width: `${Math.max(4, width)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right">
                        <Delta value={a.finishDelta} />
                        <p className="font-mono text-xs text-muted-foreground">
                          {fmtDate(a.current?.finish ?? null)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              {comparison.activities.every((a) => a.finishDelta === 0) ? (
                <p className="font-mono text-sm text-muted-foreground">No date movement detected.</p>
              ) : null}
            </div>
          ) : null}

          {tab === "activities" ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`mono-label rounded-sm border px-3 py-1.5 transition-colors ${
                      filter === f.key
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-panel text-muted-foreground hover:border-accent"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                <Table
                  scroll
                  head={[
                    "Activity",
                    "WBS",
                    "Original dates",
                    "Current dates",
                    "Δ Finish",
                    "Δ Duration",
                    "Progress",
                    "Tags",
                  ]}
                  rows={rows.slice(0, 300).map((a) => [
                    <div key="a">
                      <p className="font-medium">{a.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{a.code}</p>
                    </div>,
                    <span className="text-muted-foreground">{a.wbs}</span>,
                    <span className="font-mono text-xs">
                      {a.original
                        ? `${fmtDate(a.original.start)} → ${fmtDate(a.original.finish)}`
                        : "—"}
                    </span>,
                    <span className="font-mono text-xs">
                      {a.current ? `${fmtDate(a.current.start)} → ${fmtDate(a.current.finish)}` : "—"}
                    </span>,
                    <Delta value={a.finishDelta} />,
                    <Delta value={a.durationDelta} />,
                    <span className="font-mono text-xs">
                      {a.original?.percent ?? 0}% → {a.current?.percent ?? 0}%
                    </span>,
                    <div className="flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <span key={t} className={`mono-label rounded-sm px-1.5 py-0.5 ${TAG_STYLES[t]}`}>
                          {t}
                        </span>
                      ))}
                    </div>,
                  ])}
                />
              </div>
            </>
          ) : null}

          {tab === "critical" ? (
            <div className="min-h-0 flex-1">
              <Table
                scroll
                head={["Activity", "WBS", "Original float", "Current float", "Change"]}
                rows={comparison.critical.map((c) => [
                  <div key="c">
                    <p className="font-medium">{c.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                  </div>,
                  <span className="text-muted-foreground">{c.wbs}</span>,
                  <span className="font-mono">{c.originalFloat}d</span>,
                  <span className="font-mono">{c.currentFloat}d</span>,
                  <span
                    className={`mono-label rounded-sm px-1.5 py-0.5 ${
                      c.change === "became critical"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-success/15 text-success"
                    }`}
                  >
                    {c.change}
                  </span>,
                ])}
              />
            </div>
          ) : null}

          {tab === "resources" ? (
            <div className="grid min-h-0 flex-1 grid-rows-2 gap-4">
              <div className="min-h-0">
                <Table
                  scroll
                  head={[
                    "Resource",
                    "Original cost",
                    "Current cost",
                    "Δ Cost",
                    "Original qty",
                    "Current qty",
                    "Status",
                  ]}
                  rows={comparison.resources.map((r) => [
                    <span className="font-medium">{r.name}</span>,
                    <span className="font-mono">{fmtMoney(r.originalCost)}</span>,
                    <span className="font-mono">{fmtMoney(r.currentCost)}</span>,
                    <Delta value={Math.round(r.currentCost - r.originalCost)} suffix="" />,
                    <span className="font-mono">{fmtMoney(r.originalQty)}</span>,
                    <span className="font-mono">{fmtMoney(r.currentQty)}</span>,
                    <span className="mono-label rounded-sm bg-secondary px-1.5 py-0.5">{r.status}</span>,
                  ])}
                />
              </div>
              <div className="min-h-0">
                <p className="mono-label mb-2 text-muted-foreground">
                  Per-activity resource assignment changes
                </p>
                <Table
                  scroll
                  head={["Activity", "Resource", "Change", "Δ Qty", "Δ Cost"]}
                  rows={comparison.assignments.slice(0, 200).map((a) => [
                    <span className="font-mono text-xs">{a.activity}</span>,
                    <span>{a.resource}</span>,
                    <span className="mono-label rounded-sm bg-secondary px-1.5 py-0.5">{a.change}</span>,
                    <Delta value={Math.round(a.qty)} suffix="" />,
                    <Delta value={Math.round(a.cost)} suffix="" />,
                  ])}
                />
              </div>
            </div>
          ) : null}

          {tab === "wbs" ? (
            <div className="min-h-0 flex-1">
              <Table
                scroll
                head={[
                  "WBS",
                  "Original budget",
                  "Current budget",
                  "Δ Budget",
                  "Original % complete",
                  "Current % complete",
                  "Δ Progress",
                ]}
                rows={comparison.wbs.map((w) => [
                  <span className="font-medium">{w.name}</span>,
                  <span className="font-mono">{fmtMoney(w.originalBudget)}</span>,
                  <span className="font-mono">{fmtMoney(w.currentBudget)}</span>,
                  <Delta value={Math.round(w.currentBudget - w.originalBudget)} suffix="" />,
                  <span className="font-mono">{Math.round(w.originalPercent)}%</span>,
                  <span className="font-mono">{Math.round(w.currentPercent)}%</span>,
                  <Delta value={Math.round(w.currentPercent - w.originalPercent)} suffix="%" />,
                ])}
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Index() {
  const [original, setOriginal] = useState<Loaded>(null);
  const [current, setCurrent] = useState<Loaded>(null);
  const [errors, setErrors] = useState<{ original?: string; current?: string }>({});

  const load = async (file: File, slot: "original" | "current") => {
    try {
      const text = await file.text();
      const snapshot = buildSnapshot(parseXer(text));
      if (!snapshot.activities.size) throw new Error("No activities found in this file.");
      const value = { name: file.name, snapshot };
      slot === "original" ? setOriginal(value) : setCurrent(value);
      setErrors((e) => ({ ...e, [slot]: undefined }));
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [slot]: err instanceof Error ? err.message : "Could not read this file.",
      }));
    }
  };

  const comparison = useMemo(
    () => (original && current ? compareSnapshots(original.snapshot, current.snapshot) : null),
    [original, current],
  );

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-panel">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="mono-label text-maroon">Planning Engineer Toolkit</p>
            <h1 className="font-mono text-xl font-bold tracking-tight sm:text-2xl">
              Schedule Comparison Dashboard
            </h1>
          </div>
          <BrandMark />
        </div>
        <div className="weave-truss opacity-80" />
      </header>

      <div className="shrink-0 px-4 pt-6 pb-4">
        <div className="grid gap-6 sm:grid-cols-2">
          <DropZone
            label="Original / Baseline"
            hint="Drop original .XER here"
            loaded={original}
            error={errors.original}
            onFile={(f) => load(f, "original")}
          />
          <DropZone
            label="Current / Updated"
            hint="Drop updated .XER here"
            loaded={current}
            error={errors.current}
            onFile={(f) => load(f, "current")}
          />
        </div>
      </div>

      {comparison ? (
        <Report comparison={comparison} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <div className="weave-braid w-64 opacity-80" />
          <p className="mono-label mt-4 text-muted-foreground">
            {original || current ? "Waiting for the second file..." : "Waiting for both files..."}
          </p>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Everything runs in your browser — no file ever leaves this device.
          </p>
        </div>
      )}

      <footer className="shrink-0 border-t border-border bg-primary px-4 py-3 text-center text-primary-foreground">
        <p className="font-mono text-xs tracking-[0.18em]">all tools are organized by Plaነer</p>
        <p className="mono-label mt-1 text-primary-foreground/70">
          © {new Date().getFullYear()} · All rights reserved by Biden
        </p>
      </footer>
    </main>
  );
}
