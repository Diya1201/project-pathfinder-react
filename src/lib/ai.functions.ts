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

You are strictly grounded in the JSON dataset provided under <dataset>...</dataset>. It contains the normalised, joined view of activity logs and HRMS metadata for the current filter state. Never invent numbers. Every quantitative claim you make MUST cite the source figure inline in the form [source: <field> = <value>] (for example [source: headline.recoverable_inr_per_month = 128400] or [source: automation_priority[0].task = "Email Triage"] or [source: breakdown_by_employee[0].employee_name = "John Doe"]).

The dataset includes:
- employees[]: roster with id, name, department, role, compensation
- breakdown_by_employee[]: per-employee activity with total/repetitive minutes, task breakdown, recoverable cost
- breakdown_by_task[], breakdown_by_department[], breakdown_by_app[]: aggregated views
- automation_priority[]: ranked tasks by automation ROI with employees[] list per task
- automation_factors[]: feasibility scores (0.1-0.85) used to calculate recoverable value
- filter_context: current filter state (employee/department/task) if any

When answering employee-level questions:
- Use breakdown_by_employee[] to find who spends most time overall or on specific tasks
- Cross-reference with employees[] for metadata (department, role, compensation)
- For "who spends most time in Finance", filter breakdown_by_employee[] by department="Finance"
- For "who does most Email Triage", look at breakdown_by_employee[].tasks[] where task_category="Email Triage"
- Always cite employee by name and ID: "E005 (Rajesh)" [source: breakdown_by_employee[2].employee_id = "E005"]

Currency formatting:
- Use ₹ symbol (not Rs. or INR)
- Format lakhs as ₹X.XX lakh (e.g., ₹7.15 lakh not ₹715000)
- Format thousands as ₹X,XXX (e.g., ₹7,151 not ₹7151)
- Format crores as ₹X.XX Cr for values ≥1 crore

Multi-turn conversation:
- Remember context from previous turns (e.g., "them", "that department", "break that down")
- If user says "only Finance" after a question, re-answer filtered to Finance department
- If user says "break that down by task/department", provide the requested breakdown

If the dataset cannot answer the question, respond: "The uploaded dataset does not contain enough information to answer this question." and suggest a filter or data requirement.

Style: precise, short paragraphs, tight bullet lists, plain business English.`;

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RequestSchema.parse(data))
  .handler(async ({ data }) => {
    try {
      console.log("[AI] Handler started");
      
      const apiKey = process.env.LOVABLE_API_KEY;
      console.log("[AI] API key exists:", !!apiKey);
      if (!apiKey) {
        console.error("[AI] FATAL: API key is undefined");
        const error = new Error("LOVABLE_API_KEY is not configured");
        console.error("[AI] Stack:", error.stack);
        throw new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured", stack: error.stack }), { status: 500 });
      }
      
      console.log("[AI] Creating grounding block, data.grounding keys:", Object.keys(data.grounding || {}));
      console.log("[AI] Checking for circular references in grounding data...");
      let groundingBlock: string;
      try {
        // Test if data.grounding has circular references
        const testStringify = JSON.stringify(data.grounding);
        console.log("[AI] Grounding JSON.stringify succeeded, length:", testStringify.length);
        
        groundingBlock = `<dataset>\n${JSON.stringify(data.grounding, null, 2)}\n</dataset>`;
        console.log("[AI] Grounding block size:", groundingBlock.length, "chars");
      } catch (err) {
        console.error("[AI] FATAL: JSON.stringify(data.grounding) failed");
        console.error("[AI] Error name:", (err as Error).name);
        console.error("[AI] Error message:", (err as Error).message);
        console.error("[AI] Stack:", (err as Error).stack);
        
        // Try to identify which part is failing
        try {
          console.log("[AI] Testing individual grounding fields:");
          for (const [key, value] of Object.entries(data.grounding)) {
            try {
              JSON.stringify(value);
              console.log(`[AI]   ${key}: OK`);
            } catch (fieldErr) {
              console.error(`[AI]   ${key}: FAILED -`, (fieldErr as Error).message);
            }
          }
        } catch (debugErr) {
          console.error("[AI] Could not debug grounding fields:", debugErr);
        }
        
        throw new Response(JSON.stringify({ 
          error: "Failed to serialize grounding data", 
          message: (err as Error).message,
          stack: (err as Error).stack 
        }), { status: 500 });
      }
      
      console.log("[AI] Building messages array");
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: groundingBlock },
        ...data.messages,
      ];
      console.log("[AI] Messages count:", messages.length);

      console.log("[AI] Preparing fetch request body");
      let requestBody: string;
      try {
        requestBody = JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          temperature: 0.2,
        });
        console.log("[AI] Request body size:", requestBody.length, "chars");
      } catch (err) {
        console.error("[AI] FATAL: JSON.stringify(request body) failed:", err);
        console.error("[AI] Stack:", (err as Error).stack);
        throw err;
      }

      console.log("[AI] Calling AI gateway...");
      let res: Response;
      try {
        res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: requestBody,
        });
        console.log("[AI] Gateway response status:", res.status, res.statusText);
      } catch (err) {
        console.error("[AI] FATAL: fetch() failed:", err);
        console.error("[AI] Stack:", (err as Error).stack);
        throw err;
      }
      
      if (!res.ok) {
        const text = await res.text();
        console.error("[AI] Gateway error response:", text);
        throw new Response(text || "AI gateway error", { status: res.status });
      }
      
      console.log("[AI] Parsing gateway response JSON");
      let json: { choices?: { message?: { content?: string } }[] };
      try {
        json = await res.json();
        console.log("[AI] Response parsed, choices:", json.choices?.length);
      } catch (err) {
        console.error("[AI] FATAL: res.json() failed:", err);
        console.error("[AI] Stack:", (err as Error).stack);
        throw err;
      }
      
      const content = json.choices?.[0]?.message?.content ?? "";
      console.log("[AI] Response content length:", content.length, "chars");
      console.log("[AI] Handler completed successfully");
      return { content };
      
    } catch (err) {
      console.error("[AI] FATAL: Unhandled exception in handler:");
      console.error("[AI] Error:", err);
      console.error("[AI] Stack:", (err as Error)?.stack);
      throw err;
    }
  });
