# Application Archive

Creating an application creates a stable folder under `JCC-Data\Applications`. `MARK APPLIED` requires an application in `READY_TO_APPLY`, an exact CV version and, for multi-format versions, the exact physical file actually submitted.

## Exact physical CV selection

A CV version can register DOCX, PDF and Markdown preview files in `cv_version_files`. Before `MARK APPLIED`, JCC lists the files belonging to the selected version. The selected file is then:

- copied into the application folder as `submitted-cv.<ext>`;
- SHA-256 hashed;
- linked to the submitted CV version in SQLite;
- protected against overwrite;
- linked from the application/knowledge notes; and
- exposed through **OPEN CV USED**.

The latest clean JD snapshot and any final application artifacts are preserved alongside the submitted CV. Opening an application URL never marks it applied.

## Tailored child versions

The master CV document/version remains unchanged. Tailoring creates a child version and produces real local DOCX, PDF and Markdown files. JCC uses local renderers only; the DOCX/PDF outputs are available even when optional high-fidelity rendering packages are absent via standards-compliant local fallback writers.

After creation JCC reruns Senior Recruiter Match and ATS Exact against the tailored text and runs the Post-Tailor Verifier. Unsupported claims, employer/title/date/metric drift or other integrity failures prevent an APPLY recommendation.

If a different file was actually submitted, correct the record explicitly and preserve audit history rather than overwriting the immutable submitted snapshot.
