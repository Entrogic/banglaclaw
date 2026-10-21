# ADR-0019: Model Providers Managed at Runtime

## Status

Accepted

## Context

The model provider came only from `models.default` in `banglaclaw.yaml` plus `BANGLACLAW_*` env overrides, and API keys came only from the environment (the config schema rejects them). Changing the model or adding a second provider (Gemini, Groq, a local Ollama) therefore meant editing files on the server and restarting it. Operators asked to do this from the admin dashboard. That requires storing provider API keys, the first secrets BanglaClaw would keep in its own database.

## Decision

- **Provider profiles in storage.** A `ProviderStore` (interface in `shared`; `InMemoryProviderStore`, `PostgresProviderStore` on a new `model_providers` table) holds named profiles: type, model, base URL, temperature and an optional API key. A partial unique index allows at most one active profile. With none active, the config/env provider is used as before, so existing deployments do not change.
- **Keys encrypted at rest with an environment secret.** `SecretBox` (auth package) uses AES-256-GCM under a key derived with HKDF-SHA256 from `BANGLACLAW_SECRET_KEY` (at least 32 characters, environment only). The profile id is the additional authenticated data, so a ciphertext copied to another row does not decrypt. The API returns only `hasApiKey` and a masked hint, never the key or its ciphertext. Audit events record only whether a key was given, and provider test errors have the key removed. Without the secret, profiles cannot hold a key; nothing is ever stored in plaintext. A profile without its own key may use the matching key from the environment, which allows switching models without re-entering keys.
- **`ProviderManager` owns "the current provider".** It lives in the providers package and implements `ProviderAdmin`, an interface in `shared`. It builds a profile with the same `createProvider` as config, validates profiles when they are saved or activated (`ProviderSetupError` → `400 invalid_provider`), and swaps the current provider in memory on a change. The gateway only validates HTTP input and calls `ProviderAdmin`, so it keeps no provider specifics (ADR-0005).
- **Switch per run, never mid-run.** `AgentRuntimeOptions.provider` may be a function. The runtime calls it once at the start of each run, so a switch applies from the next run and one run never mixes models. The agent package needs no other change.
- **Fail safe at startup.** If the active profile cannot be built (missing or changed secret, undecryptable key), startup logs a warning and uses the config provider instead of refusing to start. With an active profile, the config provider's key is no longer required.

## Consequences

Positive:
- Admins add, test and switch providers from the dashboard or `/v1/admin/providers` without a restart
- Existing config-only deployments behave exactly as before

Trade-offs:
- BanglaClaw now stores secrets: database dumps hold ciphertexts whose safety rests on `BANGLACLAW_SECRET_KEY`. Rotating that key is manual (enter the keys again); there is no re-encryption command yet
- Other gateway processes sharing the database apply a switch only when they restart
- Admins decide where prompts are sent, including internal base URLs; the admin role must be trusted accordingly
