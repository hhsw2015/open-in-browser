# Repository Guidelines

## Project Structure & Module Organization
This repository is currently a clean slate. Keep the root minimal and use this layout as the project baseline:
- `manifest.json`: Chrome extension manifest (required at root).
- `src/background/`: service worker and background logic.
- `src/content/`: content scripts injected into pages.
- `src/popup/`: popup UI and related assets.
- `src/shared/`: shared utilities/types.
- `assets/`: static icons/images.
- `tests/`: unit and integration tests.
- `scripts/`: local automation tasks (build helpers, packaging).

## Build, Test, and Development Commands
Use `npm` scripts and keep them consistent across contributors:
- `npm install`: install dependencies.
- `npm run dev`: watch mode for local extension development.
- `npm run build`: produce production artifacts (for example to `dist/`).
- `npm test`: run automated tests.
- `npm run lint`: run static checks before opening a PR.

Example workflow: `npm install && npm run lint && npm test && npm run build`.

## Coding Style & Naming Conventions
- Use TypeScript for new code; keep JavaScript only where required by tooling.
- Indentation: 2 spaces; prefer single quotes; end statements with semicolons.
- File naming: `kebab-case` for files (`open-tab.ts`), `PascalCase` for React/UI components, `camelCase` for functions/variables.
- Keep modules focused; avoid large mixed-responsibility files.
- Format/lint with Prettier + ESLint; commit only clean lint output.

## Testing Guidelines
- Prefer unit tests in `tests/unit/` and integration tests in `tests/integration/`.
- Test files should follow `*.test.ts` naming.
- Target meaningful coverage on core behaviors (tab creation, URL parsing, permission-guarded flows); aim for at least 80% on touched modules.
- Run `npm test` locally before committing.

## Commit & Pull Request Guidelines
No established commit history exists yet; adopt Conventional Commits:
- `feat: add context-menu open in default browser`
- `fix: handle invalid url in content script`

PRs should include:
- clear summary of behavior changes,
- linked issue (if available),
- screenshots/GIFs for popup or options UI changes,
- test evidence (`npm test`, `npm run lint`, `npm run build`).

## Security & Configuration Tips
- Request the minimum Chrome permissions required by each feature.
- Never commit secrets, API keys, or local `.env` files.
- Review `manifest.json` permission changes carefully in every PR.
