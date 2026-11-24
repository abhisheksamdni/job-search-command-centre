# Install / Upgrade (Windows)

Portable folder layout:
- code: `<JCC_HOME>\jcc-local`
- private runtime data: `<JCC_HOME>\JCC-Data`
- private knowledge vault: `<JCC_HOME>\JCC-Knowledge`

Prerequisites: Windows, Node.js 22+ and npm. Git is only required when installing from a repository rather than a portable package.

`install.bat` installs declared dependencies, installs Playwright Chromium where available, initializes/migrates SQLite, builds the knowledge vault/graph index, runs Doctor and runs the complete regression suite.

For alpha.3 → alpha.4, preserve the sibling private folders, take a JCC backup first, stop JCC cleanly, then fetch/reset the exact alpha.4 candidate SHA. Run `npm install`, `npm run init:local`, `npm test`, `npm run doctor`, then `start-jcc.bat`. Do not manually copy SQLite/WAL/SHM files.

Alpha.4 migration deduplicates target locations and seeds SYSTEM discovery sources. Repeated initialization must not create duplicate logical locations or sources.

Agent Reach remains optional. Missing Agent Reach does not fail core Doctor. CAPTCHA/login-protected sources are never bypassed.
