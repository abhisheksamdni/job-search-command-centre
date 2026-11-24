# Search Supervisor Agent

A lightweight deterministic orchestration contract for the existing discovery runtime. It consumes the `search-supervisor` skill and persisted discovery telemetry; it is not a separate autonomous-agent framework.

Pre-flight validates local runtime prerequisites. During a run it exposes heartbeat, current source/query/layer, counters, source circuit breakers, safe cancellation and time-budget state. Post-run it reports explicit completion/partial/failure status and source/attempt breakdown. It never uses an LLM to decide process health and never crosses JCC's manual application or manual-send boundaries.

See [[Search Supervisor]] and [[Discovery Agent]].
