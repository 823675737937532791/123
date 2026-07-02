import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, createRun, loadEvents, nowIso, paths, shellQuote } from "./trace.js";
import { renderReport } from "./report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(await readFile(join(__dirname, "../package.json"), "utf8")).version;

export async function main(argv) {
  const [, , command, ...args] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  if (command === "run" || command === "wrap" || command === "start") {
    await runCommand(args);
    return;
  }

  if (command === "report") {
    await reportCommand(args);
    return;
  }

  if (command === "event") {
    await eventCommand(args);
    return;
  }

  if (command === "list") {
    await listCommand(args);
    return;
  }

  if (command === "doctor") {
    await doctorCommand();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`agent-flight-recorder ${VERSION}

Usage:
  afr run -- <command> [args...]      Record a command and generate an HTML report
  afr report <run-dir>                Rebuild the report for a recorded run
  afr event <type> [json]             Append a custom event to $AFR_TRACE_FILE
  afr list [runs-dir]                 List recorded runs
  afr doctor                          Check local capabilities

Examples:
  afr run -- npm test
  afr run -- python my_agent.py
  AFR_TRACE_FILE=.afr/runs/latest/trace.jsonl afr event tool.call '{"name":"search"}'
`);
}

async function runCommand(args) {
  const split = args[0] === "--" ? args.slice(1) : args;
  if (split.length === 0) {
    throw new Error("Missing command. Try: afr run -- npm test");
  }

  const run = await createRun({
    cwd: process.cwd(),
    command: split,
    version: VERSION,
  });

  const beforeDiff = await gitDiff(process.cwd());
  await appendEvent(run.traceFile, {
    type: "process.start",
    command: split,
    shell: shellQuote(split),
    cwd: process.cwd(),
    pid: process.pid,
  });

  console.error(`afr: recording ${shellQuote(split)}`);
  console.error(`afr: run dir ${relative(process.cwd(), run.dir) || run.dir}`);

  const started = Date.now();
  const child = spawn(split[0], split.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AFR_RUN_DIR: run.dir,
      AFR_TRACE_FILE: run.traceFile,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    void appendEvent(run.traceFile, {
      type: "stdout",
      text: chunk.toString("utf8"),
    });
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    void appendEvent(run.traceFile, {
      type: "stderr",
      text: chunk.toString("utf8"),
    });
  });

  const exit = await new Promise((resolveExit) => {
    child.on("error", (error) => resolveExit({ code: 127, signal: null, error: error.message }));
    child.on("close", (code, signal) => resolveExit({ code, signal, error: null }));
  });

  const durationMs = Date.now() - started;
  const afterDiff = await gitDiff(process.cwd());
  const patch = diffChanged(beforeDiff, afterDiff) ? afterDiff : "";

  if (patch) {
    const diffPath = join(run.dir, "git.diff");
    await writeFile(diffPath, patch, "utf8");
    await appendEvent(run.traceFile, {
      type: "git.diff",
      path: "git.diff",
      bytes: Buffer.byteLength(patch),
    });
  }

  await appendEvent(run.traceFile, {
    type: "process.exit",
    code: exit.code,
    signal: exit.signal,
    error: exit.error,
    durationMs,
  });

  const events = await loadEvents(run.traceFile);
  const html = renderReport(events, { runDir: run.dir, version: VERSION });
  await writeFile(run.reportFile, html, "utf8");
  await writeLatestPointer(run.dir);

  console.error(`afr: report ${run.reportFile}`);
  process.exitCode = exit.code ?? (exit.signal ? 1 : 0);
}

async function reportCommand(args) {
  const runDir = resolve(args[0] || paths.latestPointer);
  const actualRunDir = await resolveRunDir(runDir);
  const traceFile = join(actualRunDir, "trace.jsonl");
  const events = await loadEvents(traceFile);
  const html = renderReport(events, { runDir: actualRunDir, version: VERSION });
  const reportFile = join(actualRunDir, "report.html");
  await writeFile(reportFile, html, "utf8");
  console.log(reportFile);
}

async function eventCommand(args) {
  const [type, json = "{}"] = args;
  if (!type) {
    throw new Error("Missing event type. Try: afr event tool.call '{\"name\":\"search\"}'");
  }
  const traceFile = process.env.AFR_TRACE_FILE;
  if (!traceFile) {
    throw new Error("AFR_TRACE_FILE is not set. Custom events are meant to be emitted from inside an afr run.");
  }
  let payload;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error.message}`);
  }
  await appendEvent(traceFile, { type, ...payload });
}

async function listCommand(args) {
  const runsDir = resolve(args[0] || paths.runsDir);
  if (!existsSync(runsDir)) {
    console.log("No runs yet.");
    return;
  }
  const entries = await readdir(runsDir);
  const rows = [];
  for (const entry of entries) {
    const dir = join(runsDir, entry);
    const info = await safeStat(dir);
    if (!info?.isDirectory()) continue;
    const traceFile = join(dir, "trace.jsonl");
    if (!existsSync(traceFile)) continue;
    const events = await loadEvents(traceFile);
    const meta = events.find((event) => event.type === "meta");
    const exit = [...events].reverse().find((event) => event.type === "process.exit");
    rows.push({
      id: entry,
      command: meta?.shell || meta?.command?.join(" ") || "",
      code: exit ? String(exit.code ?? "signal") : "running",
      duration: exit?.durationMs ? `${Math.round(exit.durationMs)}ms` : "",
    });
  }
  rows.sort((a, b) => b.id.localeCompare(a.id));
  for (const row of rows) {
    console.log(`${row.id}  code=${row.code}  ${row.duration}  ${row.command}`);
  }
}

async function doctorCommand() {
  const checks = [
    ["node", process.version],
    ["platform", `${process.platform}/${process.arch}`],
    ["cwd", process.cwd()],
    ["git", (await gitVersion()) || "not found"],
  ];
  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
}

async function gitDiff(cwd) {
  return await execCapture("git", ["diff", "--no-ext-diff", "--binary"], cwd);
}

async function gitVersion() {
  return await execCapture("git", ["--version"], process.cwd());
}

async function execCapture(command, args, cwd) {
  return await new Promise((resolveCapture) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", () => resolveCapture(""));
    child.on("close", (code) => resolveCapture(code === 0 ? Buffer.concat(chunks).toString("utf8") : ""));
  });
}

function diffChanged(beforeDiff, afterDiff) {
  return beforeDiff !== afterDiff && afterDiff.trim().length > 0;
}

async function writeLatestPointer(runDir) {
  await mkdir(dirname(paths.latestPointer), { recursive: true });
  await writeFile(paths.latestPointer, runDir, "utf8");
}

async function resolveRunDir(input) {
  if (input.endsWith("latest")) {
    return (await readFile(input, "utf8")).trim();
  }
  return input;
}

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
