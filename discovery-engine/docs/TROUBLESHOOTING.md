# Troubleshooting

Start with `doctor.bat`. Doctor treats SQLite `PRAGMA integrity_check` as a required core check; if it is not `ok`, stop and report the error rather than copying database files manually. If the server fails to launch, inspect `<JCC_HOME>\JCC-Data\Logs\server.log`.

## Stop/start safety

`stop-jcc.bat` only signals a PID that can be verified as the JCC `src/server.mjs` process for the current repository. If it prints **REFUSED**, do not delete/kill processes blindly; report the message and the PID metadata. `start-jcc.bat` also refuses to launch if port 8787 is already serving an unexpected process/JCC version.

## Chromium

If Doctor reports Playwright installed but Chromium unavailable, run `npx playwright install chromium`, then rerun `doctor.bat`. Do not work around a website CAPTCHA/login challenge; mark the source MANUAL ONLY.

## Agent Reach

Agent Reach is optional. If unavailable, Doctor reports it as degraded but JCC continues through direct adapters, HTTP and Playwright. Do not add paid APIs to repair this fallback.

## Knowledge graph

A graph-index/SSE/WebGL/Obsidian-plugin problem is non-blocking. Core JCC must continue. Run `npm run init:local` to reconcile the vault/index, then reload `/knowledge-graph`. Never copy CV/JD bodies into `graph-index.json` while troubleshooting.

## Backup/restore

Use `backup-jcc.bat`. Restore always creates a safety backup of the current database first. If the safety backup fails, restore stops; do not manually copy SQLite files over a live JCC database.
