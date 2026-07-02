import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const paths = {
  root: ".afr",
  runsDir: ".afr/runs",
  latestPointer: ".afr/latest",
};

export function nowIso() {
  return new Date().toISOString();
}

export async function createRun({ cwd, command, version }) {
  const runId = makeRunId();
  const dir = join(cwd, paths.runsDir, runId);
  const traceFile = join(dir, "trace.jsonl");
  const reportFile = join(dir, "report.html");

  await mkdir(dir, { recursive: true });
  await writeFile(traceFile, "", "utf8");
  await appendEvent(traceFile, {
    type: "meta",
    runId,
    version,
    cwd,
    command,
    shell: shellQuote(command),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  });

  return { runId, dir, traceFile, reportFile };
}

export async function appendEvent(traceFile, event) {
  const enriched = {
    ts: nowIso(),
    ...event,
  };
  await appendFile(traceFile, `${JSON.stringify(enriched)}\n`, "utf8");
}

export async function loadEvents(traceFile) {
  const text = await readFile(traceFile, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return {
          ts: nowIso(),
          type: "trace.parse_error",
          line: index + 1,
          error: error.message,
          raw: line,
        };
      }
    });
}

export function shellQuote(parts) {
  return parts
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@%+-]+$/.test(part)) return part;
      return `'${String(part).replaceAll("'", "'\\''")}'`;
    })
    .join(" ");
}

function makeRunId() {
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replace("T", "-")
    .replace("Z", "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}
