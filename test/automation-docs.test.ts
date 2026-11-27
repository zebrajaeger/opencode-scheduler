import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

test("automation audit names every requirement and scenario and leaves smoke execution status explicit", () => {
  const root = "openspec/changes/archive/2026-11-27-add-persistent-prompt-automations/specs";
  const audit = readFileSync("docs/automation-scenario-audit.md", "utf8");
  for (const capability of readdirSync(root)) {
    const spec = readFileSync(`${root}/${capability}/spec.md`, "utf8");
    for (const heading of spec.matchAll(/^#{3,4} (?:Requirement|Scenario): (.+)$/gm)) expect(audit).toContain(heading[1]!.trim());
  }
  const smoke = readFileSync("docs/smoke-test.md", "utf8");
  for (let id = 1; id <= 12; id++) expect(smoke).toContain(`A${String(id).padStart(2, "0")} —`);
  expect(audit).toContain("not a passing result");
  expect(smoke).toContain("A hard-coded model response containing a link is not evidence that tool approval was exercised");
});

test("recovery diagnostics distinguish unresolved evidence approval and UI versus server lifetime", () => {
  const docs = readFileSync("docs/development.md", "utf8");
  for (const phrase of ["unresolved", "Offline completion", "gated indefinitely", "target-unavailable", "setup-unresolved", "tombstone", "already admitted input", "Closing a UI", "not live PR-provider access or UI certification"]) expect(docs).toContain(phrase);
});

test("completed client fixture evidence names every smoke check and retains safety limits", () => {
  const evidence = readFileSync("docs/automation-ui-verification.md", "utf8");
  for (let id = 1; id <= 12; id++) expect(evidence).toContain(`| A${String(id).padStart(2, "0")} `);
  for (const phrase of ["2.4.1", "2.8.0", "deterministic fixtures", "not arbitrary natural-language", "tombstone", "not cleared",
    "ui-misfire-before.json", "ui-misfire-after.json", "ui-final-cleanup.json", "ui-deferred-coalescing.json", "console"]) expect(evidence).toContain(phrase);
  expect(evidence).not.toContain("| Partial pending");
  expect(evidence).not.toContain("| Pending final cleanup");
  for (const readme of ["README.md", "README.de.md"]) expect(readFileSync(readme, "utf8")).toContain("docs/automation-ui-verification.md");
});

test("archived automation deltas remain exactly synchronized with main requirements", () => {
  const root = "openspec/changes/archive/2026-11-27-add-persistent-prompt-automations/specs";
  const requirements = (text: string) => [...text.matchAll(/^### Requirement: (.+)\n([\s\S]*?)(?=^### Requirement: |$(?![\s\S]))/gm)];
  for (const capability of readdirSync(root)) {
    const main = readFileSync(`openspec/specs/${capability}/spec.md`, "utf8");
    expect(main).not.toMatch(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements/m);
    for (const block of requirements(readFileSync(`${root}/${capability}/spec.md`, "utf8"))) {
      expect(requirements(main).find(candidate => candidate[1] === block[1])?.[0].trim()).toBe(block[0].trim());
    }
  }
});
