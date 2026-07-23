import { useCallback, useRef, useState } from "react";
import { Upload, FileJson, FileSpreadsheet, CheckCircle2, AlertCircle, X } from "lucide-react";
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
}

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
    employees: { file: null, parsed: null, error: null },
    activity: { file: null, parsed: null, error: null },
  });
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const processFile = useCallback(async (file: File) => {
    setGlobalError(null);
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
      setSlots((s) => ({
        ...s,
        [kind]: { file, parsed: null, error: `Expected .${expected.ext} extension.` },
      }));
      return;
    }

    try {
      const text = await file.text();
      if (kind === "employees") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          setSlots((s) => ({
            ...s,
            employees: {
              file,
              parsed: null,
              error: `Invalid JSON: ${(e as Error).message}`,
            },
          }));
          return;
        }
        setSlots((s) => ({
          ...s,
          employees: { file, parsed, error: null },
        }));
      } else {
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
        });
        if (result.errors && result.errors.length > 0) {
          setSlots((s) => ({
            ...s,
            activity: {
              file,
              parsed: null,
              error: `Invalid CSV: ${result.errors[0].message} (row ${result.errors[0].row ?? "?"})`,
            },
          }));
          return;
        }
        if (!result.data || result.data.length === 0) {
          setSlots((s) => ({
            ...s,
            activity: { file, parsed: null, error: "CSV appears to be empty." },
          }));
          return;
        }
        setSlots((s) => ({
          ...s,
          activity: { file, parsed: { text, rows: result.data }, error: null },
        }));
      }
    } catch (e) {
      setSlots((s) => ({
        ...s,
        [kind]: { file, parsed: null, error: `Could not read file: ${(e as Error).message}` },
      }));
    }
  }, []);

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

  const clearSlot = (k: FileKind) =>
    setSlots((s) => ({ ...s, [k]: { file: null, parsed: null, error: null } }));

  const bothReady =
    slots.employees.parsed != null &&
    slots.activity.parsed != null &&
    !slots.employees.error &&
    !slots.activity.error;

  const handleLoad = () => {
    if (!bothReady) return;
    const activity = slots.activity.parsed as { text: string; rows: Record<string, string>[] };
    onLoaded?.({
      employeesJson: slots.employees.parsed,
      activityCsvText: activity.text,
      activityRows: activity.rows,
      employeesFileName: slots.employees.file!.name,
      activityFileName: slots.activity.file!.name,
    });
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
          disabled={!bothReady}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Load dataset
        </button>
      </div>

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
  const ok = slot.parsed != null && !slot.error;
  const err = !!slot.error;
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        ok
          ? "border-success/40 bg-success/5"
          : err
            ? "border-destructive/40 bg-destructive/5"
            : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-foreground/90">
          {icon}
          <span className="font-medium">{title}</span>
        </div>
        {slot.file && (
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remove"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {slot.file ? slot.file.name : "Waiting for file…"}
      </div>
      {ok && (
        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-success">
          <CheckCircle2 className="size-3.5" /> Parsed successfully
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
