import { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileJson,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
} from "lucide-react";
import Papa from "papaparse";

export interface UploadedDataset {
  employeesJson: unknown;
  activityCsvText: string;
  activityRows: Record<string, string>[];
  employeesFileName: string;
  activityFileName: string;
}

interface Props {
  onLoaded?: (data: UploadedDataset) => void;
}

type FileKind = "employees" | "activity";

interface SlotState {
  file: File | null;
  parsed: unknown;
  error: string | null;
  progress: number; // 0..100
  processing: boolean;
}

const EMPTY_SLOT: SlotState = {
  file: null,
  parsed: null,
  error: null,
  progress: 0,
  processing: false,
};

const EXPECTED = {
  employees: { name: "employees.json", ext: "json" },
  activity: { name: "activity_logs.csv", ext: "csv" },
} as const;

function detectKind(file: File): FileKind | null {
  const n = file.name.toLowerCase();
  if (n === "employees.json") return "employees";
  if (n === "activity_logs.csv") return "activity";
  return null;
}

export function UploadDataset({ onLoaded }: Props) {
  const [slots, setSlots] = useState<Record<FileKind, SlotState>>({
    employees: { ...EMPTY_SLOT },
    activity: { ...EMPTY_SLOT },
  });
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setSlot = useCallback((kind: FileKind, patch: Partial<SlotState>) => {
    setSlots((s) => ({ ...s, [kind]: { ...s[kind], ...patch } }));
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      setGlobalError(null);
      setLoaded(false);
      const kind = detectKind(file);
      if (!kind) {
        setGlobalError(
          `"${file.name}" is not accepted. Please upload exactly "employees.json" and "activity_logs.csv".`,
        );
        return;
      }
      const expected = EXPECTED[kind];
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== expected.ext) {
        setSlot(kind, {
          file,
          parsed: null,
          error: `Expected .${expected.ext} extension.`,
          progress: 0,
          processing: false,
        });
        return;
      }

      // Start processing
      setSlot(kind, {
        file,
        parsed: null,
        error: null,
        progress: 5,
        processing: true,
      });

      try {
        // Stream read with progress
        const reader = file.stream().getReader();
        const total = file.size || 1;
        let received = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            const pct = Math.min(70, Math.round((received / total) * 70));
            setSlot(kind, { progress: pct });
          }
        }
        const text = new TextDecoder().decode(
          await new Blob(chunks as BlobPart[]).arrayBuffer(),
        );
        setSlot(kind, { progress: 80 });

        if (kind === "employees") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (e) {
            setSlot("employees", {
              parsed: null,
              error: `Invalid JSON: ${(e as Error).message}`,
              progress: 0,
              processing: false,
            });
            return;
          }
          setSlot("employees", {
            parsed,
            error: null,
            progress: 100,
            processing: false,
          });
        } else {
          const result = Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
          });
          if (result.errors && result.errors.length > 0) {
            setSlot("activity", {
              parsed: null,
              error: `Invalid CSV: ${result.errors[0].message} (row ${result.errors[0].row ?? "?"})`,
              progress: 0,
              processing: false,
            });
            return;
          }
          if (!result.data || result.data.length === 0) {
            setSlot("activity", {
              parsed: null,
              error: "CSV appears to be empty.",
              progress: 0,
              processing: false,
            });
            return;
          }
          setSlot("activity", {
            parsed: { text, rows: result.data },
            error: null,
            progress: 100,
            processing: false,
          });
        }
      } catch (e) {
        setSlot(kind, {
          parsed: null,
          error: `Could not read file: ${(e as Error).message}`,
          progress: 0,
          processing: false,
        });
      }
    },
    [setSlot],
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      for (const f of arr) await processFile(f);
    },
    [processFile],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const clearSlot = (k: FileKind) => {
    setLoaded(false);
    setSlots((s) => ({ ...s, [k]: { ...EMPTY_SLOT } }));
  };

  const anyProcessing = slots.employees.processing || slots.activity.processing;
  const bothReady =
    slots.employees.parsed != null &&
    slots.activity.parsed != null &&
    !slots.employees.error &&
    !slots.activity.error &&
    !anyProcessing;

  // Derived counts
  const activityParsed = slots.activity.parsed as
    | { text: string; rows: Record<string, string>[] }
    | null;
  const employeesParsed = slots.employees.parsed as
    | { employees?: unknown[]; data?: { employees?: unknown[] } }
    | null;
  const employeeCount = employeesParsed
    ? (employeesParsed.employees ?? employeesParsed.data?.employees ?? []).length
    : 0;
  const activityCount = activityParsed?.rows.length ?? 0;

  const handleLoad = () => {
    if (!bothReady || !activityParsed) return;
    onLoaded?.({
      employeesJson: slots.employees.parsed,
      activityCsvText: activityParsed.text,
      activityRows: activityParsed.rows,
      employeesFileName: slots.employees.file!.name,
      activityFileName: slots.activity.file!.name,
    });
    setLoaded(true);
  };


  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Upload className="size-4 text-primary" /> Upload dataset
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Drop <code className="text-foreground/80">employees.json</code> and{" "}
            <code className="text-foreground/80">activity_logs.csv</code> to load your own data.
          </div>
        </div>
        <button
          onClick={handleLoad}
          disabled={!bothReady || anyProcessing}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {anyProcessing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Parsing…
            </>
          ) : (
            "Load dataset"
          )}
        </button>
      </div>

      {loaded && bothReady && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <div className="font-medium">Dataset loaded successfully</div>
            <div className="mt-0.5 text-foreground/80">
              <span className="num">{employeeCount.toLocaleString()}</span> employees ·{" "}
              <span className="num">{activityCount.toLocaleString()}</span> activity records parsed
              from <code className="text-foreground/90">{slots.employees.file?.name}</code> and{" "}
              <code className="text-foreground/90">{slots.activity.file?.name}</code>.
            </div>
          </div>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`panel-inset flex flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-8 text-center transition ${
          dragOver ? "border-primary/70 bg-primary/5" : "border-border"
        }`}
      >
        <Upload className="size-6 text-muted-foreground" />
        <div className="text-sm text-foreground/90">
          Drag & drop files here
        </div>
        <div className="text-[11px] text-muted-foreground">
          Accepted: <b>employees.json</b> and <b>activity_logs.csv</b>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs hover:border-primary/40"
        >
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.json,application/json,text/csv"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {globalError && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{globalError}</span>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SlotCard
          icon={<FileJson className="size-4" />}
          title="employees.json"
          slot={slots.employees}
          onClear={() => clearSlot("employees")}
        />
        <SlotCard
          icon={<FileSpreadsheet className="size-4" />}
          title="activity_logs.csv"
          slot={slots.activity}
          onClear={() => clearSlot("activity")}
        />
      </div>
    </section>
  );
}

function SlotCard({
  icon,
  title,
  slot,
  onClear,
}: {
  icon: React.ReactNode;
  title: string;
  slot: SlotState;
  onClear: () => void;
}) {
  const ok = slot.parsed != null && !slot.error && !slot.processing;
  const err = !!slot.error;
  const busy = slot.processing;

  // Compute record count for this slot
  let count: number | null = null;
  if (ok) {
    if (title.endsWith(".json")) {
      const p = slot.parsed as { employees?: unknown[]; data?: { employees?: unknown[] } };
      count = (p.employees ?? p.data?.employees ?? []).length;
    } else {
      const p = slot.parsed as { rows: unknown[] };
      count = p.rows.length;
    }
  }

  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        ok
          ? "border-success/40 bg-success/5"
          : err
            ? "border-destructive/40 bg-destructive/5"
            : busy
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-foreground/90">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        {slot.file && !busy && (
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remove"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">
        {slot.file ? slot.file.name : "Waiting for file…"}
      </div>

      {busy && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11px] text-primary">
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> Parsing…
            </span>
            <span className="num">{slot.progress}%</span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${slot.progress}%` }}
            />
          </div>
        </div>
      )}

      {ok && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-success">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="size-3.5" /> Parsed successfully
          </span>
          {count != null && (
            <span className="text-muted-foreground">
              · <span className="num text-foreground/85">{count.toLocaleString()}</span>{" "}
              {title.endsWith(".json") ? "employees" : "records"}
            </span>
          )}
        </div>
      )}
      {err && (
        <div className="mt-1 inline-flex items-start gap-1 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {slot.error}
        </div>
      )}
    </div>
  );
}

