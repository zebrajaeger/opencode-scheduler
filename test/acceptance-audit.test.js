import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

test("every OpenSpec delta scenario has an explicit acceptance-audit entry", () => {
  const root = "openspec/changes/add-event-driven-session-orchestration/specs";
  const audit = readFileSync("docs/orchestration-acceptance-audit.md", "utf8");
  let count = 0;
  for (const directory of readdirSync(root)) {
    const spec = readFileSync(path.join(root, directory, "spec.md"), "utf8");
    for (const match of spec.matchAll(/^#### Scenario: (.+)$/gm)) {
      count++;
      expect(audit, `${directory}: ${match[1]}`).toContain(`- ${match[1]} —`);
    }
  }
  expect(count).toBeGreaterThan(0);
  // An index entry is not a passing acceptance result: keep the unresolved host
  // contract visible until actual qualification changes the audit and checklist.
  expect(audit).toContain("Native replay and corresponding");
  expect(audit).toContain("restart guarantees remain blocked");
});
