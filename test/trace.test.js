import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, createRun, loadEvents, shellQuote } from "../lib/trace.js";

test("shellQuote keeps simple commands readable", () => {
  assert.equal(shellQuote(["npm", "test"]), "npm test");
  assert.equal(shellQuote(["echo", "hello agent"]), "echo 'hello agent'");
});

test("trace events round-trip as jsonl", async () => {
  const dir = await mkdtemp(join(tmpdir(), "afr-"));
  try {
    const run = await createRun({ cwd: dir, command: ["echo", "ok"], version: "test" });
    await appendEvent(run.traceFile, { type: "tool.call", name: "demo" });
    const events = await loadEvents(run.traceFile);

    assert.equal(events[0].type, "meta");
    assert.equal(events[1].type, "tool.call");
    assert.equal(events[1].name, "demo");

    const raw = await readFile(run.traceFile, "utf8");
    assert.match(raw, /"type":"meta"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
