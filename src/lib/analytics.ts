import type { ActivityRow, Employee, NormalisedData } from "./normalize";

// Automation feasibility per canonical task category (0..1)
// Documented in README: repetitive digital tasks with clear rules score higher.
export const TASK_AUTOMATION_FACTOR: Record<string, number> = {
  "Email Triage": 0.55,
  "Calendar Management": 0.7,
  "Data Entry": 0.85,
  "Invoice Processing": 0.8,
  "Vendor Management": 0.5,
  "Vendor Portals": 0.6,
  "CRM Updates": 0.75,
  "Status Updates": 0.6,
  "Reporting": 0.65,
  "Lead Entry": 0.85,
  "Pipeline Review": 0.3,
  "Deck Building": 0.25,
  "Internal Communication": 0.15,
  "Client Communication": 0.1,
  "Meetings": 0.1,
  "Research": 0.2,
};

// Repetitive tasks not otherwise mapped: default 0.5. Non-repetitive: 0.1.
export const automationFactor = (task: string, isRepetitive: boolean): number => {
  const base = TASK_AUTOMATION_FACTOR[task];
  if (base != null) return isRepetitive ? base : base * 0.35;
  return isRepetitive ? 0.5 : 0.1;
};

export interface Filters {
  department: string | null;
  taskCategory: string | null;
  employeeId: string | null;
}

export const applyFilters = (rows: ActivityRow[], f: Filters): ActivityRow[] =>
  rows.filter((r) =>
    (!f.department || r.department === f.department) &&
    (!f.taskCategory || r.taskCategory === f.taskCategory) &&
    (!f.employeeId || r.employeeId === f.employeeId));

export interface Headline {
  recoverableMinutesPerMonth: number;
  recoverableINRPerMonth: number;
  totalMinutes: number;
  repetitiveMinutes: number;
  weeksCovered: number;
  perEmployee: { id: string; minutes: number; inr: number; hourlyINR: number | null }[];
}

// Convert an observed window (some # of weeks) to a per-month projection.
const WEEKS_PER_MONTH = 4.345;

export const computeHeadline = (data: NormalisedData, f: Filters): Headline => {
  const rows = applyFilters(data.activity, f);
  const weeks = new Set(rows.map((r) => r.weekIndex)).size || 1;
  const totalMinutes = rows.reduce((s, r) => s + r.durationMinutes, 0);
  const repetitiveMinutes = rows.filter((r) => r.isRepetitive).reduce((s, r) => s + r.durationMinutes, 0);

  // Per-employee recoverable
  const byEmp = new Map<string, { minutes: number; recoverableMinutes: number }>();
  for (const r of rows) {
    const factor = automationFactor(r.taskCategory, r.isRepetitive);
    const rec = r.durationMinutes * factor;
    const cur = byEmp.get(r.employeeId) ?? { minutes: 0, recoverableMinutes: 0 };
    cur.minutes += r.durationMinutes;
    cur.recoverableMinutes += rec;
    byEmp.set(r.employeeId, cur);
  }

  let recMinPerMonth = 0;
  let recINRPerMonth = 0;
  const perEmployee: Headline["perEmployee"] = [];
  for (const [id, agg] of byEmp) {
    const emp = data.employeeMap.get(id);
    const perMonthMin = (agg.recoverableMinutes / weeks) * WEEKS_PER_MONTH;
    const hourlyINR = emp?.hourlyINR ?? null;
    const inr = hourlyINR ? (perMonthMin / 60) * hourlyINR : 0;
    recMinPerMonth += perMonthMin;
    recINRPerMonth += inr;
    perEmployee.push({ id, minutes: agg.minutes, inr, hourlyINR });
  }

  return {
    recoverableMinutesPerMonth: recMinPerMonth,
    recoverableINRPerMonth: recINRPerMonth,
    totalMinutes,
    repetitiveMinutes,
    weeksCovered: weeks,
    perEmployee,
  };
};

export type Dimension = "taskCategory" | "app" | "department";

export interface BreakdownRow {
  key: string;
  totalMinutes: number;
  repetitiveMinutes: number;
  recoverableMinutes: number;
  recoverableINR: number;
  uniqueEmployees: number;
  employees: string[];
}

export const computeBreakdown = (
  data: NormalisedData,
  f: Filters,
  dim: Dimension,
): BreakdownRow[] => {
  const rows = applyFilters(data.activity, f);
  const weeks = new Set(rows.map((r) => r.weekIndex)).size || 1;
  const map = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const key = r[dim];
    const emp = data.employeeMap.get(r.employeeId);
    const factor = automationFactor(r.taskCategory, r.isRepetitive);
    const rec = r.durationMinutes * factor;
    const inr = emp?.hourlyINR ? (rec / 60) * emp.hourlyINR : 0;
    const cur = map.get(key) ?? {
      key,
      totalMinutes: 0,
      repetitiveMinutes: 0,
      recoverableMinutes: 0,
      recoverableINR: 0,
      uniqueEmployees: 0,
      employees: [] as string[],
    };
    cur.totalMinutes += r.durationMinutes;
    if (r.isRepetitive) cur.repetitiveMinutes += r.durationMinutes;
    cur.recoverableMinutes += rec;
    cur.recoverableINR += inr;
    if (!cur.employees.includes(r.employeeId)) cur.employees.push(r.employeeId);
    map.set(key, cur);
  }
  const out = Array.from(map.values()).map((b) => ({
    ...b,
    recoverableMinutes: (b.recoverableMinutes / weeks) * WEEKS_PER_MONTH,
    recoverableINR: (b.recoverableINR / weeks) * WEEKS_PER_MONTH,
    uniqueEmployees: b.employees.length,
  }));
  return out.sort((a, b) => b.totalMinutes - a.totalMinutes);
};

// Automation priority: weighted score of normalised volume, repetitiveness, concentration, INR impact.
export interface PriorityRow {
  taskCategory: string;
  score: number;
  volume: number;
  repetitiveShare: number;
  concentration: number;
  recoverableINRPerMonth: number;
  employees: string[];
  breakdown: { volume: number; repetitive: number; concentration: number; inr: number };
}

export const computePriority = (data: NormalisedData, f: Filters): PriorityRow[] => {
  const rows = applyFilters(data.activity, f);
  const weeks = new Set(rows.map((r) => r.weekIndex)).size || 1;
  const totalEmployees = new Set(rows.map((r) => r.employeeId)).size || 1;
  const perTask = new Map<string, { min: number; repMin: number; emps: Set<string>; inr: number }>();
  for (const r of rows) {
    const cur = perTask.get(r.taskCategory) ?? { min: 0, repMin: 0, emps: new Set<string>(), inr: 0 };
    cur.min += r.durationMinutes;
    if (r.isRepetitive) cur.repMin += r.durationMinutes;
    cur.emps.add(r.employeeId);
    const emp = data.employeeMap.get(r.employeeId);
    const factor = automationFactor(r.taskCategory, r.isRepetitive);
    cur.inr += emp?.hourlyINR ? (r.durationMinutes * factor / 60) * emp.hourlyINR : 0;
    perTask.set(r.taskCategory, cur);
  }
  const maxVol = Math.max(...Array.from(perTask.values()).map((v) => v.min), 1);
  const maxInr = Math.max(...Array.from(perTask.values()).map((v) => v.inr), 1);
  const out: PriorityRow[] = [];
  for (const [task, v] of perTask) {
    const vol = v.min / maxVol;
    const rep = v.min > 0 ? v.repMin / v.min : 0;
    const conc = v.emps.size / totalEmployees;
    const inrN = v.inr / maxInr;
    const score = 0.3 * vol + 0.3 * rep + 0.2 * conc + 0.2 * inrN;
    out.push({
      taskCategory: task,
      score,
      volume: v.min,
      repetitiveShare: rep,
      concentration: v.emps.size,
      recoverableINRPerMonth: (v.inr / weeks) * WEEKS_PER_MONTH,
      employees: Array.from(v.emps),
      breakdown: { volume: vol, repetitive: rep, concentration: conc, inr: inrN },
    });
  }
  return out.sort((a, b) => b.score - a.score);
};

export interface WeeklyPoint {
  week: string;
  weekIndex: number;
  [k: string]: number | string;
}

export const computeWeekly = (data: NormalisedData, f: Filters, topN = 5): { data: WeeklyPoint[]; keys: string[] } => {
  const rows = applyFilters(data.activity, f);
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.taskCategory, (totals.get(r.taskCategory) ?? 0) + r.durationMinutes);
  const keys = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k]) => k);
  const weekMap = new Map<number, WeeklyPoint>();
  for (const r of rows) {
    if (!keys.includes(r.taskCategory)) continue;
    const cur = weekMap.get(r.weekIndex) ?? ({ week: `W${r.weekIndex + 1}`, weekIndex: r.weekIndex } as WeeklyPoint);
    cur[r.taskCategory] = ((cur[r.taskCategory] as number) ?? 0) + r.durationMinutes;
    weekMap.set(r.weekIndex, cur);
  }
  const out = Array.from(weekMap.values()).sort((a, b) => a.weekIndex - b.weekIndex);
  for (const point of out) for (const k of keys) if (point[k] == null) point[k] = 0;
  return { data: out, keys };
};

export interface Anomaly {
  kind: "employee" | "task" | "day";
  label: string;
  detail: string;
  metric: string;
  value: number;
}

export const computeAnomalies = (data: NormalisedData, f: Filters): Anomaly[] => {
  const rows = applyFilters(data.activity, f);
  const anomalies: Anomaly[] = [];

  // Repetitive-share outliers per employee (z-score)
  const perEmp = new Map<string, { total: number; rep: number }>();
  for (const r of rows) {
    const cur = perEmp.get(r.employeeId) ?? { total: 0, rep: 0 };
    cur.total += r.durationMinutes;
    if (r.isRepetitive) cur.rep += r.durationMinutes;
    perEmp.set(r.employeeId, cur);
  }
  const shares = Array.from(perEmp.entries()).map(([id, v]) => ({ id, share: v.total ? v.rep / v.total : 0, total: v.total }));
  if (shares.length > 2) {
    const mean = shares.reduce((s, x) => s + x.share, 0) / shares.length;
    const sd = Math.sqrt(shares.reduce((s, x) => s + (x.share - mean) ** 2, 0) / shares.length) || 1;
    for (const s of shares) {
      const z = (s.share - mean) / sd;
      if (z > 1.5 && s.total > 60) {
        const emp = data.employeeMap.get(s.id);
        anomalies.push({
          kind: "employee",
          label: `${emp?.name ?? s.id} — ${emp?.department ?? ""}`,
          detail: `${Math.round(s.share * 100)}% of logged time is repetitive (org mean ${Math.round(mean * 100)}%, z=${z.toFixed(1)}).`,
          metric: "repetitive_share",
          value: s.share,
        });
      }
    }
  }

  // Terminated employees still with recent activity
  for (const emp of data.employees) {
    if (emp.status !== "terminated" || !emp.terminatedOn) continue;
    const cutoff = new Date(emp.terminatedOn + "T23:59:59+05:30").getTime();
    const after = rows.filter((r) => r.employeeId === emp.id && r.timestamp.getTime() > cutoff);
    if (after.length > 0) {
      anomalies.push({
        kind: "employee",
        label: `${emp.name} logged activity after termination`,
        detail: `${after.length} rows dated after ${emp.terminatedOn}.`,
        metric: "post_termination_rows",
        value: after.length,
      });
    }
  }

  // Task category with steepest week-over-week growth
  const wow = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (!wow.has(r.taskCategory)) wow.set(r.taskCategory, new Map());
    const m = wow.get(r.taskCategory)!;
    m.set(r.weekIndex, (m.get(r.weekIndex) ?? 0) + r.durationMinutes);
  }
  let steepest: { task: string; delta: number; last: number; prev: number } | null = null;
  for (const [task, m] of wow) {
    const weeks = Array.from(m.keys()).sort((a, b) => a - b);
    if (weeks.length < 2) continue;
    const last = m.get(weeks[weeks.length - 1]) ?? 0;
    const prev = m.get(weeks[weeks.length - 2]) ?? 0;
    if (prev < 30) continue;
    const delta = (last - prev) / prev;
    if (!steepest || delta > steepest.delta) steepest = { task, delta, last, prev };
  }
  if (steepest && steepest.delta > 0.3) {
    anomalies.push({
      kind: "task",
      label: `${steepest.task} spiked week-over-week`,
      detail: `+${Math.round(steepest.delta * 100)}% vs prior week (${steepest.prev}→${steepest.last} min).`,
      metric: "wow_delta",
      value: steepest.delta,
    });
  }

  return anomalies.slice(0, 5);
};

export const perEmployeeProfile = (data: NormalisedData, employeeId: string) => {
  const rows = data.activity.filter((r) => r.employeeId === employeeId);
  const emp = data.employeeMap.get(employeeId);
  const totalMin = rows.reduce((s, r) => s + r.durationMinutes, 0);
  const repMin = rows.filter((r) => r.isRepetitive).reduce((s, r) => s + r.durationMinutes, 0);
  const byTask = new Map<string, number>();
  for (const r of rows) if (r.isRepetitive) byTask.set(r.taskCategory, (byTask.get(r.taskCategory) ?? 0) + r.durationMinutes);
  const topRepetitive = Array.from(byTask.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Peer comparison: same role
  const peers = emp
    ? data.employees.filter((e) => e.role === emp.role && e.id !== emp.id).map((e) => e.id)
    : [];
  const peerRows = data.activity.filter((r) => peers.includes(r.employeeId));
  const peerMinPerHead = peers.length ? peerRows.reduce((s, r) => s + r.durationMinutes, 0) / peers.length : 0;
  const peerRepShare = peerRows.length
    ? peerRows.filter((r) => r.isRepetitive).reduce((s, r) => s + r.durationMinutes, 0) /
      Math.max(1, peerRows.reduce((s, r) => s + r.durationMinutes, 0))
    : 0;

  return {
    employee: emp,
    totalMinutes: totalMin,
    repetitiveShare: totalMin ? repMin / totalMin : 0,
    topRepetitive,
    peerMinutesAvg: peerMinPerHead,
    peerRepetitiveShare: peerRepShare,
  };
};

export const groundingSnapshot = (data: NormalisedData, f: Filters) => {
  try {
    console.log("[Grounding] Starting groundingSnapshot");
    console.log("[Grounding] Activity rows:", data.activity.length);
    console.log("[Grounding] Employees:", data.employees.length);
    console.log("[Grounding] Filters:", JSON.stringify(f));
    
    const headline = computeHeadline(data, f);
    console.log("[Grounding] Headline computed");
    
    const priority = computePriority(data, f).slice(0, 8);
    console.log("[Grounding] Priority computed, items:", priority.length);
    
    const breakdownTask = computeBreakdown(data, f, "taskCategory").slice(0, 8);
    console.log("[Grounding] Task breakdown computed, items:", breakdownTask.length);
    
    const breakdownApp = computeBreakdown(data, f, "app").slice(0, 8);
    console.log("[Grounding] App breakdown computed, items:", breakdownApp.length);
    
    const breakdownDept = computeBreakdown(data, f, "department");
    console.log("[Grounding] Dept breakdown computed, items:", breakdownDept.length);
    
    const anomalies = computeAnomalies(data, f);
    console.log("[Grounding] Anomalies computed, items:", anomalies.length);
    
    const employees = data.employees.map((e) => ({
      id: e.id, name: e.name, department: e.department, role: e.role,
      hourly_inr: e.hourlyINR, annual_inr: e.annualINR, tenure_months: e.tenureMonths,
      status: e.status, comp_source: e.compSource,
    }));
    console.log("[Grounding] Employee list mapped, count:", employees.length);

    // Per-employee activity breakdown
    console.log("[Grounding] Building per-employee activity breakdown");
    const rows = applyFilters(data.activity, f);
    console.log("[Grounding] Filtered rows:", rows.length);
    
    const weeks = new Set(rows.map((r) => r.weekIndex)).size || 1;
    console.log("[Grounding] Weeks covered:", weeks);
    
    const empActivityMap = new Map<string, { total: number; repetitive: number; byTask: Map<string, { total: number; repetitive: number }> }>();
    
    for (const r of rows) {
      if (!empActivityMap.has(r.employeeId)) {
        empActivityMap.set(r.employeeId, { total: 0, repetitive: 0, byTask: new Map() });
      }
      const empData = empActivityMap.get(r.employeeId)!;
      empData.total += r.durationMinutes;
      if (r.isRepetitive) empData.repetitive += r.durationMinutes;
      
      if (!empData.byTask.has(r.taskCategory)) {
        empData.byTask.set(r.taskCategory, { total: 0, repetitive: 0 });
      }
      const taskData = empData.byTask.get(r.taskCategory)!;
      taskData.total += r.durationMinutes;
      if (r.isRepetitive) taskData.repetitive += r.durationMinutes;
    }
    console.log("[Grounding] Employee activity map built, employees:", empActivityMap.size);

    console.log("[Grounding] Generating breakdown_by_employee array");
    const breakdown_by_employee = Array.from(empActivityMap.entries()).map(([empId, empData]) => {
      const emp = data.employeeMap.get(empId);
      const recoverableMinutes = Array.from(empData.byTask.entries()).reduce((sum, [task, taskData]) => {
        return sum + taskData.total * automationFactor(task, taskData.repetitive > 0);
      }, 0);
      const recoverableMinutesPerMonth = (recoverableMinutes / weeks) * WEEKS_PER_MONTH;
      const recoverableINRPerMonth = emp?.hourlyINR ? (recoverableMinutesPerMonth / 60) * emp.hourlyINR : 0;
      
      return {
        employee_id: empId,
        employee_name: emp?.name ?? empId,
        department: emp?.department ?? "Unknown",
        role: emp?.role ?? "Unknown",
        total_minutes_observed: empData.total,
        repetitive_minutes_observed: empData.repetitive,
        repetitive_share: empData.total > 0 ? +(empData.repetitive / empData.total).toFixed(2) : 0,
        recoverable_minutes_per_month: +recoverableMinutesPerMonth.toFixed(1),
        recoverable_inr_per_month: Math.round(recoverableINRPerMonth),
        hourly_rate_inr: emp?.hourlyINR ?? null,
        tasks: Array.from(empData.byTask.entries())
          .map(([task, taskData]) => ({
            task_category: task,
            total_minutes: taskData.total,
            repetitive_minutes: taskData.repetitive,
            automation_factor: automationFactor(task, taskData.repetitive > 0),
          }))
          .sort((a, b) => b.total_minutes - a.total_minutes),
      };
    }).sort((a, b) => b.total_minutes_observed - a.total_minutes_observed);
    console.log("[Grounding] breakdown_by_employee generated, count:", breakdown_by_employee.length);

    // Automation factors reference
    const automation_factors = Object.entries(TASK_AUTOMATION_FACTOR).map(([task, factor]) => ({
      task_category: task,
      automation_feasibility: factor,
    }));
    console.log("[Grounding] automation_factors generated, count:", automation_factors.length);

    // Filter context
    let filter_context = null;
    if (f.employeeId) {
      const emp = data.employeeMap.get(f.employeeId);
      filter_context = {
        type: "employee",
        employee_id: f.employeeId,
        employee_name: emp?.name ?? f.employeeId,
        department: emp?.department,
        role: emp?.role,
      };
    } else if (f.department) {
      filter_context = {
        type: "department",
        department: f.department,
      };
    } else if (f.taskCategory) {
      filter_context = {
        type: "task",
        task_category: f.taskCategory,
      };
    }
    console.log("[Grounding] filter_context:", filter_context ? filter_context.type : "null");
    
    console.log("[Grounding] Building final result object");
    const result = {
      filters: f,
      filter_context,
      date_range: data.quality.weekRange,
      weeks_covered: headline.weeksCovered,
      headline: {
        recoverable_hours_per_month: +(headline.recoverableMinutesPerMonth / 60).toFixed(1),
        recoverable_inr_per_month: Math.round(headline.recoverableINRPerMonth),
        total_minutes_observed: headline.totalMinutes,
        repetitive_minutes_observed: headline.repetitiveMinutes,
      },
      automation_priority: priority.map((p) => ({
        task: p.taskCategory,
        score: +p.score.toFixed(3),
        minutes_observed: p.volume,
        repetitive_share: +p.repetitiveShare.toFixed(2),
        unique_employees: p.concentration,
        recoverable_inr_per_month: Math.round(p.recoverableINRPerMonth),
        employees: p.employees,
      })),
      breakdown_by_task: breakdownTask.map((b) => ({ task: b.key, minutes: b.totalMinutes, repetitive_minutes: b.repetitiveMinutes, employees: b.uniqueEmployees })),
      breakdown_by_app: breakdownApp.map((b) => ({ app: b.key, minutes: b.totalMinutes, employees: b.uniqueEmployees })),
      breakdown_by_department: breakdownDept.map((b) => ({ department: b.key, minutes: b.totalMinutes, repetitive_minutes: b.repetitiveMinutes })),
      breakdown_by_employee,
      automation_factors,
      anomalies,
      employees,
      data_quality: data.quality,
    };
    
    console.log("[Grounding] groundingSnapshot completed successfully");
    return result;
    
  } catch (err) {
    console.error("[Grounding] FATAL: Exception in groundingSnapshot:");
    console.error("[Grounding] Error:", err);
    console.error("[Grounding] Stack:", (err as Error)?.stack);
    throw err;
  }
};
