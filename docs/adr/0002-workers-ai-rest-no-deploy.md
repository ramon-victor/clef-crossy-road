# ADR-0002 · Workers AI through REST only, nothing deployed

- **Status:** accepted · **Date:** 2026-10-14

## Context and problem statement

The project needs decisions from Cloudflare's Workers AI models. The constraint is that nothing is deployed to Cloudflare: the only interaction is calling the Workers AI REST API from local processes.

## Considered options

- A Cloudflare Worker that calls the model through the `env.AI` binding: probably lower latency between the Worker and the model, but it needs a deployment and publishes an endpoint that spends neurons.
- Self-hosting the open weights (Apache 2.0): see [ADR-0006](0006-no-fine-tuning-no-self-host.md).
- Calling the REST API directly from local processes.

## Decision outcome

Chosen option: "call the REST API from local processes", because it needs no infrastructure and satisfies the no-deploy constraint.

- Requests are `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/{model}` with an API token, sent from Node (the benchmark CLI, through `@ccr/clef`) and from Rust (the desktop app).
- No Worker, no wrangler, no D1, KV or Durable Objects.
- The REST API wraps the answer in a `result` envelope that the Worker binding does not; `@ccr/clef` normalizes it.
- The token is read only by Node or Rust, never by the webview ([ADR-0007](0007-tauri-desktop-token-in-rust.md)), and every call is subject to the daily budget ([ADR-0008](0008-daily-budget-free-tier.md)).
- Request and response details are in [Clef API](../clef-api.md).

### Consequences

- Good, because there is no infrastructure to maintain and the only cost is tokens, which stay inside the free tier ([ADR-0008](0008-daily-budget-free-tier.md)).
- Bad, because the API token has to live on the machine running the project.
- Bad, because every decision includes the network round trip to Cloudflare; measured latency is in [Clef API](../clef-api.md).
- Bad, because the rate limit for Clef is undocumented.
