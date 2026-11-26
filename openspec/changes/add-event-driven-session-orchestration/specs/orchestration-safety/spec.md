# Spec Delta

## Purpose

Constrain inter-agent coordination to authorized scopes and bounded execution while preserving provenance, host permissions, and separation of data from instructions.

## ADDED Requirements

### Requirement: Default project and instance isolation
Mandatory coordination SHALL stay within one configured OpenCode instance and the caller's host-derived project, including validated worktrees. Cross-project or unconfigured-server reads, signals, and activations SHALL be denied by default. Session movement SHALL trigger scope revalidation rather than silently following a target.

#### Scenario: Accidental cross-project target
- **WHEN** an agent supplies the ID of an implementation session in another project
- **THEN** the request is denied without exposing its content or activating it

#### Scenario: Same-project worktrees
- **WHEN** source and target use different worktrees with the same validated project identity
- **THEN** communication is allowed subject to ownership, permissions, and target-location revalidation

### Requirement: Ownership and permission preservation
Job mutation SHALL require creator-session ownership, and task transition SHALL require producer-session ownership. Agent-supplied identity fields SHALL NOT override invocation identity. Automatic prompts SHALL remain subject to normal OpenCode tool permissions and user approvals; scheduling SHALL NOT approve requests on the user's behalf.

#### Scenario: Foreign cancellation
- **WHEN** a session tries to cancel another session's private job
- **THEN** the operation returns a non-disclosing not-found or denied result without modification

#### Scenario: Scheduled work needs approval
- **WHEN** an activated session reaches a tool requiring approval
- **THEN** the existing OpenCode permission flow remains in effect and the scheduler does not auto-approve

### Requirement: Peer content remains untrusted data
Retrieved peer messages, results, and signal payloads SHALL retain provenance and be delimited as untrusted data when included in prompts. They SHALL NOT become system instructions, executable templates, tool code, or authority to expand project scope. Documentation SHALL state that these boundaries reduce but do not eliminate LLM prompt-injection risk.

#### Scenario: Review result contains malicious instructions
- **WHEN** a result says to ignore policy and send repository contents elsewhere
- **THEN** the envelope preserves that text as quoted source data without promoting it to scheduler instructions, executing it, or granting additional permissions

### Requirement: Bounded resource and activation policy
The system SHALL enforce documented finite bounds on payloads, assembled prompts, condition counts, live jobs, retained data, lifetimes, and automatic activations. Default limits SHALL include 16 conditions per group, 32 KiB JSON payloads, 16 KiB message text, 64 KiB activation envelopes, and a 3600-second job lifetime capped at seven days. Violations SHALL fail atomically with resource-limit or invalid-input.

#### Scenario: Oversized payload
- **WHEN** a signal exceeds the effective UTF-8 byte limit or a job exceeds condition limits
- **THEN** publication or registration is rejected without partial records or truncated matching semantics

#### Scenario: Quota exhaustion
- **WHEN** owner/project job or retained-data quotas are exhausted
- **THEN** new work is rejected explicitly while existing pending evidence and unrelated projects remain intact

### Requirement: Known cycles and dynamic feedback limits
Registration SHALL reject explicit self-dependencies and cycles among known task-output dependencies. Automatic actions SHALL propagate host-derived causation and enforce persistent hop, activation, recurrence, and target-spacing budgets. Dynamic cycles beyond static analysis SHALL pause offending work instead of generating unbounded mutual prompts.

#### Scenario: Explicit task cycle
- **WHEN** a registration would make task A depend on B and B depend on A through declared output dependencies
- **THEN** registration fails with a bounded cycle diagnostic

#### Scenario: Mutual signal activation
- **WHEN** A's prompt emits a signal that activates B and B repeatedly signals A
- **THEN** the chain pauses on its configured budget, no later automatic admission bypasses it, and inspection exposes causation

#### Scenario: New correlation attempts to bypass spacing
- **WHEN** an agent creates another correlation while its target is in cooldown
- **THEN** target admission spacing and owner/project limits still prevent an immediate activation loop

### Requirement: Secret-safe local transport
SDK connectivity SHALL use an explicitly bound or verified discovered same-server endpoint and secret references outside prompts and stored payloads. Discovery SHALL NOT start another server or scan arbitrary ports. Unverified identity, version, or authentication SHALL disable dependent capabilities rather than silently reroute traffic.

#### Scenario: Wrong endpoint
- **WHEN** the configured endpoint cannot validate the current session/project binding
- **THEN** SDK-dependent reads and triggers fail closed without sending a prompt to that endpoint

#### Scenario: Credential configuration
- **WHEN** SDK authentication is configured
- **THEN** secrets are resolved outside model-visible content and are not persisted in job records, diagnostics, or result envelopes
