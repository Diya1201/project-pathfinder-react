import Papa from "papaparse";

export interface Employee {
  id: string;
  name: string;
  department: string;
  role: string;
  annualINR: number | null;
  hourlyINR: number | null;
  tenureMonths: number | null;
  workingHours: string | null;
  status: "active" | "terminated";
  terminatedOn?: string;
  compSource: "annual_ctc_inr" | "salary_LPA" | "hourly_rate_inr" | "meta.annual" | "none";
  notes: string[];
}

export interface ActivityRow {
  employeeId: string;
  department: string;
  timestamp: Date;
  weekIndex: number;
  app: string;
  taskCategory: string;
  durationMinutes: number;
  isRepetitive: boolean;
}

export interface DataQuality {
  activityRaw: number;
  activityKept: number;
  activityDropped: { negativeOrZero: number; tooLarge: number; badTimestamp: number; missingFields: number; duplicates: number };
  activityFixed: { appsCanonicalised: number; tasksCanonicalised: number; booleansNormalised: number };
  employeesRaw: number;
  employeesKept: number;
  duplicateIds: string[];
  employeesWithoutActivity: string[];
  activityIdsWithoutEmployee: string[];
  compensationConflicts: { id: string; chosen: number; alternates: number[]; strategy: string }[];
  weekRange: { start: string; end: string; weeks: string[] };
}

// ---------- Canonicalisation maps ----------
const APP_MAP: Record<string, string> = {
  gmail: "Gmail",
  "google mail": "Gmail",
  outlook: "Outlook",
  "ms outlook": "Outlook",
  "microsoft outlook": "Outlook",
  slack: "Slack",
  excel: "Excel",
  "ms excel": "Excel",
  "microsoft excel": "Excel",
  word: "Word",
  "ms word": "Word",
  "microsoft word": "Word",
  powerpoint: "PowerPoint",
  "ms powerpoint": "PowerPoint",
  "microsoft powerpoint": "PowerPoint",
  chrome: "Chrome",
  "google chrome": "Chrome",
  sap: "SAP",
  "zoho crm": "Zoho CRM",
  zoho: "Zoho CRM",
  salesforce: "Salesforce",
  sfdc: "Salesforce",
  zoom: "Zoom",
  teams: "Teams",
  "ms teams": "Teams",
};

const TASK_MAP: Record<string, string> = {
  "cal mgmt": "Calendar Management",
  "calendar mgmt": "Calendar Management",
  "calendar management": "Calendar Management",
  "vendor mgmt": "Vendor Management",
  "vendor management": "Vendor Management",
  "vendor portals": "Vendor Portals",
  "invoice proc": "Invoice Processing",
  "invoice processing": "Invoice Processing",
  "email triage": "Email Triage",
  "crm updates": "CRM Updates",
  "status updates": "Status Updates",
  "data entry": "Data Entry",
  "data-entry": "Data Entry",
  reporting: "Reporting",
  "internal communication": "Internal Communication",
  "internal comms": "Internal Communication",
  "client communication": "Client Communication",
  "client comms": "Client Communication",
  meetings: "Meetings",
  research: "Research",
  "lead entry": "Lead Entry",
  "lead-entry": "Lead Entry",
  "pipeline review": "Pipeline Review",
  "deck building": "Deck Building",
};

const canonApp = (raw: string): string => {
  const key = (raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  return APP_MAP[key] ?? (raw || "").trim().replace(/\s+/g, " ") || "Unknown";
};
const canonTask = (raw: string): string => {
  const key = (raw || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!key) return "Uncategorized";
  return TASK_MAP[key] ?? key.replace(/\b\w/g, (c) => c.toUpperCase());
};

const BOOL_TRUE = new Set(["true", "1", "yes", "y", "t"]);
const BOOL_FALSE = new Set(["false", "0", "no", "n", "f", "", "na", "n/a", "null"]);
const parseBool = (raw: unknown): { value: boolean; wasNormalised: boolean } => {
  const s = String(raw ?? "").trim().toLowerCase();
  const rawExact = s === "true" || s === "false";
  if (BOOL_TRUE.has(s)) return { value: true, wasNormalised: !rawExact };
  if (BOOL_FALSE.has(s)) return { value: false, wasNormalised: !rawExact };
  return { value: false, wasNormalised: true };
};

// Parse assorted timestamp formats, assume IST if no zone.
const parseTimestamp = (raw: string): Date | null => {
  if (!raw) return null;
  const s = raw.trim();
  // slash-style dd/mm/yyyy HH:MM
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (slash) {
    const [, dd, mm, yyyy, h, m, sec] = slash;
    return new Date(`${yyyy}-${mm}-${dd}T${h.padStart(2, "0")}:${m}:${sec ?? "00"}+05:30`);
  }
  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (iso) {
    const [, y, mo, d, h, mi, se] = iso;
    return new Date(`${y}-${mo}-${d}T${h.padStart(2, "0")}:${mi}:${se ?? "00"}+05:30`);
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback;
};

const isoWeekStart = (d: Date): Date => {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday
  const w = new Date(d);
  w.setUTCDate(d.getUTCDate() - diff);
  w.setUTCHours(0, 0, 0, 0);
  return w;
};

// ---------- Employees ----------
type RawEmp = Record<string, unknown>;

const pick = (o: RawEmp, keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
};

const normaliseWorkingHours = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object") {
    const w = v as { start?: string; end?: string };
    if (w.start && w.end) return `${w.start}-${w.end}`;
  }
  return null;
};

const ANNUAL_HOURS = 2080; // 40h * 52w, documented in README

const readOneEmployee = (r: RawEmp): Omit<Employee, "notes" | "compSource"> & { candidates: { annualINR: number; source: Employee["compSource"] }[]; workingHoursRaw: unknown } => {
  const id = String(pick(r, ["employee_id", "EmployeeID", "employeeId", "id"]) ?? "").trim();
  const meta = (r.meta ?? {}) as RawEmp;
  const comp = (meta.compensation ?? {}) as RawEmp;

  const name = String(pick(r, ["name", "Name"]) ?? id);
  const dept = String(pick(r, ["department", "Dept", "dept"]) ?? "").trim();
  const role = String(pick(r, ["role", "Role"]) ?? (meta.role as string) ?? "").trim();
  const tenureRaw = pick(r, ["tenure_months", "tenureMonths"]) ?? meta.tenure_months;
  const workingHoursRaw = pick(r, ["working_hours", "workingHours"]) ?? meta.working_hours;
  const status = (String(pick(r, ["status", "Status"]) ?? "active").toLowerCase() === "terminated"
    ? "terminated"
    : "active") as Employee["status"];
  const terminatedOn = r.terminated_on as string | undefined;

  const candidates: { annualINR: number; source: Employee["compSource"] }[] = [];
  const annual = pick(r, ["annual_ctc_inr", "annualCTC"]);
  if (typeof annual === "number") candidates.push({ annualINR: annual, source: "annual_ctc_inr" });
  const lpa = pick(r, ["salary_LPA", "salaryLPA"]);
  if (typeof lpa === "number") candidates.push({ annualINR: lpa * 100000, source: "salary_LPA" });
  const hourly = pick(r, ["hourly_rate_inr", "hourlyRate"]);
  if (typeof hourly === "number") candidates.push({ annualINR: hourly * ANNUAL_HOURS, source: "hourly_rate_inr" });
  const metaAnnual = comp.annual;
  if (typeof metaAnnual === "number") candidates.push({ annualINR: metaAnnual, source: "meta.annual" });

  return {
    id,
    name,
    department: dept || "Unknown",
    role: role || "Unknown",
    annualINR: null,
    hourlyINR: null,
    tenureMonths: typeof tenureRaw === "number" ? tenureRaw : null,
    workingHours: normaliseWorkingHours(workingHoursRaw),
    status,
    terminatedOn,
    candidates,
    workingHoursRaw,
  };
};

export interface NormalisedData {
  employees: Employee[];
  employeeMap: Map<string, Employee>;
  activity: ActivityRow[];
  quality: DataQuality;
  meta: { generatedAt?: string; source?: string };
}

export const normaliseAll = (employeesJson: any, csvText: string): NormalisedData => {
  const raw = (employeesJson.employees ?? employeesJson.data?.employees ?? []) as RawEmp[];
  const parsed = raw.map(readOneEmployee);

  // Group by id to reconcile duplicates
  const byId = new Map<string, ReturnType<typeof readOneEmployee>[]>();
  for (const p of parsed) {
    if (!p.id) continue;
    const arr = byId.get(p.id) ?? [];
    arr.push(p);
    byId.set(p.id, arr);
  }

  const employees: Employee[] = [];
  const duplicateIds: string[] = [];
  const compensationConflicts: DataQuality["compensationConflicts"] = [];

  for (const [id, records] of byId) {
    const notes: string[] = [];
    if (records.length > 1) {
      duplicateIds.push(id);
      notes.push(`Duplicate HRMS record (${records.length}× entries). Kept highest annual comp; higher tenure as tiebreak.`);
    }

    // Merge candidate compensation across duplicates
    const allCandidates = records.flatMap((r) => r.candidates);
    let chosen: { annualINR: number; source: Employee["compSource"] } | null = null;
    if (allCandidates.length > 0) {
      chosen = allCandidates.reduce((a, b) => (b.annualINR > a.annualINR ? b : a));
      if (allCandidates.length > 1) {
        compensationConflicts.push({
          id,
          chosen: Math.round(chosen.annualINR),
          alternates: allCandidates.map((c) => Math.round(c.annualINR)),
          strategy: "highest annual-INR-equivalent across sources / duplicate records",
        });
      }
    }

    // Prefer the record with highest tenure to source name/dept/role/wh
    const primary = [...records].sort(
      (a, b) => (b.tenureMonths ?? -1) - (a.tenureMonths ?? -1),
    )[0];

    const annualINR = chosen?.annualINR ?? null;
    employees.push({
      id,
      name: primary.name,
      department: primary.department,
      role: primary.role,
      annualINR: annualINR ? Math.round(annualINR) : null,
      hourlyINR: annualINR ? Math.round(annualINR / ANNUAL_HOURS) : null,
      tenureMonths: primary.tenureMonths,
      workingHours: primary.workingHours,
      status: primary.status,
      terminatedOn: primary.terminatedOn,
      compSource: chosen?.source ?? "none",
      notes,
    });
  }

  const employeeMap = new Map(employees.map((e) => [e.id, e]));

  // ---------- Activity CSV ----------
  const parsedCsv = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const rowsRaw = parsedCsv.data;
  const dropped = { negativeOrZero: 0, tooLarge: 0, badTimestamp: 0, missingFields: 0, duplicates: 0 };
  const fixed = { appsCanonicalised: 0, tasksCanonicalised: 0, booleansNormalised: 0 };
  const kept: ActivityRow[] = [];
  const dedup = new Set<string>();

  for (const r of rowsRaw) {
    const employeeId = (r.employee_id ?? "").trim();
    const department = (r.department ?? "").trim();
    const ts = parseTimestamp(r.timestamp);
    const rawApp = r.app_used ?? "";
    const rawTask = r.task_category ?? "";
    const app = canonApp(rawApp);
    if (app !== rawApp.trim()) fixed.appsCanonicalised++;
    const task = canonTask(rawTask);
    if (task !== rawTask.trim()) fixed.tasksCanonicalised++;
    const bool = parseBool(r.is_repetitive);
    if (bool.wasNormalised) fixed.booleansNormalised++;

    if (!employeeId || !ts) {
      if (!ts) dropped.badTimestamp++;
      else dropped.missingFields++;
      continue;
    }
    const dur = Number(r.duration_minutes);
    if (!Number.isFinite(dur) || dur <= 0) { dropped.negativeOrZero++; continue; }
    if (dur > 480) { dropped.tooLarge++; continue; }

    const key = `${employeeId}|${ts.toISOString()}|${app}|${task}|${dur}`;
    if (dedup.has(key)) { dropped.duplicates++; continue; }
    dedup.add(key);

    kept.push({
      employeeId,
      department: department || employeeMap.get(employeeId)?.department || "Unknown",
      timestamp: ts,
      weekIndex: 0,
      app,
      taskCategory: task,
      durationMinutes: dur,
      isRepetitive: bool.value,
    });
  }

  // Week indexing
  if (kept.length > 0) {
    const minTs = new Date(Math.min(...kept.map((r) => r.timestamp.getTime())));
    const anchor = isoWeekStart(minTs);
    for (const row of kept) {
      const w = isoWeekStart(row.timestamp);
      row.weekIndex = Math.floor((w.getTime() - anchor.getTime()) / (7 * 24 * 3600 * 1000));
    }
  }
  const weeks = Array.from(new Set(kept.map((r) => r.weekIndex))).sort((a, b) => a - b);
  const minDate = kept.length ? new Date(Math.min(...kept.map((r) => r.timestamp.getTime()))) : new Date();
  const maxDate = kept.length ? new Date(Math.max(...kept.map((r) => r.timestamp.getTime()))) : new Date();

  const activityIds = new Set(kept.map((r) => r.employeeId));
  const empIds = new Set(employees.map((e) => e.id));
  const employeesWithoutActivity = employees.filter((e) => !activityIds.has(e.id)).map((e) => e.id);
  const activityIdsWithoutEmployee = Array.from(activityIds).filter((id) => !empIds.has(id));

  const quality: DataQuality = {
    activityRaw: rowsRaw.length,
    activityKept: kept.length,
    activityDropped: dropped,
    activityFixed: fixed,
    employeesRaw: raw.length,
    employeesKept: employees.length,
    duplicateIds,
    employeesWithoutActivity,
    activityIdsWithoutEmployee,
    compensationConflicts,
    weekRange: {
      start: minDate.toISOString().slice(0, 10),
      end: maxDate.toISOString().slice(0, 10),
      weeks: weeks.map((w) => `W${w + 1}`),
    },
  };

  return {
    employees,
    employeeMap,
    activity: kept,
    quality,
    meta: {
      generatedAt: employeesJson.generated_at,
      source: employeesJson.source_system,
    },
  };
};

export const fmtINR = (n: number): string => {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};

export const fmtHours = (min: number): string => {
  const h = min / 60;
  if (h >= 100) return `${Math.round(h)} h`;
  return `${h.toFixed(1)} h`;
};
