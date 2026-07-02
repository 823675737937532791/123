# Agent Flight Recorder

A tiny black box recorder for AI agent runs.

Agent Flight Recorder wraps any command, records what happened, and produces a local HTML report with the command, timeline, stdout, stderr, exit code, timing, custom events, and any git diff produced during the run.

It is intentionally boring infrastructure for an exciting problem: agents are getting more capable, but debugging them is still too much guesswork.

## Why this exists

Agent runs often fail in ways that are hard to explain:

- Which tool was called?
- What did the process print before it failed?
- Did the agent change files?
- How long did each run take?
- Can I share a compact report with a teammate?

This project gives you a simple local trace before you reach for heavier observability platforms.

## Install

```bash
npm install -g agent-flight-recorder
```

Or run directly from a checkout:

```bash
node ./bin/agent-flight-recorder.js doctor
```

## Quick start

```bash
afr run -- npm test
afr run -- python my_agent.py
afr run -- node scripts/run-agent.js
```

Each run creates:

```text
.afr/
  latest
  runs/
    2026-07-02-120000000-abc123/
      trace.jsonl
      git.diff
      report.html
```

Open `report.html` in your browser to inspect the run.

## Custom events

Commands launched through `afr run` receive two environment variables:

- `AFR_RUN_DIR`
- `AFR_TRACE_FILE`

That means agent code can add its own events:

```bash
afr run -- sh -c 'afr event tool.call "{\"name\":\"search\",\"query\":\"mcp\"}"'
```

The event is appended to `trace.jsonl` and appears in the report.

## CLI

```text
afr run -- <command> [args...]      Record a command and generate an HTML report
afr report <run-dir>                Rebuild the report for a recorded run
afr event <type> [json]             Append a custom event to $AFR_TRACE_FILE
afr list [runs-dir]                 List recorded runs
afr doctor                          Check local capabilities
```

## Roadmap

- OpenAI Agents SDK hooks
- LangGraph callback adapter
- MCP proxy recorder
- Browser screenshot attachments
- Token, cost, and latency summaries
- GitHub Action artifact upload
- Redaction rules for secrets
- Run comparison view

## Design goals

- Local first
- Zero runtime dependencies
- Append-only trace format
- Human-readable artifacts
- Easy to integrate with any agent framework

## License

MIT
