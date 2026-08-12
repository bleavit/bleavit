Bring this repository's living documents back in line with reality (AGENTS.md is
binding). Scope: README.md, PLAN.md, plan/, AGENTS.md, CLAUDE.md, .claude/ assets, .codex/
playbooks. docs/architecture/ is the spec and is out of scope here — leave it alone;
syncing the living documents is never the place to change the spec.

1. GROUND TRUTH first — never write from memory:
   git status --porcelain; git diff --stat HEAD; git log --oneline -10; the actual
   file tree; Cargo workspace members; package manifests; CI jobs and test entry
   points that exist right now.

2. PER-FILE CONTRACT.
   - PLAN.md + plan/: statuses match reality (red gates ⇒ not done); Current focus names
     the true next step; today's `plan/log/` file records the work; question,
     verification, decision and audit items reflect what actually happened.
     The plan tree stays reference-only — milestone frontmatter cites docs/architecture/ sections,
     never restate spec content.
   - README.md: status, repository map, and commands are currently true; links resolve.
     The opening paragraph (thank-you to Prof. Robin Hanson) and the closing line
     (Bon appétit) are pinned verbatim by rule R-11 — never reword, trim, or remove.
   - AGENTS.md: rules, session protocol, quality gates, layout table match how the
     repo works now.
   - CLAUDE.md: skills/subagents/hooks tables match the files under .claude/.
   - .codex/prompts/: still procedurally equivalent to the .claude/skills/ they mirror.

3. APPLY minimal, surgical edits. Append to logs, never rewrite their history. Label
   planned things as planned — never document aspirations as facts. Verify every
   relative link you touched resolves.

4. REPORT: each file changed with a one-line reason, plus anything that needs a human
   decision (flag it, don't decide it).
