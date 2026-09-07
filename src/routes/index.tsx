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
  error?: string;
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
      className={`relative rounded-md border-2 border-dashed p-8 text-center transition-colors ${
        over ? "border-accent bg-accent/5" : "border-border bg-panel"
      }`}
    >
      <span className="mono-label absolute -top-3 left-6 rounded-sm bg-primary px-2 py-1 text-primary-foreground">
        {label}
      </span>
      {loaded ? (
        <div className="py-2">
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

function Section({
  index,
  title,
  subtitle,
  children,
}: {
  index: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-6">
      <h2 className="font-mono text-lg font-bold">
        <span className="text-accent">{index}</span> {title}
      </h2>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) {
    return <p className="font-mono text-sm text-muted-foreground">No entries in this category.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th key={h} className="mono-label px-3 py-2 text-left text-muted-foreground">
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
    </div>
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

function Report({ comparison }: { comparison: Comparison }) {
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

  return (
    <div className="mx-auto mt-14 max-w-6xl space-y-6 px-4 pb-24">
      <header className="panel p-6">
        <h2 className="font-mono text-2xl font-bold">Schedule Comparison</h2>
        <p className="mono-label mt-2 text-muted-foreground">
          Generated — {new Date().toISOString().slice(0, 10)}
        </p>
      </header>

      <Section index="00" title="Cover Sheet">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-sm border border-border p-4">
            <p className="mono-label text-muted-foreground">Original / baseline</p>
            <p className="mt-2 font-semibold">{comparison.original.projectName}</p>
            <p className="font-mono text-sm text-muted-foreground">
              Finish {fmtDate(s.originalFinish)} · {comparison.original.activities.size} activities
            </p>
          </div>
          <div className="rounded-sm border border-border p-4">
            <p className="mono-label text-muted-foreground">Current / updated</p>
            <p className="mt-2 font-semibold">{comparison.current.projectName}</p>
            <p className="font-mono text-sm text-muted-foreground">
              Finish {fmtDate(s.currentFinish)} · {comparison.current.activities.size} activities
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((st) => (
            <div key={st.label} className="rounded-sm border border-border p-3">
              <p className="mono-label text-muted-foreground">{st.label}</p>
              <p className="mt-1 font-mono text-lg font-bold">{st.value}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        index="01"
        title="Schedule Movement"
        subtitle="Baseline vs current finish dates for the most-moved activities, on a shared timeline."
      >
        <div className="space-y-3">
          {comparison.activities
            .filter((a) => a.original && a.current && a.finishDelta !== 0)
            .slice(0, 12)
            .map((a) => {
              const width = Math.min(100, Math.abs(a.finishDelta) * 2);
              return (
                <div key={a.code} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4">
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
      </Section>

      <Section index="02" title="Activity Changes">
        <div className="mb-4 flex flex-wrap gap-2">
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
        <Table
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
              {a.original ? `${fmtDate(a.original.start)} → ${fmtDate(a.original.finish)}` : "—"}
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
      </Section>

      <Section
        index="03"
        title="Critical Path Shift"
        subtitle="Activities whose critical status changed between the two versions."
      >
        <Table
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
      </Section>

      <Section
        index="04"
        title="Resource Changes"
        subtitle="Portfolio-level resource loading — new resources, dropped resources, and cost/quantity deltas."
      >
        <Table
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

        <h3 className="mono-label mt-8 mb-3 text-muted-foreground">
          Per-activity resource assignment changes
        </h3>
        <Table
          head={["Activity", "Resource", "Change", "Δ Qty", "Δ Cost"]}
          rows={comparison.assignments.slice(0, 200).map((a) => [
            <span className="font-mono text-xs">{a.activity}</span>,
            <span>{a.resource}</span>,
            <span className="mono-label rounded-sm bg-secondary px-1.5 py-0.5">{a.change}</span>,
            <Delta value={Math.round(a.qty)} suffix="" />,
            <Delta value={Math.round(a.cost)} suffix="" />,
          ])}
        />
      </Section>

      <Section index="05" title="WBS Comparison">
        <Table
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
      </Section>
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
    <main className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 pt-16 text-center">
        <p className="mono-label text-accent">Planning Engineer Toolkit</p>
        <h1 className="mt-3 font-mono text-4xl font-bold tracking-tight sm:text-5xl">
          Schedule Comparison Dashboard
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Upload your original (baseline) and current (updated) Primavera P6 XER files. Get a full
          delta review — what moved, what was added or dropped, how the critical path shifted, and
          how resources changed between the two versions. Runs entirely in your browser; nothing is
          uploaded anywhere.
        </p>
        <p className="mono-label mt-5 text-muted-foreground">
          all tools are organized by Plaነer
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-6 px-4 sm:grid-cols-2">
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

      {comparison ? (
        <Report comparison={comparison} />
      ) : (
        <p className="mono-label mt-8 pb-24 text-center text-muted-foreground">
          {original || current ? "Waiting for the second file..." : "Waiting for both files..."}
        </p>
      )}
    </main>
  );
}
