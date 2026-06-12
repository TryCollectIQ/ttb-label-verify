import React, { useCallback, useRef, useState } from "react";
import { verifyLabel, OFFICIAL_WARNING } from "./lib/compare.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Downscale the image client-side before upload. Keeps payloads small,
 * which keeps round-trips inside the ~5 second budget agents will tolerate,
 * and well under serverless body limits.
 */
async function prepareImage(file, maxEdge = 1568) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });

  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Not a valid image"));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

  const out = canvas.toDataURL("image/jpeg", 0.88);
  return { base64: out.split(",")[1], mediaType: "image/jpeg", preview: out };
}

async function extractFromImage(prepared) {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: prepared.base64, mediaType: prepared.mediaType }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Run async tasks with limited concurrency (batch mode). */
async function runPool(tasks, limit, onResult) {
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        const value = await tasks[idx]();
        onResult(idx, { ok: true, value });
      } catch (err) {
        onResult(idx, { ok: false, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

/** Minimal CSV parser for batch mode (filename,brand_name,class_type,abv,net_contents). */
function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  });
  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).filter((r) => r.some(Boolean)).map((r) => {
    const o = {};
    header.forEach((h, i) => (o[h] = r[i] || ""));
    return o;
  });
}

const SAMPLE = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
};

const VERDICT = {
  pass: { label: "APPROVED MATCH", cls: "pass" },
  note: { label: "REVIEW NOTES", cls: "note" },
  fail: { label: "MISMATCH", cls: "fail" },
};

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

function Stamp({ overall }) {
  const v = VERDICT[overall];
  return <span className={`stamp stamp-${v.cls}`}>{v.label}</span>;
}

function CheckRow({ check }) {
  const icon = check.result.status === "pass" ? "✓" : check.result.status === "note" ? "!" : "✕";
  return (
    <div className={`check-row status-${check.result.status}`}>
      <div className="check-head">
        <span className="check-icon" aria-hidden="true">{icon}</span>
        <span className="check-label">{check.label}</span>
        <span className="check-status">{check.result.status === "pass" ? "Match" : check.result.status === "note" ? "Review" : "Fail"}</span>
      </div>
      <div className="check-values">
        <div>
          <div className="value-tag">Application says</div>
          <div className="value-text">{check.applicationValue || "—"}</div>
        </div>
        <div>
          <div className="value-tag">Label says</div>
          <div className="value-text">{check.labelValue || "— not found —"}</div>
        </div>
      </div>
      <p className="check-detail">{check.result.detail}</p>
    </div>
  );
}

function ResultCard({ item }) {
  if (item.state === "working") {
    return (
      <div className="result-card">
        <div className="result-top">
          <strong>{item.name}</strong>
          <span className="working">Reading label…</span>
        </div>
      </div>
    );
  }
  if (item.state === "error") {
    return (
      <div className="result-card">
        <div className="result-top">
          <strong>{item.name}</strong>
          <span className="stamp stamp-fail">ERROR</span>
        </div>
        <p className="check-detail">{item.error} — try again or upload a clearer image.</p>
      </div>
    );
  }
  const { verification, extracted, elapsedMs, preview, application } = item;
  return (
    <div className="result-card">
      <div className="result-top">
        <strong>{item.name}</strong>
        <div className="result-meta">
          <span className="elapsed">{(elapsedMs / 1000).toFixed(1)}s</span>
          <Stamp overall={verification.overall} />
        </div>
      </div>
      {!application && (
        <p className="check-detail">
          No application record matched this file — showing extraction and warning compliance only.
        </p>
      )}
      <div className="result-body">
        {preview && <img className="thumb" src={preview} alt={`Label: ${item.name}`} />}
        <div className="checks">
          {verification.checks.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
          {extracted.image_quality !== "good" && extracted.quality_notes && (
            <p className="quality-note">Image quality: {extracted.quality_notes}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [mode, setMode] = useState("single");
  const [form, setForm] = useState(SAMPLE);
  const [files, setFiles] = useState([]);
  const [csvRows, setCsvRows] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);
  const csvInput = useRef(null);

  const setField = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const addFiles = useCallback(
    (list) => {
      const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
      if (!images.length) return;
      setFiles(mode === "single" ? [images[0]] : (prev) => [...prev, ...images]);
      setResults([]);
    },
    [mode]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const onCsv = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setCsvRows(parseCsv(await f.text()));
  };

  const matchCsvRow = (filename) =>
    csvRows?.find((r) => (r.filename || "").toLowerCase() === filename.toLowerCase()) || null;

  async function run() {
    if (!files.length || busy) return;
    setBusy(true);

    const initial = files.map((f) => ({ name: f.name, state: "working" }));
    setResults(initial);

    const tasks = files.map((file) => async () => {
      const prepared = await prepareImage(file);
      const { extracted, elapsedMs } = await extractFromImage(prepared);

      let application = null;
      if (mode === "single") {
        application = form;
      } else {
        const row = matchCsvRow(file.name);
        if (row) {
          application = {
            brandName: row.brand_name || "",
            classType: row.class_type || "",
            alcoholContent: row.abv || row.alcohol_content || "",
            netContents: row.net_contents || "",
          };
        }
      }

      const verification = verifyLabel(application || {}, extracted);
      return { verification, extracted, elapsedMs, preview: prepared.preview, application };
    });

    await runPool(tasks, 3, (idx, outcome) => {
      setResults((prev) => {
        const next = [...prev];
        next[idx] = outcome.ok
          ? { name: files[idx].name, state: "done", ...outcome.value }
          : { name: files[idx].name, state: "error", error: outcome.error };
        return next;
      });
    });

    setBusy(false);
  }

  const clearAll = () => {
    setFiles([]);
    setResults([]);
    setCsvRows(null);
    if (fileInput.current) fileInput.current.value = "";
    if (csvInput.current) csvInput.current.value = "";
  };

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-inner">
          <div>
            <div className="eyebrow">TTB Compliance Division · Prototype</div>
            <h1>LabelCheck</h1>
            <p className="tagline">
              Upload a label, compare it against the application, get a verdict in seconds.
              The AI reads the label — the rules decide.
            </p>
          </div>
        </div>
      </header>

      <main className="content">
        <div className="mode-switch" role="tablist" aria-label="Verification mode">
          <button
            role="tab"
            aria-selected={mode === "single"}
            className={mode === "single" ? "active" : ""}
            onClick={() => { setMode("single"); clearAll(); }}
          >
            Single label
          </button>
          <button
            role="tab"
            aria-selected={mode === "batch"}
            className={mode === "batch" ? "active" : ""}
            onClick={() => { setMode("batch"); clearAll(); }}
          >
            Batch upload
          </button>
        </div>

        <div className="workbench">
          <section className="panel">
            {mode === "single" ? (
              <>
                <h2>1 · Application data</h2>
                <p className="hint">What the applicant filed. The label must agree with this.</p>
                <label>
                  Brand name
                  <input value={form.brandName} onChange={setField("brandName")} />
                </label>
                <label>
                  Class / type designation
                  <input value={form.classType} onChange={setField("classType")} />
                </label>
                <label>
                  Alcohol content
                  <input value={form.alcoholContent} onChange={setField("alcoholContent")} />
                </label>
                <label>
                  Net contents
                  <input value={form.netContents} onChange={setField("netContents")} />
                </label>
              </>
            ) : (
              <>
                <h2>1 · Application records (optional CSV)</h2>
                <p className="hint">
                  Columns: <code>filename, brand_name, class_type, abv, net_contents</code>.
                  Rows are matched to images by filename. Without a CSV, each label gets
                  extraction + warning compliance only.
                </p>
                <button className="secondary" onClick={() => csvInput.current.click()}>
                  {csvRows ? `CSV loaded — ${csvRows.length} records` : "Choose CSV file"}
                </button>
                <input ref={csvInput} type="file" accept=".csv" hidden onChange={onCsv} />
              </>
            )}
          </section>

          <section className="panel">
            <h2>2 · Label image{mode === "batch" ? "s" : ""}</h2>
            <div
              className={`dropzone ${dragOver ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileInput.current.click()}
            >
              {files.length
                ? `${files.length} image${files.length > 1 ? "s" : ""} ready`
                : "Drop image here, or click to choose"}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple={mode === "batch"}
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <div className="actions">
              <button className="primary" onClick={run} disabled={!files.length || busy}>
                {busy ? "Checking…" : `Verify ${mode === "batch" && files.length > 1 ? `${files.length} labels` : "label"}`}
              </button>
              {files.length > 0 && (
                <button className="secondary" onClick={clearAll} disabled={busy}>
                  Clear
                </button>
              )}
            </div>
          </section>
        </div>

        {results.length > 0 && (
          <section className="results">
            <h2>Results</h2>
            {results.length > 1 && results.every((r) => r.state !== "working") && (
              <p className="hint">
                {results.filter((r) => r.state === "done" && r.verification.overall === "pass").length} approved ·{" "}
                {results.filter((r) => r.state === "done" && r.verification.overall === "note").length} need review ·{" "}
                {results.filter((r) => r.state === "done" && r.verification.overall === "fail").length} mismatched ·{" "}
                {results.filter((r) => r.state === "error").length} errors
              </p>
            )}
            {results.map((item, i) => (
              <ResultCard key={i} item={item} />
            ))}
          </section>
        )}

        <details className="reference">
          <summary>Official government warning text (27 CFR Part 16)</summary>
          <p className="value-text">{OFFICIAL_WARNING}</p>
        </details>
      </main>

      <footer className="footer">
        Prototype for evaluation only — not connected to COLA. No images or data are stored.
      </footer>
    </div>
  );
}
