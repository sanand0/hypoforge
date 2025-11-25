import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { parse } from "https://cdn.jsdelivr.net/npm/partial-json@0.1.7/+esm";
import saveform from "https://cdn.jsdelivr.net/npm/saveform@1.2";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import sqlite3InitModule from "https://esm.sh/@sqlite.org/sqlite-wasm@3.46.1-build3";
import config, { configs } from "./config.js";
let activeMode = 'hypotheses';
const activeConfig = () => configs[activeMode];

const pyodideWorker = new Worker("./pyworker.js", { type: "module" });

const get = document.getElementById.bind(document);
const [
  $demoList,
  $fileUpload,
  $datasetPreview,
  $previewLoading,
  $previewTable,
  $contextSection,
  $analysisContext,
  $hypotheses,
  $synthesis,
  $synthesisResult,
  $status,
  $modeling,
  $modelResults,
  $modelStatus,
  $modelControls,
  $modelExperiments,
  $quality,
  $qualityResults,
  $qualityStatus,
  $qualityControls,
  $qualityAgents,
] = [
  "demo-list",
  "file-upload",
  "dataset-preview",
  "preview-loading",
  "preview-table",
  "context-section",
  "analysis-context",
  "hypotheses",
  "synthesis",
  "synthesis-result",
  "status",
  "modeling",
  "model-results",
  "model-status",
  "model-controls",
  "model-experiments",
  "quality",
  "quality-results",
  "quality-status",
  "quality-controls",
  "quality-agents",
].map(get);
const loading = `<div class="text-center my-5"><div class="spinner-border" role="status"></div></div>`;

let data, description, hypotheses, currentDemo;
let modelingExperiments;
let qualityPlans;
let lastCleanedCSV = "";
let qualitySnapshots = [];

const DEFAULT_BASE_URLS = [
  "https://api.openai.com/v1",
  "https://llmfoundry.straivedemo.com/openai/v1",
  "https://llmfoundry.straive.com/openai/v1",
];

async function* llm(body, options = {}) {
  const { apiKey, baseUrl } = await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS });
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      model: document.getElementById("model").value,
      stream: true,
      stream_options: { include_usage: true },
    }),
  };
  if (apiKey) request.headers.Authorization = `Bearer ${apiKey}`;
  else request.credentials = "include";
  if (options.signal) request.signal = options.signal;
  for await (const event of asyncLLM(`${baseUrl}/chat/completions`, request)) yield event;
}

const stream = async (body, fn) => {
  for await (const { content } of llm(body)) if (content) fn(content);
};

const on = (id, fn) => {
  const el = get(id);
  if (el) el.addEventListener("click", fn);
};

const buildBody = (messages, response_format) => ({
  messages,
  ...(response_format ? { response_format } : {}),
});

const extractLastPython = (text) =>
  (Array.from(text.matchAll(/```python\n*([\s\S]*?)\n```(?:\n|$)/g)).at(-1) || [])[1] || null;

async function runPython({ code, data, context }) {
  return new Promise((resolve) => {
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const listener = (event) => {
      if (event.data?.id !== id) return;
      pyodideWorker.removeEventListener("message", listener);
      resolve(event.data);
    };
    pyodideWorker.addEventListener("message", listener);
    pyodideWorker.postMessage({ id, code, data, context });
  });
}

const setHTML = (el, md) => {
  try {
    el.innerHTML = marked.parse(md);
  } catch {
    el.textContent = md;
  }
};

saveform("#hypoforge-settings", { exclude: "[type=\"file\"]" });

on("openai-config-btn", async () => {
  await openaiConfig({ defaultBaseUrls: DEFAULT_BASE_URLS, show: true });
});

const marked = new Marked();
marked.use({
  renderer: {
    table(header, body) {
      return `<table class="table table-sm">${header}${body}</table>`;
    },
    code(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      const content = hljs.highlight(code, { language }).value.trim();
      return `<pre class="hljs language-${language}"><code>${content}</code></pre>`;
    },
  },
});

$status.innerHTML = loading;
const { demos } = await fetch("config.json").then((r) => r.json());
$demoList.innerHTML += demos
  .map(
    ({ title, body }, index) => `
      <li><a class="dropdown-item demo-item text-wrap" href="#" data-index="${index}">
        <strong>${title}</strong><br>
        <small class="text-muted">${body}</small>
      </a></li>
    `,
  )
  .join("");

const $analysisPrompt = document.getElementById("analysis-prompt");
if ($analysisPrompt && activeConfig()?.defaults?.codeSystemPrompt) {
  $analysisPrompt.value = activeConfig().defaults.codeSystemPrompt;
}

const numFormat = new Intl.NumberFormat("en-US", {
  style: "decimal",
  notation: "compact",
  compactDisplay: "short",
});
const num = (val) => numFormat.format(val);
const dateFormat = d3.timeFormat("%Y-%m-%d %H:%M:%S");




const describe = (data, col) => {
  const values = data.map((d) => d[col]);
  const firstVal = values[0];
  if (typeof firstVal === "string") {
    const freqMap = d3.rollup(
      values.filter((v) => v),
      (v) => v.length,
      (d) => d,
    );
    const topValues = Array.from(freqMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([val, count]) => `${val.length > 100 ? val.slice(0, 100) + "..." : val} (${count})`);
    return `string. ${[...freqMap.keys()].length} unique values. E.g. ${topValues.join(", ")}`;
  } else if (typeof firstVal === "number") {
    return `numeric. mean: ${num(d3.mean(values))} min: ${num(d3.min(values))} max: ${num(d3.max(values))}`;
  } else if (firstVal instanceof Date) {
    return `date. min: ${dateFormat(d3.min(values))} max: ${dateFormat(d3.max(values))}`;
  }
  return "";
};

const testButton = (index) =>
  `<button type="button" class="btn btn-sm btn-primary test-hypothesis" data-index="${index}">Test</button>`;

async function loadData(demo) {
  if (demo.href.match(/\.(sqlite3|sqlite|db|s3db|sl3)$/i)) {
    const response = await fetch(demo.href);
    const buffer = await response.arrayBuffer();
    const dbName = demo.href.split("/").pop();
    await sqlite3.capi.sqlite3_js_posix_create_file(dbName, new Uint8Array(buffer));
    const uploadDB = new sqlite3.oo1.DB(dbName, "r");
    const tables = uploadDB.exec("SELECT name FROM sqlite_master WHERE type='table'", { rowMode: "object" });
    if (!tables.length) {
      throw new Error("No tables found in database");
    }
    const tableName = tables[0].name;
    const result = uploadDB.exec(`SELECT * FROM "${tableName}"`, { rowMode: "object" });
    uploadDB.close();
    return result;
  } else if (demo.href.match(/\.xlsx$/i)) {
    const buffer = await fetch(demo.href).then((r) => r.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "array" });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    return d3.csvParse(csv, d3.autoType);
  }
  return d3.csv(demo.href, d3.autoType);
}

function clearDataAndUI() {
  $hypotheses.innerHTML = "";
  $synthesis.classList.add("d-none");

  $contextSection.classList.add("d-none");
  $datasetPreview.classList.add("d-none");

  $previewTable.querySelector("thead").innerHTML = "";
  $previewTable.querySelector("tbody").innerHTML = "";
}

function showDataLoading() {
  clearDataAndUI();
  $datasetPreview.classList.remove("d-none");
  $previewLoading.classList.remove("d-none");
}

function renderPreview(data, maxRows = 100) {
  if (!data || !data.length) return;

  const columns = Object.keys(data[0]);
  const rows = data.slice(0, maxRows);

  const thead = $previewTable.querySelector("thead");
  const tbody = $previewTable.querySelector("tbody");

  thead.innerHTML = `<tr>${columns.map((col) => `<th>${col}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows
    .map((row) => `<tr>${columns.map((col) => `<td>${row[col] ?? ""}</td>`).join("")}</tr>`)
    .join("");

  $previewLoading.classList.add("d-none");
  $datasetPreview.classList.remove("d-none");
  $contextSection.classList.remove("d-none");
}

let qualityBaselineScore = null;
function computeQualityScore(rows) {
  try {
    if (!rows || !rows.length) return 0;
    const cols = Object.keys(rows[0] || {});
    const n = rows.length;
    if (!cols.length) return 0;
    const missRatios = cols.map((c) => {
      const m = rows.reduce((acc, r) => acc + (r[c] === null || r[c] === undefined || r[c] === '' ? 1 : 0), 0);
      return n ? m / n : 0;
    });
    const completeness = 1 - d3.mean(missRatios);
    const typeConsistency = d3.mean(
      cols.map((c) => {
        const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== '');
        if (!vals.length) return 0.5;
        const key = (v) => (v instanceof Date ? 'date' : typeof v);
        const cnt = new Map();
        for (const v of vals) cnt.set(key(v), (cnt.get(key(v)) || 0) + 1);
        let maxc = 0;
        for (const v of cnt.values()) maxc = Math.max(maxc, v);
        return maxc / vals.length;
      }),
    );
    const uniqueRatios = cols.map((c) => {
      const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined);
      const uniq = new Set(vals.map((v) => (v instanceof Date ? v.getTime() : String(v)))).size;
      return vals.length ? uniq / vals.length : 0;
    });
    const uniqueness = d3.max(uniqueRatios);
    const score = 100 * (0.5 * completeness + 0.3 * typeConsistency + 0.2 * uniqueness);
    return Math.round(Math.max(0, Math.min(100, score)));
  } catch (e) {
    return 0;
  }
}

function updateQualityOverview() {
  try {
    const score = computeQualityScore(data);
    const el = document.getElementById('quality-score');
    if (el) {
      const delta = qualityBaselineScore != null ? score - qualityBaselineScore : 0;
      el.textContent = `Quality Score: ${score}${qualityBaselineScore != null && delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`;
    }
  } catch {}
}

$demoList.addEventListener("click", async (e) => {
  e.preventDefault();
  const $demo = e.target.closest(".demo-item");
  if (!$demo) return;

  showDataLoading();
  currentDemo = demos[+$demo.dataset.index];
  data = await loadData(currentDemo);
  renderPreview(data);

  $analysisContext.value = currentDemo.audience;
});


function buildDescription() {
  if (!data || !data.length) return "";
  const columnDescription = Object.keys(data[0])
    .map((col) => `- ${col}: ${describe(data, col)}`)
    .join("\n");
  const numColumns = Object.keys(data[0]).length;
  return `The Pandas DataFrame df has ${data.length} rows and ${numColumns} columns:\n${columnDescription}`;
}

function guessTarget(rows, context = "") {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const columns = Object.keys(rows[0] || {});
    if (!columns.length) return null;
    const lc = columns.map((c) => c.toLowerCase());
    const ctx = String(context || "").toLowerCase();

    const avoid = (name) => {
      const n = name.toLowerCase();
      return (
        /(^|_)(id|uuid)$/.test(n) ||
        n.includes("timestamp") ||
        n.includes("time") ||
        n.includes("date") ||
        n.includes("email") ||
        n.includes("phone") ||
        n.includes("name")
      );
    };

    const preferOrder = (names) => {
      for (const key of names) {
        const idx = lc.findIndex(
          (c) => c === key || c.endsWith("_" + key) || c.includes(key)
        );
        if (idx !== -1) return columns[idx];
      }
      return null;
    };

    if (ctx.includes("churn")) {
      const hit = preferOrder(["churn", "is_churn", "churned", "retained"]);
      if (hit) return hit;
    }
    if (ctx.includes("fraud")) {
      const hit = preferOrder(["fraud", "is_fraud", "fraud_flag"]);
      if (hit) return hit;
    }
    if (ctx.includes("conversion") || ctx.includes("convert")) {
      const hit = preferOrder(["converted", "conversion", "is_conversion"]);
      if (hit) return hit;
    }

    const nameFirst =
      preferOrder([
        "target",
        "label",
        "class",
        "category",
        "churn",
        "converted",
        "default",
        "fraud",
        "response",
        "won",
        "lost",
        "click",
        "purchased",
      ]) || null;
    if (nameFirst) return nameFirst;

    const sample = rows.slice(0, 1000);
    let bestCat = null;
    for (const col of columns) {
      if (avoid(col)) continue;
      const vals = sample
        .map((r) => r[col])
        .filter((v) => v !== null && v !== undefined && v !== "");
      if (!vals.length) continue;
      const first = vals.find((v) => v !== null && v !== undefined);
      const isNum = typeof first === "number";
      const uniq = new Set(
        vals.map((v) => (isNum ? v : String(v).toLowerCase().trim()))
      ).size;
      const uniqRatio = uniq / vals.length;
      if (!isNum && uniq >= 2 && uniq <= 50 && uniqRatio <= 0.5) {
        bestCat = col;
        break;
      }
    }
    if (bestCat) return bestCat;

    for (const col of columns) {
      if (avoid(col)) continue;
      const nums = sample
        .map((r) => r[col])
        .filter((v) => typeof v === "number");
      if (nums.length < sample.length * 0.5) continue;
      const uniq = new Set(nums).size;
      if (uniq >= Math.min(10, Math.ceil(nums.length * 0.1))) return col;
    }
  } catch (e) {
  }
  return null;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

$fileUpload.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  showDataLoading();
  currentDemo = null;
  if (file.name.match(/\.xlsx$/i)) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    data = d3.csvParse(csv, d3.autoType);
  } else {
    const text = await file.text();
    data = d3.csvParse(text, d3.autoType);
  }
  renderPreview(data);

  $analysisContext.value = "";
});

on("generate-hypotheses", async () => {
  if (!data) {
    alert("Please select a dataset or upload a CSV/XLSX file first.");
    return;
  }
  if (!$analysisContext.value.trim()) {
    alert("Please provide analysis context describing what you want to analyze.");
    return;
  }

  description = buildDescription();

  const { messages, response_format } = activeConfig().prompts.list({
    analysisContext: $analysisContext.value,
    description,
  });
  const body = buildBody(messages, response_format);

  $hypotheses.innerHTML = loading;
  await stream(body, (c) => {
    ({ hypotheses } = parse(c));
    drawHypotheses();
  });
  $synthesis.classList.remove("d-none");
});

function drawHypotheses() {
  if (!Array.isArray(hypotheses)) return;
  $hypotheses.innerHTML = hypotheses
    .map(
      ({ hypothesis, benefit }, index) => `
      <div class="hypothesis col py-3" data-index="${index}">
        <div class="card h-100">
          <div class="card-body">
            <h5 class="card-title hypothesis-title">${hypothesis}</h5>
            <p class="card-text hypothesis-benefit">${benefit}</p>
          </div>
          <div class="card-footer">
            <div class="result"></div>
            <div class="outcome"></div>
            <div class="stats small text-secondary font-monospace mb-3"></div>
            <div>${testButton(index)}</div>
          </div>
        </div>
      </div>
    `,
    )
    .join("");
}

$hypotheses.addEventListener("click", async (e) => {
  const $hypothesis = e.target.closest(".test-hypothesis");
  if (!$hypothesis) return;
  const index = $hypothesis.dataset.index;
  const hypothesis = hypotheses[index];

  const systemPrompt = document.getElementById("analysis-prompt").value;
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Hypothesis: ${hypothesis.hypothesis}\n\n${description}` },
    ],
  };

  const $resultContainer = $hypothesis.closest(".card");
  const $result = $resultContainer.querySelector(".result");
  const $outcome = $resultContainer.querySelector(".outcome");
  const $stats = $resultContainer.querySelector(".stats");
  let generatedContent;
  $result.innerHTML = loading;
  await stream(body, (c) => { generatedContent = c; setHTML($result, c); });

  let code = [...generatedContent.matchAll(/```python\n*([\s\S]*?)\n```(\n|$)/g)].at(-1)[1];
  code += "\n\ntest_hypothesis(pd.DataFrame(data))";

  $outcome.innerHTML = loading;

  const listener = async (event) => {
    const { result, error } = event.data;
    pyodideWorker.removeEventListener("message", listener);

    if (error) {
      $outcome.innerHTML = `<pre class="alert alert-danger">${error}</pre>`;
      return;
    }
    const [success, pValue] = result;
    $outcome.classList.add(pValue < 0.05 ? "success" : "failure");
    $stats.innerHTML = `<p class="mt-2 mb-0"><strong>p:</strong> ${num(pValue)}</p>`;
    const { messages } = activeConfig().prompts.interpretItem({
      hypothesis: hypothesis.hypothesis,
      description,
      success,
      pValue: num(pValue),
    });
    await stream({ messages }, (c) => { setHTML($outcome, c); });
    $result.innerHTML = `<details>
      <summary class="h5 my-3">Analysis</summary>
      ${marked.parse(generatedContent)}
    </details>`;
  };

  $outcome.innerHTML = loading;
  pyodideWorker.addEventListener("message", listener);
  pyodideWorker.postMessage({ id: "1", code, data, context: {} });
});

on("run-all", () => {
  const $hypotheses = [...document.querySelectorAll(".hypothesis")];
  const $pending = $hypotheses.filter((d) => !d.querySelector(".outcome").textContent.trim());
  $pending.forEach((el) => el.querySelector(".test-hypothesis").click());
});

on("synthesize", async () => {
  const hypotheses = [...document.querySelectorAll(".hypothesis")]
    .map((h) => ({
      title: h.querySelector(".hypothesis-title").textContent,
      benefit: h.querySelector(".hypothesis-benefit").textContent,
      outcome: h.querySelector(".outcome").textContent.trim(),
    }))
    .filter((d) => d.outcome);

  const { messages } = activeConfig().prompts.synthesize({ items: hypotheses });
  const body = { messages };

  $synthesisResult.innerHTML = loading;
  await stream(body, (c) => { setHTML($synthesisResult, c); });
});

on("reset", () => {
  for (const $hypothesis of document.querySelectorAll(".hypothesis")) {
    $hypothesis.querySelector(".result").innerHTML = testButton($hypothesis.dataset.index);
    $hypothesis.querySelector(".outcome").textContent = "";
  }
});

async function buildModels() {
  if (!data) {
    alert("Please select a dataset or upload a CSV/XLSX file first.");
    return;
  }
  if (!$analysisContext.value.trim()) {
    alert("Please provide analysis context describing the question or objective.");
    return;
  }

  description = buildDescription();

  const { messages, response_format } = configs.modeling.prompts.list({
    analysisContext: $analysisContext.value,
    description,
  });
  const body = buildBody(messages, response_format);

  $modeling.classList.remove("d-none");
  $modelControls.classList.add("d-none");
  $modelStatus.innerHTML = loading;
  $modelExperiments.innerHTML = "";
  $modelResults.innerHTML = "";

  try {
  await stream(body, (c) => {
    ({ experiments: modelingExperiments } = parse(c));
    if (Array.isArray(modelingExperiments)) {
      const guessed = guessTarget(data, $analysisContext.value);
      if (guessed) {
        for (const exp of modelingExperiments) {
          if (
            exp &&
            (!exp.target || String(exp.target).toLowerCase() === "auto")
          ) {
            exp.target = guessed;
          }
        }
      }
    }
    drawModelExperiments();
  });
  } catch (err) {
    $modelStatus.innerHTML = `<div class="alert alert-danger">Failed to build models: ${escapeHtml(String(err?.message || err))}</div>`;
    return;
  }

  $modelStatus.innerHTML = "";
  $modelControls.classList.remove("d-none");
}

on("generate-model-plans", buildModels);
window.buildModels = buildModels;

function drawModelExperiments() {
  if (!Array.isArray(modelingExperiments)) return;
  const renderSplit = (s) =>
    `test_size=${s?.test_size ?? 0.2}, random_state=${s?.random_state ?? 42}${s?.stratify ? ", stratify" : ""}`;
  $modelExperiments.innerHTML = modelingExperiments
    .map((exp, index) => `
      <div class="col py-3" data-index="${index}">
        <div class="card h-100">
          <div class="card-body">
            <h5 class="card-title">${exp.title || "Modeling Experiment"}</h5>
            <ul class="list-unstyled small text-secondary mb-2">
              <li><strong>Problem:</strong> ${exp.problem_type || "auto"}</li>
              <li><strong>Target:</strong> ${exp.target ?? "(auto)"}</li>
              <li><strong>Split:</strong> ${renderSplit(exp.split || {})}</li>
            </ul>
            <p class="card-text mb-1"><strong>Models:</strong> ${Array.isArray(exp.models) ? exp.models.join(", ") : ""}</p>
            <p class="card-text mb-0"><strong>Metrics:</strong> ${Array.isArray(exp.metrics) ? exp.metrics.join(", ") : ""}</p>
            ${exp.notes ? `<p class="card-text small text-secondary mt-2 mb-0">${exp.notes}</p>` : ""}
          </div>
          <div class="card-footer">
            <div class="result"></div>
            <div class="outcome"></div>
            <div class="stats small text-secondary font-monospace mb-3"></div>
            <div class="chart"></div>
            <div><button type="button" class="btn btn-sm btn-primary test-model" data-index="${index}">Test</button></div>
          </div>
        </div>
      </div>
    `)
    .join("");
}

$modelExperiments.addEventListener("click", async (e) => {
  const $btn = e.target.closest(".test-model");
  if (!$btn) return;
  const idx = +$btn.dataset.index;
  const plan = modelingExperiments[idx];

  const body = configs.modeling.prompts.code({ plan, description });

  const $card = $btn.closest(".card");
  const $result = $card.querySelector(".result");
  const $outcome = $card.querySelector(".outcome");
  const $stats = $card.querySelector(".stats");
  $result.innerHTML = loading;
  $outcome.innerHTML = "";
  $stats.innerHTML = "";

  let generatedContent;
  await stream(body, (c) => { generatedContent = c; setHTML($result, c); });

  const match = [...generatedContent.matchAll(/```python\n*([\s\S]*?)\n```(\n|$)/g)].at(-1);
  let code = match && match[1];
  if (!code) {
    $result.innerHTML = `<div class="alert alert-danger">No Python block generated. Please try again.</div>`;
    return;
  }
  code += "\n\nrun_models(pd.DataFrame(data), plan)";

  $outcome.innerHTML = loading;
  try {
    const snapshot = d3.csvFormat(data || []);
    qualitySnapshots.push(snapshot);
  } catch {}

  const listener = async (event) => {
    const { result, error } = event.data;
    pyodideWorker.removeEventListener("message", listener);
    if (error) {
      $outcome.innerHTML = `<pre class=\"alert alert-danger\">${error}</pre>`;
      return;
    }
    renderModelResultInCard2(result, $card);
    
    const summaryBody2 = configs.modeling.prompts.interpretItem({
      analysisContext: $analysisContext.value,
      plan,
      result,
    });
    await stream(summaryBody2, (c) => { setHTML($outcome, c); });
    $result.innerHTML = `<details>
      <summary class=\"h6 my-2\">Modeling code</summary>
      ${marked.parse(generatedContent)}
    </details>`;
  };

  pyodideWorker.addEventListener("message", listener);
  pyodideWorker.postMessage({ id: "mdl-" + Date.now(), code, data, context: { plan } });
});

on("run-all-models", () => {
  const cards = [...document.querySelectorAll("#model-experiments .card")];
  const pending = cards.filter((c) => !c.querySelector(".outcome").textContent.trim());
  pending.forEach((c) => c.querySelector(".test-model").click());
});

on("reset-models", () => {
  for (const el of document.querySelectorAll("#model-experiments .col")) {
    const $card = el.querySelector(".card");
    $card.querySelector(".result").innerHTML = `<button type=\"button\" class=\"btn btn-sm btn-primary test-model\" data-index=\"${el.dataset.index}\">Test</button>`;
    $card.querySelector(".outcome").textContent = "";
    $card.querySelector(".stats").textContent = "";
  }
});

function renderModelResultInCard2(result, $card) {
  const $stats = $card.querySelector(".stats");
  if (!result || !Array.isArray(result.models)) {
    $stats.innerHTML = "No metrics returned.";
    return;
  }
  const metricNames = Array.from(
    result.models.reduce((s, m) => {
      Object.keys(m.metrics || {}).forEach((k) => s.add(k));
      return s;
    }, new Set())
  );
  const rows = result.models
    .map((m) => {
      const cells = metricNames
        .map((k) => {
          const v = m.metrics?.[k];
          if (v === null || v === undefined || Number.isNaN(v)) return "";
          const n = typeof v === "number" ? (Math.abs(v) >= 1000 ? num(v) : v.toFixed(4)) : v;
          return `${k}=${n}`;
        })
        .join("; ");
      const name = m.name === result.best ? `${m.name} (best)` : m.name;
      return `${name}: ${cells}`;
    })
    .join(" | ");
  const meta = `Problem=${result.problem_type}; Target=${result.target || "(auto)"}`;
  $stats.innerHTML = `${meta} - ${rows}`;

  try {
    const $chart = $card.querySelector('.chart');
    if (!$chart) return;
    const isReg = String(result.problem_type || '').toLowerCase().includes('regress');
    const prefs = isReg ? ['r2', '-rmse', '-mae'] : ['f1_weighted', 'accuracy', 'roc_auc_ovr'];
    let chosen = null, invert = false;
    for (const p of prefs) {
      const key = p.startsWith('-') ? p.slice(1) : p;
      const exists = result.models.some((m) => m.metrics && typeof m.metrics[key] === 'number');
      if (exists) { chosen = key; invert = p.startsWith('-'); break; }
    }
    if (!chosen) return;
    const items = result.models.map((m) => ({ name: m.name, val: m.metrics?.[chosen] })).filter((d) => typeof d.val === 'number');
    if (!items.length) return;
    const values = items.map((d) => (invert ? -d.val : d.val));
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const span = maxV - minV || 1;
    items.forEach((d) => { d.score = ((invert ? -d.val : d.val) - minV) / span; d.pct = Math.round(100 * d.score); });
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, 5);
    $chart.innerHTML = top
      .map((d) => `
        <div class="d-flex align-items-center gap-2 my-1">
          <div class="text-truncate" style="width:140px">${d.name === result.best ? d.name + ' (best)' : d.name}</div>
          <div style="flex:1;background:#eee;height:8px;position:relative;border-radius:4px;">
            <div style="position:absolute;left:0;top:0;height:8px;background:#0d6efd;border-radius:4px;width:${d.pct}%"></div>
          </div>
          <div class="small" style="width:64px;text-align:right">${d.val.toFixed(3)}</div>
        </div>`)
      .join('');
  } catch {}
}

try { $status.innerHTML = ""; } catch {}

const sqlite3 = await sqlite3InitModule({ printErr: console.error });

const $mode = document.getElementById('mode-select');
function updateModeUI() {
  try {
    if ($analysisPrompt && activeConfig()?.defaults?.codeSystemPrompt)
      $analysisPrompt.value = activeConfig().defaults.codeSystemPrompt;
    const gh = document.getElementById('generate-hypotheses');
    const gm = document.getElementById('generate-model-plans');
    const gq = document.getElementById('generate-quality-plans');
    if (gh) gh.classList.toggle('d-none', activeMode !== 'hypotheses');
    if (gm) gm.classList.toggle('d-none', activeMode !== 'modeling');
    if (gq) gq.classList.toggle('d-none', activeMode !== 'quality');
  } catch {}
}
$mode?.addEventListener('change', () => { activeMode = $mode.value; updateModeUI(); });
updateModeUI();

async function buildQuality() {
  if (!data) {
    alert("Please select a dataset or upload a CSV/XLSX file first.");
    return;
  }
  if (!$analysisContext.value.trim()) {
    alert("Please provide analysis context describing the question or objective.");
    return;
  }

  description = buildDescription();
  const { messages, response_format } = configs.quality.prompts.list({
    analysisContext: $analysisContext.value,
    description,
  });
  const body = buildBody(messages, response_format);

  $quality.classList.remove("d-none");
  $qualityControls.classList.add("d-none");
  $qualityStatus.innerHTML = loading;
  $qualityAgents.innerHTML = "";
  $qualityResults.innerHTML = "";
  qualityPlans = undefined;
  lastCleanedCSV = "";
  qualityBaselineScore = computeQualityScore(data);
  updateQualityOverview();
  const $dl = document.getElementById("download-cleaned");
  if ($dl) $dl.disabled = true;

  try {
    await stream(body, (c) => {
      const parsed = parse(c);
      qualityPlans = parsed?.agents || parsed?.steps || [];
      drawQualityAgents();
    });
  } catch (err) {
    $qualityStatus.innerHTML = `<div class="alert alert-danger">Failed to build quality plan: ${escapeHtml(String(err?.message || err))}</div>`;
    return;
  }

  $qualityStatus.innerHTML = "";
  $qualityControls.classList.remove("d-none");
}

function drawQualityAgents() {
  if (!Array.isArray(qualityPlans)) return;
  $qualityAgents.innerHTML = qualityPlans
    .map((plan, index) => `
      <div class="col py-3" data-index="${index}">
        <div class="card h-100">
          <div class="card-body">
            <h5 class="card-title">${plan.title || "Data Quality Agent"}</h5>
            <p class="card-text mb-1"><strong>Problem:</strong> ${plan.problem || ""}</p>
            <p class="card-text small text-secondary mb-2"><strong>Approach:</strong> ${plan.approach || ""}</p>
            <p class="card-text small mb-0"><strong>Columns:</strong> ${Array.isArray(plan.columns) ? plan.columns.join(", ") : "(auto)"}</p>
          </div>
          <div class="card-footer">
            <div class="result"></div>
            <div class="outcome"></div>
            <div class="stats small text-secondary font-monospace mb-3"></div>
            <div><button type="button" class="btn btn-sm btn-primary test-quality" data-index="${index}">Run</button></div>
          </div>
        </div>
      </div>
    `)
    .join("");
}

$qualityAgents?.addEventListener("click", async (e) => {
  const $btn = e.target.closest(".test-quality");
  if (!$btn) return;
  const idx = +$btn.dataset.index;
  const plan = qualityPlans[idx];

  const body = configs.quality.prompts.code({ plan, description, analysisContext: $analysisContext.value });

  const $card = $btn.closest(".card");
  const $result = $card.querySelector(".result");
  const $outcome = $card.querySelector(".outcome");
  const $stats = $card.querySelector(".stats");
  $result.innerHTML = loading;
  $outcome.innerHTML = "";
  $stats.innerHTML = "";

  let generatedContent;
  await stream(body, (c) => { generatedContent = c; setHTML($result, c); });

  const match = [...generatedContent.matchAll(/```python\n*([\s\S]*?)\n```(\n|$)/g)].at(-1);
  let code = match && match[1];
  if (!code) {
    $result.innerHTML = `<div class="alert alert-danger">No Python block generated. Please try again.</div>`;
    return;
  }
  code += "\n\nrun_quality(pd.DataFrame(data), plan)";

  $outcome.innerHTML = loading;

  const listener = async (event) => {
    const { result, error } = event.data;
    pyodideWorker.removeEventListener("message", listener);
    if (error) {
      $outcome.innerHTML = `<pre class=\"alert alert-danger\">${error}</pre>`;
      return;
    }
    try {
      if (result?.csv) {
        lastCleanedCSV = result.csv;
        try {
          data = d3.csvParse(lastCleanedCSV, d3.autoType);
          renderPreview(data);
          updateQualityOverview();
        } catch {}
        const $dl = document.getElementById("download-cleaned");
        if ($dl) $dl.disabled = !lastCleanedCSV;
      }
      $stats.innerHTML = `Rows: ${result?.rows_before ?? "?"} Ã¢â€ â€™ ${result?.rows_after ?? "?"}`;
      const summaryBody = configs.quality.prompts.interpretItem({ plan, result });
      await stream(summaryBody, (c) => { setHTML($outcome, c); });
      $result.innerHTML = `<details>
        <summary class=\"h6 my-2\">Quality agent code</summary>
        ${marked.parse(generatedContent)}
      </details>`;
    } catch (e) {
      $outcome.innerHTML = `<pre class=\"alert alert-danger\">${escapeHtml(String(e?.message || e))}</pre>`;
    }
  };

  pyodideWorker.addEventListener("message", listener);
  pyodideWorker.postMessage({ id: "dq-" + Date.now(), code, data, context: { plan } });
});

on("generate-quality-plans", buildQuality);

on("run-all-quality", () => {
  const cards = [...document.querySelectorAll("#quality-agents .card")];
  const pending = cards.filter((c) => !c.querySelector(".outcome").textContent.trim());
  pending.forEach((c) => c.querySelector(".test-quality").click());
});

on("reset-quality", () => {
  for (const el of document.querySelectorAll("#quality-agents .col")) {
    const $card = el.querySelector(".card");
    $card.querySelector(".result").innerHTML = `<button type=\"button\" class=\"btn btn-sm btn-primary test-quality\" data-index=\"${el.dataset.index}\">Run</button>`;
    $card.querySelector(".outcome").textContent = "";
    $card.querySelector(".stats").textContent = "";
  }
  lastCleanedCSV = "";
  const $dl = document.getElementById("download-cleaned");
  if ($dl) $dl.disabled = true;
  qualityBaselineScore = computeQualityScore(data);
  updateQualityOverview();
  qualitySnapshots = [];
});

on("undo-quality", () => {
  if (!qualitySnapshots.length) return;
  try {
    lastCleanedCSV = qualitySnapshots.pop();
    if (lastCleanedCSV) {
      data = d3.csvParse(lastCleanedCSV, d3.autoType);
      renderPreview(data);
      updateQualityOverview();
      const $dl = document.getElementById("download-cleaned");
      if ($dl) $dl.disabled = !lastCleanedCSV;
    }
  } catch {}
});

document.getElementById("download-cleaned")?.addEventListener("click", () => {
  if (!lastCleanedCSV) return;
  try {
    const blob = new Blob([lastCleanedCSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleaned_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {}
});
