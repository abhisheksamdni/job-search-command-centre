# Sharing JCC safely

Do not send the working JCC home folder. It contains private candidate data and application history.

From `jcc-local`, run `npm run release:portable`. This creates a versioned folder under sibling `Releases` from an explicit source allow-list and writes `SHA256SUMS.txt`. The package excludes `JCC-Data`, `JCC-Knowledge`, `Job Applications`, CVs, application artifacts, databases, logs, secrets, browser state, `node_modules` and Git history.

Zip the generated folder and send only that ZIP. The recipient should:

1. Extract the ZIP to a normal writable local folder.
2. Install Node.js 22 LTS or newer if necessary.
3. Double-click `INSTALL-JCC.bat` while connected to the internet.
4. Wait for Doctor and the complete regression suite to pass.
5. Double-click `START-JCC.bat` and open `http://127.0.0.1:8787`.
6. Import their own Master CV and configure their own target roles, locations and sources.

JCC creates new sibling private-data folders inside the extracted JCC home. The package contains no sender profile or application database. Websites can change or present login/CAPTCHA challenges, so source-specific warnings such as **MANUAL ONLY** are expected and are not bypassed.
