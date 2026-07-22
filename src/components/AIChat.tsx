import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { askAssistant } from "@/lib/ai.functions";
import { groundingSnapshot } from "@/lib/analytics";
import type { NormalisedData } from "@/lib/normalize";
import type { Filters } from "@/lib/analytics";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Who is our single highest-ROI automation target next quarter?",
  "Who in Finance spends the most on Email Triage, and what's it costing us per month?",
  "Which employees have the highest repetitive-task share?",
];

// Render inline citations like [source: foo.bar = 12] as chips.
function renderContent(text: string) {
  if (!text) return null;
  const parts = text.split(/(\[source:[^\]]+\])/g);
  return parts.map((p, i) => {
    if (p.startsWith("[source:")) {
      return (
        <span key={i} className="chip mx-0.5 !bg-primary/10 !text-primary !border-primary/30 num">
          {p.slice(1, -1).replace(/^source:\s*/, "")}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function AIChat({ data, filters }: { data: NormalisedData; filters: Filters }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const ask = useServerFn(askAssistant);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mutation = useMutation({
    mutationFn: async (userText: string) => {
      const nextMessages: Msg[] = [...messages, { role: "user", content: userText }];
      setMessages(nextMessages);
      const grounding = groundingSnapshot(data, filters);
      const res = await ask({ data: { messages: nextMessages, grounding } });
      const content = res?.content || "No response received from AI";
      setMessages((m) => [...m, { role: "assistant", content }]);
      return res;
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, mutation.isPending]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || mutation.isPending) return;
    setInput("");
    mutation.mutate(t);
  };

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <div className="text-sm font-medium">Pulse Assistant</div>
        </div>
        <span className="chip num">grounded · {data.activity.length} rows</span>
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              I only answer from the normalised dataset in the panel above. Every number I quote is
              tagged with its source field.
            </p>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => submit(s)}
                className="block w-full rounded-md border border-border bg-surface-2/50 px-3 py-2 text-left text-xs text-foreground/90 transition hover:border-primary/40 hover:bg-surface-2"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-lg bg-primary/15 px-3 py-2 text-sm text-foreground"
                  : "max-w-[92%] rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed text-foreground/95 whitespace-pre-wrap"
              }
            >
              {m.role === "assistant" ? renderContent(m.content) : m.content}
            </div>
          </div>
        ))}
        {mutation.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Grounding response…
          </div>
        )}
        {mutation.isError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            <AlertTriangle className="size-4 shrink-0" />
            <span>The assistant call failed. {(mutation.error as Error).message}</span>
          </div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="flex items-center gap-2 border-t border-border px-3 py-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about time, cost, automation opportunities…"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !input.trim()}
          className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
