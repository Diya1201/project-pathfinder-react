# Workforce Pulse

A one-page executive analytics app that answers the COO's question — *where are we wasting the most time and money, and what should we automate first?* — from two intentionally messy files: `activity_logs.csv` (~540 rows) and `employees.json` (HRMS export).

Stack: React 19 + TanStack Start (Vite), Recharts, jsPDF, Lovable AI Gateway (Gemini 2.5 Flash). Data is loaded, normalised and joined **entirely on the client**; the server function exists only to broker the LLM call. Live URL is served by Lovable.

## Assumptions

**activity_logs.csv**
- Timestamps: ISO (`2025-10-14 11:23:00`, `2025-10-17T13:21:23`) and slash (`21/10/2025 14:44`) formats are both parsed. Everything is anchored to **Asia/Kolkata (IST)**; slash-format dates were assumed to be `dd/mm/yyyy` (Indian company).
- `duration_minutes`: keep `1..480`. Drop negatives/zero/blank (`negativeOrZero`) and > 8 h (`tooLarge`). Never impute.
- `is_repetitive`: `true / 1 / yes / y / t` → true; `false / 0 / no / n / f / na / n/a / null / ""` → false. Anything else defaults to false and is counted as normalised.
- `app_used` and `task_category` are lowercased, whitespace-collapsed, and mapped through a canonical dictionary (Gmail, Outlook, Excel, SAP, Salesforce (incl. `SFDC`), Zoho CRM, Chrome, Slack, Zoom, Word, PowerPoint, Teams; Email Triage, Data Entry, Invoice Processing, Calendar Management, Vendor Management, CRM Updates, Status Updates, Reporting, Meetings, Internal/Client Communication, Research, Lead Entry, Pipeline Review, Deck Building, Vendor Portals). Unmapped values are Title-Cased; unmapped is not made up.
- Deduplication key: `employee_id | timestamp | app | task | duration`.

**employees.json**
- Records live under `.employees` (the brief mentions `data.employees`; both shapes are handled).
- ID keys: `employee_id` and `EmployeeID`. Dept keys: `department`, `Dept`. Nested `meta.role`, `meta.compensation.annual`, `meta.tenure_months`, `meta.working_hours` are all read.
- Compensation is reconciled to a single canonical **annual INR** figure by converting:
  - `annual_ctc_inr` → itself
  - `salary_LPA` → × 100 000
  - `hourly_rate_inr` → × **2 080** (40 h × 52 wk, documented US-style annualisation used because working-hours strings are inconsistent and only some employees have real schedules)
  - `meta.compensation.annual` → itself
- **Hourly INR** for the rupee headline = canonical annual ÷ 2 080. Employees without any comp field are counted in activity totals but contribute **₹0** to the rupee headline (never guessed).
- `working_hours`: strings (`"9-18"`, `"9:30-18:30"`) and objects `{start,end,timezone}` are both flattened to `"HH:MM-HH:MM"`. `null` stays null.

## Join strategy & special cases

| ID | Situation | Handling |
|---|---|---|
| E007 | Duplicate HRMS record (28 mo @ ₹24 L vs 40 mo @ 14 LPA = ₹14 L) | Kept the record with the **highest annual-INR-equivalent**, tenure as tiebreak. Alternates shown in the Data Quality drawer's Compensation conflicts panel. |
| E013 | Appears in activity, missing from HRMS | Retained in activity charts + people table (labelled `orphan`). Contributes ₹0 to the rupee headline because we refuse to invent a rate. |
| E099 | In HRMS, never appears in activity | Kept on roster (visible in Data Quality drawer). Does not appear in any activity chart. |
| E010 | `status = terminated`, `terminated_on = 2025-10-22` | Kept. If any activity row is dated after termination, it surfaces in the Anomaly panel. |

Numbers of dropped / fixed / flagged rows and the three special-case ID lists are all visible in the **Data quality** drawer in the app.

## Formulas

**Recoverable minutes** per row:
```
recoverable = duration_minutes × automationFactor(task, is_repetitive)
```
`automationFactor` is a documented lookup in `src/lib/analytics.ts`. Rules-based digital tasks (Data Entry, Lead Entry, Invoice Processing, CRM Updates) score 0.75–0.85; judgment-heavy tasks (Meetings, Client Communication) score 0.10–0.15. For a repetitive task not in the table the factor is 0.5; non-repetitive drops to `factor × 0.35`. The factor is the honest half of the "× 0.6" hand-wave the brief calls out — it says *this specific category* is X% automatable, not "60% of all repetitive time evaporates".

**Per-month projection** — the observed window is 4 weeks, but filters can shrink it, so:
```
per_month = (Σ recoverable in filtered window / weeks_observed) × 4.345
```

**Rupee headline**:
```
inr_per_month = Σ over employees ( per_month_hours × hourly_INR )
```
Employees without a hourly rate contribute ₹0. The card shows the priced-vs-total employee ratio to make this visible.

**Automation priority score** (per task category, normalised across the visible slice):
```
score = 0.30 × volume_norm      // how much time this task eats
      + 0.30 × repetitive_share // how mechanical it is
      + 0.20 × concentration    // how many people would benefit (easier to automate a widely-shared task than an idiosyncratic one)
      + 0.20 × inr_norm         // rupee impact if we automated it
```
All four inputs are min-max scaled inside the current filter slice, so the ranking is meaningful even after cross-filtering.

## Anomaly detection

Three independent heuristics — anything they surface is shown as an anomaly card:

1. **Repetitive-share z-score** per employee: individuals whose repetitive share is > 1.5 σ above the org mean *and* who have > 1 h of activity are flagged.
2. **Post-termination activity**: any activity row timestamped after an employee's `terminated_on` date.
3. **WoW spike**: task categories whose most recent week grew > 30 % over the prior week, with prior week > 30 min (so we don't flag noise on tiny bases).

## AI grounding

The assistant is a `createServerFn` handler that forwards to `https://ai.gateway.lovable.dev/v1/chat/completions` (`google/gemini-2.5-flash`) using `LOVABLE_API_KEY` from server env — the key never touches the browser. Every request:

1. Rebuilds a JSON `grounding` snapshot from the current filter state (headline numbers, top-8 breakdowns per dimension, priority queue, anomalies, per-employee roster with hourly rate).
2. Pins the snapshot into the message list inside a `<dataset>…</dataset>` block.
3. Instructs the model to cite every quantitative claim inline as `[source: path.to.field = value]` — those tags are rendered as chips in the UI so the auditor can see which normalised field each number came from.

Multi-turn works because the message history is retained on the client and re-sent with each request, so follow-ups like "and break that down by department" resolve against the same grounding snapshot.

## Cross-filters

Wired end-to-end:
- Click a bar in **Where the time sits** (task-category or department dimension) → filters the priority queue, trend, anomalies, people table, employee drill-down, headline numbers, PDF export and AI grounding.
- Click a row in **Automate this first** → same, filtering by task.
- Click a person → drill-down profile with peer comparison against same-role employees.

## Export

The PDF is generated in-browser from the **live filter state**. If you filter to Finance and export, the header line, the two headline numbers, the top-5 automation opportunities, the department strip and the date range all reflect Finance-only numbers.

## What we cut

- **Auth / multi-tenant / persistence**. This is a single-tenant analytics view; no user accounts.
- **Custom date-range picker**. The dataset is four weeks; a picker would be UI without insight. Week-over-week trend covers time-shape needs.
- **Model choice UI**. We picked Gemini 2.5 Flash (fast, strong at structured grounding) rather than adding a picker.
- **Chart-per-metric dashboards**. The brief warns against "five charts and zero insight" — we ship one breakdown, one trend, one priority queue, one anomaly panel.

## What we'd build with two more days

1. **Row-level audit**: click a headline number → modal showing the exact source rows it summed, exportable to CSV. The math is already traceable in code; this is UI plumbing.
2. **Simulator**: "if we automated Email Triage in Finance, how much would headline change?" — recompute with `automationFactor` overrides.
3. **Working-hours sanity check**: cross-reference each activity timestamp against the employee's `working_hours` schedule and surface after-hours-heavy people.
4. **AI-generated executive narrative** for the PDF (currently just numbers + bars).

## Running locally

```bash
bun install
bun dev        # http://localhost:8080
```

Set the `LOVABLE_API_KEY` env var (already provisioned in this deployment) for the AI assistant. Data files live in `public/data/` and are fetched on load.
