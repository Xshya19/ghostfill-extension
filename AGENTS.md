# Autonomous Skill Activation & Workflow Rules

## Skill Discovery & Auto-Activation
- **Autonomous Skill Selection**: Never wait for the user to explicitly call a skill (e.g. via `@skill-name`). Autonomously evaluate the task requirements and activate the most relevant skill(s) from the installed library before beginning work.
- **Progressive Activation**: Read and follow the corresponding `SKILL.md` instructions whenever the task matches a specialized domain:
  - **Debugging & Troubleshooting**: Activate `systematic-debugging` / `debugging-toolkit`
  - **Feature Planning & Scoping**: Activate `brainstorming` / `architecture` / `writing-plans`
  - **Frontend & UI/UX**: Activate `frontend-design` / `react-ui-patterns` / `tailwind-design`
  - **Testing & QA**: Activate `tdd-workflow` / `testing-patterns` / `jest-skill` / `vitest`
  - **Security & Audits**: Activate `security-auditor` / `code-review-excellence`
  - **Chrome Extensions**: Activate `chrome-extension-developer` / `browser-extension-builder`
  - **Refactoring & Clean Code**: Activate `clean-code` / `code-simplification`
- **Execution**: Apply the methodology, checklists, and guidelines prescribed in the activated skill to ensure high-quality execution without requiring manual intervention from the user.
