import { useState, type FormEvent } from "react";
import type { ProviderList, ProviderProfile, ProviderTestResult } from "@entrogic-net/client";
import { errorMessage, useAsync, useAuth } from "../api";
import { fmtRelative } from "../format";

type Kind = ProviderProfile["provider"];

/** Common endpoints; any OpenAI-compatible server works with its own base URL. */
const PRESETS: { label: string; provider: Kind; baseUrl?: string; model: string; key: boolean }[] = [
  { label: "OpenAI", provider: "openai-compatible", model: "gpt-4o-mini", key: true },
  { label: "Anthropic", provider: "anthropic", model: "claude-sonnet-5", key: true },
  { label: "Google Gemini", provider: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.5-flash", key: true },
  { label: "Groq", provider: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", key: true },
  { label: "OpenRouter", provider: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", key: true },
  { label: "DeepSeek", provider: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", key: true },
  { label: "Ollama (local)", provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "qwen3", key: false },
];

const KIND_LABEL: Record<Kind, string> = { "openai-compatible": "OpenAI-compatible", anthropic: "Anthropic" };

/** Model providers added at runtime (ADR-0019): new runs use the active one, or the config provider. */
export function Providers() {
  const { client } = useAuth();
  const { data, error, reload } = useAsync(() => client.admin.providers(), [client]);

  if (error !== undefined) return <p className="error" role="alert">{error}</p>;
  if (data === undefined) return <p className="muted">Loading…</p>;
  return (
    <>
      <Status data={data} />
      <AddProvider encryption={data.encryption} onAdded={reload} />
      <ProviderTable data={data} reload={reload} />
    </>
  );
}

function Status({ data }: { data: ProviderList }) {
  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-label">New runs use</div>
        <div className="stat-value small-value">{data.active.source === "stored" ? data.active.name : "Config provider"}</div>
        <div className="muted small mono">{data.active.providerId}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Storage</div>
        <div className="stat-value small-value">{data.persistent ? "Postgres" : "Memory"}</div>
        <div className="muted small">{data.persistent ? "Kept across restarts" : "Lost on restart"}</div>
      </div>
      <div className="stat">
        <div className="stat-label">API key encryption</div>
        <div className="stat-value small-value">{data.encryption ? "On" : "Off"}</div>
        <div className="muted small">{data.encryption ? "AES-256-GCM with BANGLACLAW_SECRET_KEY" : "Set BANGLACLAW_SECRET_KEY to store keys"}</div>
      </div>
    </div>
  );
}

function AddProvider({ encryption, onAdded }: { encryption: boolean; onAdded: () => void }) {
  const { client } = useAuth();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Kind>("openai-compatible");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [presetLabel, setPresetLabel] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const preset = (label: string) => {
    const p = PRESETS.find((x) => x.label === label);
    if (p === undefined) return;
    setPresetLabel(label);
    setProvider(p.provider);
    setBaseUrl(p.baseUrl ?? "");
    setModel(p.model);
    if (name.trim() === "") setName(p.label);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await client.admin.createProvider({
        name: name.trim(),
        provider,
        model: model.trim(),
        ...(baseUrl.trim() !== "" && { baseUrl: baseUrl.trim() }),
        ...(temperature.trim() !== "" && { temperature: Number(temperature) }),
        ...(apiKey.trim() !== "" && { apiKey: apiKey.trim() }),
      });
      setName("");
      setModel("");
      setBaseUrl("");
      setTemperature("");
      setApiKey("");
      setPresetLabel("");
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card create-key" onSubmit={submit} aria-label="Add a provider">
      <h3>Add a provider</h3>
      <div className="form-row">
        <label className="field">
          <span>Start from</span>
          <select value={presetLabel} onChange={(e) => preset(e.target.value)}>
            <option value="" disabled>
              Choose a preset…
            </option>
            {PRESETS.map((p) => (
              <option key={p.label}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input required maxLength={100} placeholder="Claude (prod)" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Type</span>
          <select value={provider} onChange={(e) => setProvider(e.target.value as Kind)}>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <input required maxLength={200} placeholder="gpt-4o-mini" value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
      </div>
      <div className="form-row">
        <label className="field grow">
          <span>Base URL (optional)</span>
          <input type="url" maxLength={500} placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </label>
        <label className="field">
          <span>Temperature</span>
          <input type="number" min={0} max={2} step={0.1} placeholder="default" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        </label>
        <label className="field grow">
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            maxLength={1000}
            placeholder={encryption ? "Stored encrypted, never shown again" : "Needs BANGLACLAW_SECRET_KEY"}
            disabled={!encryption}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <button className="button primary" type="submit" disabled={busy || name.trim() === "" || model.trim() === ""}>
          {busy ? "Adding…" : "Add provider"}
        </button>
      </div>
      <p className="muted small">Without an API key, the profile uses OPENAI_API_KEY or ANTHROPIC_API_KEY from the server environment, or none for a local server. Adding does not switch: choose “Use” below.</p>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

function ProviderTable({ data, reload }: { data: ProviderList; reload: () => void }) {
  const { client } = useAuth();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const [tests, setTests] = useState<Record<string, ProviderTestResult | "running">>({});
  const [error, setError] = useState<string | undefined>(undefined);

  const act = (fn: () => Promise<unknown>) => {
    setError(undefined);
    fn().then(reload, (err: unknown) => setError(errorMessage(err)));
  };
  const test = (id: string) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    client.admin.testProvider(id).then(
      ({ result }) => setTests((t) => ({ ...t, [id]: result })),
      (err: unknown) => setTests((t) => ({ ...t, [id]: { ok: false, latencyMs: 0, error: errorMessage(err) } })),
    );
  };

  return (
    <section className="card flush">
      <div className="card-head pad">
        <h3>Providers</h3>
      </div>
      {error !== undefined && <p className="error pad" role="alert">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Model</th>
            <th>API key</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Config provider <span className="muted small">banglaclaw.yaml / env</span> {data.active.source === "config" && <span className="badge good">In use</span>}
            </td>
            <td colSpan={4} className="muted">
              {data.active.source === "config" ? <span className="mono">{data.active.providerId}</span> : "Used when no profile is active"}
            </td>
            <td className="actions">
              {data.active.source !== "config" && (
                <button className="button" type="button" onClick={() => act(() => client.admin.activateProvider(null))}>
                  Use
                </button>
              )}
            </td>
          </tr>
          {data.providers.map((p) => (
            <ProviderRow
              key={p.id}
              p={p}
              editing={editing === p.id}
              test={tests[p.id]}
              onUse={() => act(() => client.admin.activateProvider(p.id))}
              onTest={() => test(p.id)}
              onEdit={() => setEditing(editing === p.id ? undefined : p.id)}
              onDelete={() => act(() => client.admin.deleteProvider(p.id))}
              onSaved={() => {
                setEditing(undefined);
                reload();
              }}
              encryption={data.encryption}
            />
          ))}
        </tbody>
      </table>
      {data.providers.length === 0 && <p className="muted pad">No providers added yet. Runs use the config provider.</p>}
    </section>
  );
}

function ProviderRow(props: {
  p: ProviderProfile;
  editing: boolean;
  test: ProviderTestResult | "running" | undefined;
  encryption: boolean;
  onUse: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const { p, test } = props;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <tr>
        <td>
          {p.name} {p.active && <span className="badge good">In use</span>}
        </td>
        <td>{KIND_LABEL[p.provider]}</td>
        <td>
          <span className="mono">{p.model}</span>
          {p.baseUrl !== undefined && <div className="muted small mono">{p.baseUrl}</div>}
        </td>
        <td className="mono">{p.apiKeyHint ?? <span className="muted">from env / none</span>}</td>
        <td title={p.updatedAt}>{fmtRelative(p.updatedAt)}</td>
        <td className="actions">
          {!p.active && (
            <button className="button" type="button" onClick={props.onUse}>
              Use
            </button>
          )}
          <button className="button ghost" type="button" disabled={test === "running"} onClick={props.onTest}>
            {test === "running" ? "Testing…" : "Test"}
          </button>
          <button className="button ghost" type="button" aria-expanded={props.editing} onClick={props.onEdit}>
            Edit
          </button>
          {confirm ? (
            <span className="confirm">
              <button className="button danger" type="button" onClick={props.onDelete}>
                Confirm delete
              </button>
              <button className="button ghost" type="button" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="button ghost danger" type="button" onClick={() => setConfirm(true)}>
              Delete
            </button>
          )}
        </td>
      </tr>
      {test !== undefined && test !== "running" && (
        <tr className="subrow">
          <td colSpan={6} role="status" className={test.ok ? undefined : "error-text"}>
            {test.ok ? `✓ Answered in ${test.latencyMs} ms${test.reply ? `: “${test.reply}”` : ""}` : `✗ ${test.error ?? "Failed"}`}
          </td>
        </tr>
      )}
      {props.editing && (
        <tr className="subrow">
          <td colSpan={6}>
            <EditProvider p={p} encryption={props.encryption} onSaved={props.onSaved} />
          </td>
        </tr>
      )}
    </>
  );
}

function EditProvider({ p, encryption, onSaved }: { p: ProviderProfile; encryption: boolean; onSaved: () => void }) {
  const { client } = useAuth();
  const [model, setModel] = useState(p.model);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const [temperature, setTemperature] = useState(p.temperature?.toString() ?? "");
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await client.admin.updateProvider(p.id, {
        model: model.trim(),
        baseUrl: baseUrl.trim() === "" ? null : baseUrl.trim(),
        temperature: temperature.trim() === "" ? null : Number(temperature),
        ...(removeKey ? { apiKey: null } : apiKey.trim() !== "" && { apiKey: apiKey.trim() }),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-row" onSubmit={submit} aria-label={`Edit ${p.name}`}>
      <label className="field">
        <span>Model</span>
        <input required maxLength={200} value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="field grow">
        <span>Base URL</span>
        <input type="url" maxLength={500} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="field">
        <span>Temperature</span>
        <input type="number" min={0} max={2} step={0.1} placeholder="default" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
      </label>
      <label className="field grow">
        <span>New API key</span>
        <input type="password" autoComplete="off" maxLength={1000} placeholder={p.hasApiKey ? "Leave blank to keep" : "None stored"} disabled={!encryption || removeKey} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </label>
      {p.hasApiKey && (
        <label className="check">
          <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} /> Remove stored key
        </label>
      )}
      <button className="button primary" type="submit" disabled={busy || model.trim() === ""}>
        {busy ? "Saving…" : "Save"}
      </button>
      {error !== undefined && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
