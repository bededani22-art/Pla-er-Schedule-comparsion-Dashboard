// Minimal Primavera P6 .XER reader + schedule delta engine. Runs in the browser.

export type XerTable = { fields: string[]; rows: Record<string, string>[] };
export type XerFile = Record<string, XerTable>;

export function parseXer(text: string): XerFile {
  const out: XerFile = {};
  let current: XerTable | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine) continue;
    const cells = rawLine.split("\t");
    const tag = cells[0];
    if (tag === "%T") {
      current = { fields: [], rows: [] };
      out[cells[1] ?? ""] = current;
    } else if (tag === "%F" && current) {
      current.fields = cells.slice(1).map((f) => f.trim());
    } else if (tag === "%R" && current) {
      const values = cells.slice(1);
      const row: Record<string, string> = {};
      current.fields.forEach((f, i) => {
        row[f] = (values[i] ?? "").trim();
      });
      current.rows.push(row);
    }
  }
  return out;
}

const num = (v?: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const date = (v?: string): Date | null => {
  if (!v) return null;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const fmtDate = (d: Date | null) =>
  d ? d.toISOString().slice(0, 10) : "—";

export const fmtMoney = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export const dayDiff = (a: Date | null, b: Date | null) =>
  a && b ? Math.round((b.getTime() - a.getTime()) / 86400000) : 0;

export type Activity = {
  id: string;
  code: string;
  name: string;
  wbs: string;
  start: Date | null;
  finish: Date | null;
  durationDays: number;
  floatDays: number;
  percent: number;
};

export type ResourceLine = {
  name: string;
  cost: number;
  qty: number;
};

export type Snapshot = {
  projectName: string;
  dataDate: Date | null;
  activities: Map<string, Activity>;
  wbs: Map<string, { name: string; budget: number; percent: number; count: number }>;
  resources: Map<string, ResourceLine>;
  assignments: Map<string, { activity: string; resource: string; qty: number; cost: number }>;
};

export function buildSnapshot(xer: XerFile): Snapshot {
  const wbsNames = new Map<string, string>();
  for (const r of xer["PROJWBS"]?.rows ?? []) {
    wbsNames.set(r["wbs_id"] ?? "", r["wbs_short_name"] || r["wbs_name"] || "—");
  }

  const rsrcNames = new Map<string, string>();
  for (const r of xer["RSRC"]?.rows ?? []) {
    rsrcNames.set(r["rsrc_id"] ?? "", r["rsrc_name"] || r["rsrc_short_name"] || "—");
  }

  const activities = new Map<string, Activity>();
  const wbs = new Map<string, { name: string; budget: number; percent: number; count: number }>();

  for (const r of xer["TASK"]?.rows ?? []) {
    const code = r["task_code"] || r["task_id"] || "";
    const start = date(r["act_start_date"]) ?? date(r["early_start_date"]) ?? date(r["target_start_date"]);
    const finish = date(r["act_end_date"]) ?? date(r["early_end_date"]) ?? date(r["target_end_date"]);
    const wbsName = wbsNames.get(r["wbs_id"] ?? "") ?? "—";
    activities.set(code, {
      id: r["task_id"] ?? code,
      code,
      name: r["task_name"] || code,
      wbs: wbsName,
      start,
      finish,
      durationDays: Math.round(num(r["target_drtn_hr_cnt"]) / 8),
      floatDays: Math.round(num(r["total_float_hr_cnt"]) / 8),
      percent: num(r["phys_complete_pct"]),
    });
    const entry = wbs.get(wbsName) ?? { name: wbsName, budget: 0, percent: 0, count: 0 };
    entry.percent += num(r["phys_complete_pct"]);
    entry.count += 1;
    wbs.set(wbsName, entry);
  }

  const resources = new Map<string, ResourceLine>();
  const assignments = new Map<string, { activity: string; resource: string; qty: number; cost: number }>();
  const taskCodeById = new Map<string, string>();
  activities.forEach((a) => taskCodeById.set(a.id, a.code));

  for (const r of xer["TASKRSRC"]?.rows ?? []) {
    const rName = rsrcNames.get(r["rsrc_id"] ?? "") ?? r["rsrc_id"] ?? "—";
    const cost = num(r["target_cost"]);
    const qty = num(r["target_qty"]);
    const line = resources.get(rName) ?? { name: rName, cost: 0, qty: 0 };
    line.cost += cost;
    line.qty += qty;
    resources.set(rName, line);

    const actCode = taskCodeById.get(r["task_id"] ?? "") ?? r["task_id"] ?? "";
    assignments.set(`${actCode}|${rName}`, { activity: actCode, resource: rName, qty, cost });

    const act = activities.get(actCode);
    if (act) {
      const w = wbs.get(act.wbs);
      if (w) w.budget += cost;
    }
  }

  wbs.forEach((w) => {
    w.percent = w.count ? w.percent / w.count : 0;
  });

  const project = xer["PROJECT"]?.rows?.[0];
  return {
    projectName: project?.["proj_short_name"] || "Untitled project",
    dataDate: date(project?.["last_recalc_date"]),
    activities,
    wbs,
    resources,
    assignments,
  };
}

export type ActivityTag =
  | "added"
  | "removed"
  | "delayed"
  | "accelerated"
  | "duration"
  | "progress";

export type ActivityDelta = {
  code: string;
  name: string;
  wbs: string;
  original: Activity | null;
  current: Activity | null;
  finishDelta: number;
  durationDelta: number;
  progressDelta: number;
  tags: ActivityTag[];
};

export type CriticalDelta = {
  code: string;
  name: string;
  wbs: string;
  originalFloat: number;
  currentFloat: number;
  change: "became critical" | "no longer critical";
};

export type ResourceDelta = {
  name: string;
  originalCost: number;
  currentCost: number;
  originalQty: number;
  currentQty: number;
  status: "added" | "removed" | "increased" | "decreased" | "unchanged";
};

export type Comparison = ReturnType<typeof compareSnapshots>;

export function compareSnapshots(original: Snapshot, current: Snapshot) {
  const codes = new Set([...original.activities.keys(), ...current.activities.keys()]);
  const activities: ActivityDelta[] = [];

  for (const code of codes) {
    const o = original.activities.get(code) ?? null;
    const c = current.activities.get(code) ?? null;
    const tags: ActivityTag[] = [];
    const finishDelta = o && c ? dayDiff(o.finish, c.finish) : 0;
    const durationDelta = o && c ? c.durationDays - o.durationDays : 0;
    const progressDelta = o && c ? c.percent - o.percent : 0;

    if (!o) tags.push("added");
    if (!c) tags.push("removed");
    if (finishDelta > 0) tags.push("delayed");
    if (finishDelta < 0) tags.push("accelerated");
    if (durationDelta !== 0) tags.push("duration");
    if (progressDelta > 0) tags.push("progress");

    activities.push({
      code,
      name: (c ?? o)!.name,
      wbs: (c ?? o)!.wbs,
      original: o,
      current: c,
      finishDelta,
      durationDelta,
      progressDelta,
      tags,
    });
  }

  activities.sort((a, b) => Math.abs(b.finishDelta) - Math.abs(a.finishDelta));

  const critical: CriticalDelta[] = [];
  for (const code of codes) {
    const o = original.activities.get(code);
    const c = current.activities.get(code);
    if (!o || !c) continue;
    const wasCritical = o.floatDays <= 0;
    const isCritical = c.floatDays <= 0;
    if (wasCritical !== isCritical) {
      critical.push({
        code,
        name: c.name,
        wbs: c.wbs,
        originalFloat: o.floatDays,
        currentFloat: c.floatDays,
        change: isCritical ? "became critical" : "no longer critical",
      });
    }
  }
  critical.sort((a, b) => a.currentFloat - b.currentFloat);

  const resourceNames = new Set([...original.resources.keys(), ...current.resources.keys()]);
  const resources: ResourceDelta[] = [];
  for (const name of resourceNames) {
    const o = original.resources.get(name);
    const c = current.resources.get(name);
    const originalCost = o?.cost ?? 0;
    const currentCost = c?.cost ?? 0;
    let status: ResourceDelta["status"] = "unchanged";
    if (!o) status = "added";
    else if (!c) status = "removed";
    else if (currentCost > originalCost) status = "increased";
    else if (currentCost < originalCost) status = "decreased";
    resources.push({
      name,
      originalCost,
      currentCost,
      originalQty: o?.qty ?? 0,
      currentQty: c?.qty ?? 0,
      status,
    });
  }
  resources.sort((a, b) => Math.abs(b.currentCost - b.originalCost) - Math.abs(a.currentCost - a.originalCost));

  const assignmentKeys = new Set([...original.assignments.keys(), ...current.assignments.keys()]);
  const assignments = [] as {
    activity: string;
    resource: string;
    change: "added" | "removed" | "changed";
    qty: number;
    cost: number;
  }[];
  for (const key of assignmentKeys) {
    const o = original.assignments.get(key);
    const c = current.assignments.get(key);
    if (o && c) {
      if (o.qty === c.qty && o.cost === c.cost) continue;
      assignments.push({
        activity: c.activity,
        resource: c.resource,
        change: "changed",
        qty: c.qty - o.qty,
        cost: c.cost - o.cost,
      });
    } else if (c) {
      assignments.push({ activity: c.activity, resource: c.resource, change: "added", qty: c.qty, cost: c.cost });
    } else if (o) {
      assignments.push({ activity: o.activity, resource: o.resource, change: "removed", qty: -o.qty, cost: -o.cost });
    }
  }
  assignments.sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));

  const wbsNames = new Set([...original.wbs.keys(), ...current.wbs.keys()]);
  const wbs = [...wbsNames].map((name) => {
    const o = original.wbs.get(name);
    const c = current.wbs.get(name);
    return {
      name,
      originalBudget: o?.budget ?? 0,
      currentBudget: c?.budget ?? 0,
      originalPercent: o?.percent ?? 0,
      currentPercent: c?.percent ?? 0,
    };
  });
  wbs.sort((a, b) => a.name.localeCompare(b.name));

  const finishes = (s: Snapshot) =>
    [...s.activities.values()].map((a) => a.finish).filter(Boolean) as Date[];
  const maxDate = (ds: Date[]) => (ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null);
  const originalFinish = maxDate(finishes(original));
  const currentFinish = maxDate(finishes(current));

  return {
    original,
    current,
    activities,
    critical,
    resources,
    assignments,
    wbs,
    summary: {
      added: activities.filter((a) => a.tags.includes("added")).length,
      removed: activities.filter((a) => a.tags.includes("removed")).length,
      delayed: activities.filter((a) => a.tags.includes("delayed")).length,
      accelerated: activities.filter((a) => a.tags.includes("accelerated")).length,
      originalFinish,
      currentFinish,
      slipDays: dayDiff(originalFinish, currentFinish),
      originalCost: [...original.resources.values()].reduce((s, r) => s + r.cost, 0),
      currentCost: [...current.resources.values()].reduce((s, r) => s + r.cost, 0),
    },
  };
}
