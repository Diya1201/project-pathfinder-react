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

You are strictly grounded in the JSON dataset provided under <dataset>...</dataset>. It contains the normalised, joined view of activity logs and HRMS metadata for the current filter state. Never invent numbers. Every quantitative claim you make MUST cite the source figure inline in the form [source: <field> = <value>] (for example [source: headline.recoverable_inr_per_month = 128400] or [source: automation_priority[0].task = "Email Triage"]). If the dataset does not contain the answer, say so explicitly and suggest what filter change would surface it.

Style: precise, short paragraphs, tight bullet lists, plain business English. Round INR to the nearest thousand and use "₹X.XL / month" for lakhs. When comparing employees, refer to them by id + name from employees[]. Multi-turn: honour follow-up references like "them" or "that department" from the previous turn.`;

export const askAssistant = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RequestSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), { status: 500 });
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
