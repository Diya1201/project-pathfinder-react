import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const RequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  grounding: z.record(z.string(), z.any()),
});

const SYSTEM_PROMPT = `You are Workforce Pulse, a COO-facing analytics copilot.

You are strictly grounded in the JSON dataset provided under <dataset>...</dataset>. It contains:

**1. employee_activity[]** - Per-employee activity breakdown (USE THIS for "Who" questions):
   - total_hours_observed: Total time logged by this employee
   - department, role: Employee context
   - top_tasks[]: Top 5 tasks with hours per task
   - repetitive_share: % of time spent on repetitive tasks
   - recoverable_hours_per_month: Projected automation savings
   - hourly_inr: Compensation rate

**2. automation_priority[]** - Task-level automation scores (USE THIS for "What to automate")

**3. breakdown_by_task/app/department** - Aggregate views across all employees

**4. employees[]** - Employee roster metadata (for employees WITHOUT activity or comp lookups)

**Answering "Who" Questions:**
- "Who spends the most time in Finance?" → Sort employee_activity by total_hours_observed where department="Finance"
- "Which employee does the most Email Triage?" → Find employee_activity with highest top_tasks[].hours where task="Email Triage"
- "Who has the highest repetitive share?" → Sort employee_activity by repetitive_share

**Citation Rules:**
Every quantitative claim MUST cite the source inline: [source: <path> = <value>]

Examples:
- [source: employee_activity[0].name = "Employee 004"]
- [source: employee_activity[0].total_hours_observed = 45.2]
- [source: employee_activity[0].top_tasks[0].task = "Email Triage"]
- [source: employee_activity[0].top_tasks[0].hours = 12.5]

If the dataset does not contain the answer (e.g., filtered view excludes requested department), say so explicitly and suggest changing the filter.

Style: precise, short paragraphs, tight bullet lists, plain business English. Round INR to nearest thousand, use "₹X.XL / month" for lakhs. When comparing employees, refer to them by id + name from employee_activity[].`;

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RequestSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
      });
    }
    const groundingBlock = `<dataset>\n${JSON.stringify(data.grounding, null, 2)}\n</dataset>`;
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: groundingBlock },
      ...data.messages,
    ];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Response(text || "AI gateway error", { status: res.status });
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { content };
  });
