# Project preferences

- Do not add unsolicited help text, usage instructions, explanatory labels, or status copy to the page.
- Keep styling minimal and functional. Avoid decorative colors, typography, spacing, and page-wide styling unless requested.
- Prefer native JavaScript primitives over redundant wrapper types.

- Keep code expanded and readable rather than compressing it into dense one-liners.
- The pre-commit hook runs `bun fmt --staged` and stages formatting automatically. Rely on that hook instead of running a duplicate formatter pass just for a commit. Use `bun fmt --check` for verification; if formatting is needed before tests, format once before running them.
- Enable the tracked hook in a fresh checkout with `git config core.hooksPath .githooks`. If the hook is unavailable or bypassed, run `bun fmt` before final checks and committing. Partially staged files must be staged completely or have their unstaged edits put aside before the formatter hook can proceed.
