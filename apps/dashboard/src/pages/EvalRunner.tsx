import { useEffect, useState, type FormEvent } from "react";
import { BanglaClawApiError, type EvalDataset, type EvalJob, type EvalMetricName, type ProviderProfile } from "@entrogic-net/client";
import sample from "../../../../evals/deepeval/datasets/sample.yaml?raw";
import { errorMessage, useAsync, useAuth } from "../api";
import { fmtInt, fmtRelative } from "../format";
import { Link } from "../router";

const METRICS: { id: EvalMetricName; label: string; judge: boolean; hint: string }[] = [
  { id: "correctness", label: "Correctness", judge: true, hint: "against expected_output" },
  { id: "answer_relevancy", label: "Answer relevancy", judge: true, hint: "answers the question" },
  { id: "fluency", label: "Bangla fluency", judge: true, hint: "natural Bangla / Banglish / English" },
  { id: "conversation", label: "Conversation", judge: true, hint: "goldens with turns" },
  { id: "tool_correctness", label: "Tool correctness", judge: false, hint: "against expected_tools" },
  { id: "language_match", label: "Language match", judge: false, hint: "replies in the user's language" },
];
const DEFAULT_METRICS: EvalMetricName[] = ["correctness", "answer_relevancy", "conversation", "tool_correctness", "language_match"];

/** Disabled on gateways without a dataset store or runner. */
const orNull = <T,>(p: Promise<T>) =>
  p.catch((err: unknown) => {
    if (err instanceof BanglaClawApiError && (err.code === "evals_disabled" || err.code === "providers_disabled")) return null;
    throw err;
  });

/**
 * Runs stored datasets through the agent from the dashboard (ADR-0020): pick a dataset, a judge
 * and metrics; progress is polled until the run is recorded.
 */
export function EvalRunner({ onRecorded }: { onRecorded: () => void }) {
  const { client } = useAuth();
  const { data, error, reload } = useAsync(() => Promise.all([orNull(client.admin.evalDatasets()), orNull(client.admin.evalJobs()), orNull(client.admin.providers())]), [client]);
  if (error !== undefined) return <p className="error" role="alert">{error}</p>;
  if (data === undefined) return null;
  const [datasets, jobs, providers] = data;
  if (datasets === null || jobs === null) return null;
  return (
    <>
      <RunForm datasets={datasets.datasets} profiles={providers?.providers ?? []} agentModel={providers?.active.providerId} running={jobs.jobs.find((j) => j.status === "running")} onChange={reload} onRecorded={onRecorded} />
      <Datasets datasets={datasets.datasets} onChange={reload} />
    </>
  );
}

function RunForm(props: { datasets: EvalDataset[]; profiles: ProviderProfile[]; agentModel: string | undefined; running: EvalJob | undefined; onChange: () => void; onRecorded: () => void }) {
  const { client } = useAuth();
  const [datasetId, setDatasetId] = useState("");
  const [judge, setJudge] = useState("");
  const [judgeLanguage, setJudgeLanguage] = useState<"bn" | "en">("bn");
  const [metrics, setMetrics] = useState<EvalMetricName[]>(DEFAULT_METRICS);
  const [error, setError] = useState<string | undefined>(undefined);
  const [job, setJob] = useState<EvalJob | undefined>(props.running);
  const chosen = datasetId || props.datasets[0]?.id || "";
  const needsJudge = metrics.some((m) => METRICS.find((x) => x.id === m)?.judge === true);

  // Poll the job until it ends.
  useEffect(() => {
    if (job === undefined || job.status !== "running") return;
    const timer = setInterval(() => {
      client.admin.evalJob(job.id).then(
        ({ job: next }) => {
          setJob(next);
          if (next.status !== "running") {
            props.onChange();
            if (next.status === "completed") props.onRecorded();
          }
        },
        (err: unknown) => setError(errorMessage(err)),
      );
    }, 1_000);
    return () => clearInterval(timer);
    // props callbacks are stable enough for a poll; restart only for a new job.
  }, [client, job?.id, job?.status]);

  const toggle = (m: EvalMetricName) => setMetrics((all) => (all.includes(m) ? all.filter((x) => x !== m) : [...all, m]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const res = await client.admin.startEval({ datasetId: chosen, metrics, judgeLanguage, ...(judge !== "" && { judgeProviderId: judge }) });
      setJob(res.job);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const running = job?.status === "running";
  return (
    <form className="card create-key" onSubmit={submit} aria-label="Run an eval">
      <h3>Run an eval</h3>
      {props.datasets.length === 0 ? (
        <p className="muted">Add a dataset below first.</p>
      ) : (
        <>
          <div className="form-row">
            <label className="field">
              <span>Dataset</span>
              <select value={chosen} onChange={(e) => setDatasetId(e.target.value)}>
                {props.datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.goldenCount})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Judge model</span>
              <select value={judge} onChange={(e) => setJudge(e.target.value)} disabled={!needsJudge}>
                <option value="">Agent's provider{props.agentModel !== undefined ? ` (${props.agentModel})` : ""}</option>
                {props.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Judge prompts</span>
              <select value={judgeLanguage} onChange={(e) => setJudgeLanguage(e.target.value as "bn" | "en")} disabled={!needsJudge}>
                <option value="bn">বাংলা</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          <fieldset className="field metrics-pick">
            <legend>Metrics</legend>
            {METRICS.map((m) => (
              <label key={m.id} className="check" title={m.hint}>
                <input type="checkbox" checked={metrics.includes(m.id)} onChange={() => toggle(m.id)} /> {m.label}
              </label>
            ))}
          </fieldset>
          <div className="form-row">
            <button className="button primary" type="submit" disabled={running || metrics.length === 0}>
              {running ? "Running…" : "Start eval"}
            </button>
            {running && job !== undefined && (
              <button className="button ghost danger" type="button" onClick={() => client.admin.cancelEval(job.id).then(({ job: next }) => setJob(next), (err: unknown) => setError(errorMessage(err)))}>
                Cancel
              </button>
            )}
          </div>
          <p className="muted small">Every golden runs through the live agent{needsJudge ? ", and each judge metric is one more model call" : ""}, so an eval costs real tokens. One eval runs at a time.</p>
        </>
      )}
      {job !== undefined && <JobStatus job={job} />}
      {error !== undefined && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

function JobStatus({ job }: { job: EvalJob }) {
  const pct = job.total === 0 ? 0 : Math.round((job.done / job.total) * 100);
  return (
    <div className="job-status" role="status">
      <div className="progress" aria-label={`${job.done} of ${job.total} goldens`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="small">
        {job.status === "running" && `${fmtInt(job.done)}/${fmtInt(job.total)} goldens · ${fmtInt(job.passed)} passed so far`}
        {job.status === "completed" && job.evalId !== undefined && (
          <>
            ✓ {fmtInt(job.passed)}/{fmtInt(job.total)} passed · <Link to={`/evals/${job.evalId}`}>Open the run</Link>
          </>
        )}
        {job.status === "cancelled" && "Cancelled; nothing was recorded."}
        {job.status === "failed" && <span className="error-text">✕ {job.error ?? "Failed"}</span>}
      </span>
    </div>
  );
}

function Datasets({ datasets, onChange }: { datasets: EvalDataset[]; onChange: () => void }) {
  const { client } = useAuth();
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(datasets.length === 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await client.admin.createEvalDataset({ name: name.trim(), source });
      setName("");
      setSource("");
      setOpen(false);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const readFile = (file: File | undefined) => {
    if (file === undefined) return;
    file.text().then((text) => {
      setSource(text);
      if (name.trim() === "") setName(file.name.replace(/\.(ya?ml|json)$/i, ""));
    }, (err: unknown) => setError(errorMessage(err)));
  };

  return (
    <section className="card flush">
      <div className="card-head pad">
        <h3>Datasets</h3>
        <button className="button ghost" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add dataset"}
        </button>
      </div>
      {open && (
        <form className="pad dataset-form" onSubmit={submit} aria-label="Add a dataset">
          <div className="form-row">
            <label className="field">
              <span>Name</span>
              <input required maxLength={100} placeholder="nightly-bn" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>From a file</span>
              <input type="file" accept=".yaml,.yml,.json" onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
            <button
              className="button ghost"
              type="button"
              onClick={() => {
                setSource(sample);
                if (name.trim() === "") setName("sample");
              }}
            >
              Use the sample
            </button>
          </div>
          <label className="field">
            <span>Goldens (YAML or JSON, the format of evals/deepeval datasets)</span>
            <textarea required rows={10} spellCheck={false} className="mono" value={source} onChange={(e) => setSource(e.target.value)} placeholder={"goldens:\n  - name: capital-bn\n    input: বাংলাদেশের রাজধানীর নাম কী?\n    expected_output: ঢাকা"} />
          </label>
          <div className="form-row">
            <button className="button primary" type="submit" disabled={busy || name.trim() === "" || source.trim() === ""}>
              {busy ? "Saving…" : "Save dataset"}
            </button>
          </div>
          {error !== undefined && <p className="error" role="alert">{error}</p>}
        </form>
      )}
      {datasets.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Goldens</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <DatasetRow key={d.id} d={d} onDelete={() => client.admin.deleteEvalDataset(d.id).then(onChange, (err: unknown) => setError(errorMessage(err)))} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DatasetRow({ d, onDelete }: { d: EvalDataset; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <tr>
      <td>
        {d.name} {d.description !== undefined && <span className="muted small">{d.description}</span>}
      </td>
      <td className="num">{fmtInt(d.goldenCount)}</td>
      <td title={d.updatedAt}>{fmtRelative(d.updatedAt)}</td>
      <td className="actions">
        {confirm ? (
          <span className="confirm">
            <button className="button danger" type="button" onClick={onDelete}>
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
  );
}
