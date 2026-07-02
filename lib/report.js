import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function renderReport(events, { runDir, version }) {
  const meta = events.find((event) => event.type === "meta") || {};
  const exit = [...events].reverse().find((event) => event.type === "process.exit") || {};
  const diffEvent = events.find((event) => event.type === "git.diff");
  const diff = diffEvent ? readOptional(join(runDir, diffEvent.path)) : "";
  const stdout = collectText(events, "stdout");
  const stderr = collectText(events, "stderr");
  const customEvents = events.filter((event) => !["meta", "process.start", "process.exit", "stdout", "stderr", "git.diff"].includes(event.type));
  const status = exit.code === 0 ? "passed" : "failed";
  const duration = typeof exit.durationMs === "number" ? `${(exit.durationMs / 1000).toFixed(2)}s` : "unknown";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Flight Recorder - ${escapeHtml(meta.runId || "run")}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f5ef;
      --panel: #ffffff;
      --ink: #1b1f24;
      --muted: #667085;
      --line: #d7d7c9;
      --accent: #087f8c;
      --danger: #b42318;
      --ok: #027a48;
      --code: #101828;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #121412;
        --panel: #1b1f1d;
        --ink: #f2f4f7;
        --muted: #a9b2bd;
        --line: #343a36;
        --accent: #47c2b1;
        --danger: #ff8a7a;
        --ok: #6ce9a6;
        --code: #0b0d0c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1120px, calc(100vw - 32px));
      margin: 0 auto;
    }
    .hero {
      display: grid;
      gap: 18px;
      padding: 34px 0 24px;
    }
    h1 {
      margin: 0;
      font-size: clamp(30px, 5vw, 56px);
      line-height: 1;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 0;
      max-width: 780px;
      color: var(--muted);
      font-size: 16px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 20px 0 0;
    }
    .stat {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 12px;
      min-height: 82px;
    }
    .stat b {
      display: block;
      font-size: 18px;
      overflow-wrap: anywhere;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }
    main {
      padding: 24px 0 40px;
    }
    section {
      margin: 0 0 18px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow: hidden;
    }
    h2 {
      margin: 0;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      font-size: 15px;
    }
    pre {
      margin: 0;
      padding: 16px;
      overflow: auto;
      background: var(--code);
      color: #f8f8f2;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .timeline {
      padding: 8px 16px 16px;
    }
    .event {
      display: grid;
      grid-template-columns: 190px 150px 1fr;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }
    .event:last-child { border-bottom: 0; }
    .time, .type { color: var(--muted); overflow-wrap: anywhere; }
    .payload {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-block;
      border-radius: 999px;
      padding: 3px 10px;
      color: #fff;
      background: ${status === "passed" ? "var(--ok)" : "var(--danger)"};
      font-weight: 700;
    }
    @media (max-width: 720px) {
      .event {
        grid-template-columns: 1fr;
        gap: 2px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap hero">
      <div>
        <h1>Agent Flight Recorder</h1>
        <p class="subtitle">${escapeHtml(meta.shell || "Recorded agent run")}</p>
      </div>
      <div class="stats">
        ${stat("Status", `<span class="badge">${escapeHtml(status)}</span>`)}
        ${stat("Duration", escapeHtml(duration))}
        ${stat("Exit code", escapeHtml(String(exit.code ?? "unknown")))}
        ${stat("Events", escapeHtml(String(events.length)))}
        ${stat("Version", escapeHtml(version))}
        ${stat("Run ID", escapeHtml(meta.runId || ""))}
      </div>
    </div>
  </header>
  <main class="wrap">
    <section>
      <h2>Timeline</h2>
      <div class="timeline">
        ${events.map(renderEvent).join("")}
      </div>
    </section>
    ${stdout ? block("stdout", stdout) : ""}
    ${stderr ? block("stderr", stderr) : ""}
    ${diff ? block("git diff", diff) : ""}
    ${customEvents.length ? block("custom events", JSON.stringify(customEvents, null, 2)) : ""}
  </main>
</body>
</html>`;
}

function renderEvent(event) {
  const { ts, type, text, ...rest } = event;
  const payload = text ? compactText(text) : JSON.stringify(rest, null, 2);
  return `<div class="event">
    <div class="time">${escapeHtml(ts || "")}</div>
    <div class="type">${escapeHtml(type || "")}</div>
    <div class="payload">${escapeHtml(payload)}</div>
  </div>`;
}

function stat(label, value) {
  return `<div class="stat"><span>${escapeHtml(label)}</span><b>${value}</b></div>`;
}

function block(title, value) {
  return `<section><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(value)}</pre></section>`;
}

function collectText(events, type) {
  return events
    .filter((event) => event.type === type)
    .map((event) => event.text || "")
    .join("");
}

function compactText(text) {
  const single = String(text).replace(/\s+/g, " ").trim();
  return single.length > 220 ? `${single.slice(0, 220)}...` : single;
}

function readOptional(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
