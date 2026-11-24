# Live Knowledge Graph

The durable knowledge source is the normal Markdown vault at `<JCC_HOME>\JCC-Knowledge`. JCC does **not** maintain a competing graph database.

## Built-in dashboard graph

Open `http://127.0.0.1:8787/knowledge-graph` or choose **KNOWLEDGE GRAPH** from the dashboard. The local `3d-force-graph` dependency renders the derived graph with rotate/zoom/pan, hover labels, search, cluster filters, focus/reset and fullscreen controls.

JCC parses frontmatter and `[[wikilinks]]` into:

`<JCC_HOME>\JCC-Data\graph\graph-index.json`

The index contains stable IDs, labels/groups, selected operational metadata, JCC routes and links only. Full CV and JD bodies are excluded by design and regression test.

## Live update flow

1. A JCC event updates the relevant Markdown note.
2. The note emits local `knowledge:changed`.
3. The graph indexer reconciles the vault into `graph-index.json`.
4. Open graph pages receive the new read-model over Server-Sent Events without refresh.
5. A filesystem watcher catches manual/Obsidian Markdown edits.
6. Startup and periodic full reconciliation provide a safety net.

Relevant jobs discovered during **RUN SEARCH NOW** can therefore appear in an already-open graph. Application status updates mutate the existing stable application node rather than creating status duplicates.

## Failure isolation

Graph generation, index writes, filesystem watching, SSE clients, WebGL rendering and optional Obsidian plugins are visualization/read-model concerns. Their failure must never prevent JCC core health, discovery, Recruiter Match, ATS Exact, tailoring, manual application tracking or backup/restore. This behavior is covered by regression tests.

## Relationships

Typical paths include:

- `Source → Adapter → Discovery → Job`
- `Job → Application → Submitted CV`
- `Interview → Application → Job → Submitted CV`
- `Senior Recruiter → JD Cleaner / Evidence Ledger / Active CV`
- `Skill → dependencies / dependents`

## Obsidian remains available

`open-knowledge.bat` opens the same vault. For an additional Obsidian-native 3D view, optionally install **New 3D Graph** (`Apoo711/obsidian-3d-graph`). If unavailable, use **Three D Graph View** (`Roasted-NZ/obsidian-3d-graph-view`). These plugins are optional and not part of JCC runtime health.

Only meaningful entities become graph nodes. Raw logs and trivial database rows stay outside the graph. The populated vault and graph index remain private local data; sanitized visualization guidance lives under `templates/knowledge-vault/`.
