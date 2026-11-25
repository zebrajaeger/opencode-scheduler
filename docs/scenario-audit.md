# Initial scheduler scenario audit

Audited on 2026-11-25 against the three delta specs in
`openspec/changes/archive/2026-11-25-initial-scheduler/specs/` (the change is now archived).
The synchronized contracts live in `openspec/specs/`. Test names below refer to `test/`.
Automated host evidence is not a substitute for client-specific smoke evidence;
see `smoke-test.md` for the completed, per-client recorded checks.

## Timer management (15 scenarios)

| Spec scenario | Evidence |
| --- | --- |
| Natural-language management | `tools.test.ts`: five directly discoverable tools; real German UI requests exercised all five tools in both clients |
| One-shot timer | management: creates one-shot and repeat timers; dispatch: one-shot admission is not completion; real host and UI file checks |
| Recurring timer with delayed first run | management: creates one-shot and repeat timers with independent IDs and first delays |
| Multiple independent timers | management: independent IDs; listing isolates sessions and locations; real host two projects |
| Foreign timer ID | management: atomic updates and idempotent stopping; real host foreign stop |
| Default lifetime | management: lifetime expires in real elapsed time, explicit 3,600,000 ms assertion |
| Explicit lifetime expires while deferred | dispatch: expiry removes disabled and busy deferred timers with no catchup; UI foreground expiry |
| Interval change | management: updates are atomic; real host and UI preserve expiry and ID |
| Lifetime change | management: updates are atomic, expiry recalculated from creation |
| Update during execution | dispatch: in-flight updates preserve submitted snapshot and submitted once cannot rearm |
| Invalid or excessive frequency | management: unsafe delay table, validates prompts modes schedules and configuration, atomic updates |
| Schedule cannot run within lifetime | management: validates schedules and atomic updates |
| Busy deferral is visible | dispatch: one-shot admission is not completion (`in-flight` / `deferred` assertions) |
| Stop all timers | management: stopping is idempotent and stop-all does not affect foreign sessions; UI management |
| Stop races with admission | dispatch: update and stop during inspection prevent stale submission |

## Timer dispatch (18 scenarios)

| Spec scenario | Evidence |
| --- | --- |
| Existing session dispatch | adapter: host sends only queued prompt fields and preserves defaults; real host history/location/model assertions |
| User activity races with dispatch | dispatch: a newer busy event takes precedence over stale idle inspection; adapter only `delivery: queue` |
| Long foreground tool | dispatch: busy deferral coalesces missed slots; real host 45-second foreground; both UI clients |
| Timer creation during agent activity | real host model tools create timers before foreground work; both UI clients |
| Test process running in the background | real host 65-second Node process; both UI clients use genuine background shell |
| Multiple due timers in one session | dispatch: one-shot admission is not completion and multiple timers serialize with cooldown |
| Different sessions | dispatch: stalled session does not block another session; real host two projects |
| Acceptance is not completion | dispatch: one-shot admission is not completion; reservation survives stop/new timer |
| Extended busy period | dispatch: busy deferral coalesces missed slots; expiry removes deferred timers |
| Machine resumes from sleep | dispatch: late wake coalesces elapsed intervals and does not dispatch expired timers |
| Several timers bypass individual intervals | dispatch: multiple timers serialize with cooldown; configured spacing governs every timer in the session |
| Prompt creates or updates a timer | dispatch: in-flight updates preserve snapshot; stop/new timer cannot release accepted reservation |
| Admission failure | dispatch: failed one-shot is disabled and bounded diagnostics cannot cause retries; confirmed missing owner vs transient failure |
| Timer execution failure | dispatch: normal failure disables delivered timer until an explicit valid update |
| Lost acknowledgement or ambiguous outcome | dispatch: ambiguous acknowledgement disables timer; hanging acknowledgement never releases barrier |
| Update during eligibility check | dispatch: update and stop during inspection prevent stale submission |
| Late completion after stop and restart | dispatch: old terminal events cannot complete a newer delivered reservation; unrelated terminal events cannot release queued input |
| Fast execution before admission acknowledgement | dispatch: early delivery and completion before acknowledgement settle exactly once |

## Plugin lifecycle (14 scenarios)

| Spec scenario | Evidence |
| --- | --- |
| Plugin installation | API contracts, adapter registration test, real host loads local package and calls all five tools |
| Project installation | Final private real-host/UI run loads the npm-installed packed package solely from each project's opencode.jsonc; global config has no plugins; disabled project exposes no timer tool |
| Global installation across projects | real host global test configuration and two independent project locations; adapter independent tool sets |
| Restart | Real host location reload; explicit interactive reload; actual private process restart with live sentinels and subsequent empty UI lists in both clients; README accepted-input boundary |
| User aborts the session | dispatch interruption preserves foreign timers; real host interruption; both client stop buttons and empty lists |
| Chat navigation or successful answer | dispatch completion tests; UI background checks while another chat is selected |
| Session deletion | dispatch confirmed missing owner vs transient failure; real host deletion; both clients delete active-timer sessions through UI confirmation |
| Session moves to another worktree | dispatch: moved owners stop and forks do not inherit timers |
| Session is not displayed | real host runs without UI; UI navigation while timer runs |
| Tool requires approval | adapter forwards no permission override; README policy limitation; both clients show normal approval cards for scheduled harmless shell and denial prevents execution |
| Stricter spacing | management rejects 30-second timing with a 60-second default; dispatch configured session-wide 60-second cooldown test |
| Unsafe configuration | management validation and adapter invalid configuration fails before registration |
| Cleanup with pending work | adapter unload closes consumer/timeouts without awaiting inspection; dispatch close ignores late results; README accepted-input limitation |
| Release readiness | 56 local tests; typecheck/build/pack; real host 2.3.2 and 2.4.1; smoke evidence explicitly distinguishes passed and unverified cases |

## Boundaries

The audit found one missing explicit assertion for configured session-wide
spacing; `configured spacing governs every timer in the session` was added and
passes. No production behavior was changed during this audit. Actual packed
artifact dependency installation/import and project-only host activation were
checked independently of a package dry-run. Package-name configuration after
publication cannot be tested before publication and is explicitly documented as
a future installation option. All 47 scenarios now have test or recorded manual
evidence; source inspection alone is not counted as real-host evidence.
