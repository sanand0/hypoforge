// import { render, html } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import { parse } from "https://cdn.jsdelivr.net/npm/partial-json@0.1.7/+esm";
import saveform from "https://cdn.jsdelivr.net/npm/saveform@1.2";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";
import sqlite3InitModule from "https://esm.sh/@sqlite.org/sqlite-wasm@3.46.1-build3";

const pyodideWorker = new Worker("./pyworker.js", { type: "module" });

// Run code in an ephemeral Pyodide worker with a timeout
async function runPythonEphemeral({ code, data, context, timeoutMs = 30000 }) {
  return new Promise((resolve) => {
    const id = `py-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worker = new Worker("./pyworker.js", { type: "module" });
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      resolve(event.data);
    };
    worker.addEventListener("message", onMessage);
    const timer = setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      resolve({ id, error: `Execution timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    worker.postMessage({ id, code, data, context });
  });
}

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
].map(get);
const loading = /* html */ `<div class="text-center my-5"><div class="spinner-border" role="status"></div></div>`;

let data, description, hypotheses, currentDemo;
let modelingExperiments;

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

// (Removed) streamWithControls was unused; simplified to `stream` above.
const on = (id, fn) => {
  const el = get(id);
  if (el) el.addEventListener("click", fn);
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
      return /* html */ `<pre class="hljs language-${language}"><code>${content}</code></pre>`;
    },
  },
});

// Load configurations and render the demos
$status.innerHTML = loading;
const { demos } = await fetch("config.json").then((r) => r.json());
$demoList.innerHTML += demos
  .map(
    ({ title, body }, index) => /* html */ `
      <li><a class="dropdown-item demo-item text-wrap" href="#" data-index="${index}">
        <strong>${title}</strong><br>
        <small class="text-muted">${body}</small>
      </a></li>
    `,
  )
  .join("");

const numFormat = new Intl.NumberFormat("en-US", {
  style: "decimal",
  notation: "compact",
  compactDisplay: "short",
});
const num = (val) => numFormat.format(val);
const dateFormat = d3.timeFormat("%Y-%m-%d %H:%M:%S");

const hypothesesSchema = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hypothesis: {
            type: "string",
          },
          benefit: {
            type: "string",
          },
        },
        required: ["hypothesis", "benefit"],
        additionalProperties: false,
      },
    },
  },
  required: ["hypotheses"],
  additionalProperties: false,
};

// // Schema for modeling plan generation
// const modelingSchema = {
//   type: "object",
//   properties: {
//     experiments: {
//       type: "array",
//       items: {
//         type: "object",
//         properties: {
//           title: { type: "string" },
//           problem_type: { type: "string" },
//           target: { type: ["string", "null"] },
//           split: {
//             type: "object",
//             properties: {
//               test_size: { type: "number" },
//               random_state: { type: "number" },
//               stratify: { type: ["boolean", "string", "null"] },
//             },
//             required: ["test_size", "random_state"],
//             additionalProperties: true,
//           },
//           models: {
//             type: "array",
//             items: { type: "string" },
//           },
//           metrics: {
//             type: "array",
//             items: { type: "string" },
//           },
//           notes: { type: "string" },
//         },
//         required: ["title", "problem_type", "split", "models"],
//         additionalProperties: true,
//       },
//     },
//   },
//   required: ["experiments"],
//   additionalProperties: false,
// };

// // Schema to force single Python payload in JSON for modeling code
// const modelCodeSchema = {
//   type: "object",
//   properties: {
//     code: { type: "string" },
//     rationale: { type: ["string", "null"] },
//   },
//   required: ["code"],
//   additionalProperties: false,
// };

const describe = (data, col) => {
  const values = data.map((d) => d[col]);
  const firstVal = values[0];
  if (typeof firstVal === "string") {
    // Return the top 3 most frequent values
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
  /* html */ `<button type="button" class="btn btn-sm btn-primary test-hypothesis" data-index="${index}">Test</button>`;

// Add support for SQLite files
async function loadData(demo) {
  if (demo.href.match(/\.(sqlite3|sqlite|db|s3db|sl3)$/i)) {
    // Load SQLite database
    const response = await fetch(demo.href);
    const buffer = await response.arrayBuffer();
    const dbName = demo.href.split("/").pop();
    await sqlite3.capi.sqlite3_js_posix_create_file(dbName, new Uint8Array(buffer));
    // Copy tables from the uploaded database to a new DB instance
    const uploadDB = new sqlite3.oo1.DB(dbName, "r");
    const tables = uploadDB.exec("SELECT name FROM sqlite_master WHERE type='table'", { rowMode: "object" });
    if (!tables.length) {
      throw new Error("No tables found in database");
    }
    // Get data from the first table
    const tableName = tables[0].name;
    const result = uploadDB.exec(`SELECT * FROM "${tableName}"`, { rowMode: "object" });
    // Clean up
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

// Clear all data and UI elements
function clearDataAndUI() {
  // Clear hypotheses
  $hypotheses.innerHTML = "";
  $synthesis.classList.add("d-none");

  // Hide context section and preview
  $contextSection.classList.add("d-none");
  $datasetPreview.classList.add("d-none");

  // Clear table
  $previewTable.querySelector("thead").innerHTML = "";
  $previewTable.querySelector("tbody").innerHTML = "";
}

// Show loading state
function showDataLoading() {
  clearDataAndUI();
  $datasetPreview.classList.remove("d-none");
  $previewLoading.classList.remove("d-none");
}

// Render dataset preview table
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

  // Hide loading and show content
  $previewLoading.classList.add("d-none");
  $datasetPreview.classList.remove("d-none");
  $contextSection.classList.remove("d-none");
}

// When the user clicks on a demo, load and preview it
$demoList.addEventListener("click", async (e) => {
  e.preventDefault();
  const $demo = e.target.closest(".demo-item");
  if (!$demo) return;

  showDataLoading();
  currentDemo = demos[+$demo.dataset.index];
  data = await loadData(currentDemo);
  renderPreview(data);

  // Set context from demo configuration
  $analysisContext.value = currentDemo.audience;
});

// Modeling UI elements
const $modeling = get("modeling");
const $modelResults = get("model-results");
const $modelStatus = get("model-status");
const $modelControls = get("model-controls");
const $modelExperiments = get("model-experiments");

// Helper to build a dataset description on demand
function buildDescription() {
  if (!data || !data.length) return "";
  const columnDescription = Object.keys(data[0])
    .map((col) => `- ${col}: ${describe(data, col)}`)
    .join("\n");
  const numColumns = Object.keys(data[0]).length;
  return `The Pandas DataFrame df has ${data.length} rows and ${numColumns} columns:\n${columnDescription}`;
}

// Heuristic: guess a reasonable target column from data and context
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

    // Context-driven hints
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

    // Name-based common targets
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

    // Data-driven: find a categorical-like column that's not ID-like
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

    // Fallback: pick a numeric column with sufficient variability
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
    // Best-effort; swallow errors
  }
  return null;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// Handle file upload
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

  // Clear context for custom files
  $analysisContext.value = "";
});

// Generate hypotheses button
on("generate-hypotheses", async () => {
  if (!data) {
    alert("Please select a dataset or upload a CSV/XLSX file first.");
    return;
  }
  if (!$analysisContext.value.trim()) {
    alert("Please provide analysis context describing what you want to analyze.");
    return;
  }

  const columnDescription = Object.keys(data[0])
    .map((col) => `- ${col}: ${describe(data, col)}`)
    .join("\n");
  const numColumns = Object.keys(data[0]).length;
  description = `The Pandas DataFrame df has ${data.length} rows and ${numColumns} columns:\n${columnDescription}`;

  const systemPrompt = $analysisContext.value;
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: description },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "hypotheses", strict: true, schema: hypothesesSchema },
    },
  };

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
      ({ hypothesis, benefit }, index) => /* html */ `
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
  await stream(body, (c) => {
    generatedContent = c;
    $result.innerHTML = marked.parse(c);
  });

  // Extract the code inside the last ```...``` block
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
    $stats.innerHTML = /* html */ `<p class="mt-2 mb-0"><strong>p:</strong> ${num(pValue)}</p>`;
    const body = {
      messages: [
        {
          role: "system",
          content: `You are an expert data analyst.
Given a hypothesis and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.
Highlight in **bold** the keywords in the supporting statements.
Do not mention the p-value but _interpret_ it to support the conclusion quantitatively.`,
        },
        {
          role: "user",
          content: `Hypothesis: ${hypothesis.hypothesis}\n\n${description}\n\nResult: ${success}. p-value: ${
            num(pValue)
          }`,
        },
      ],
    };
    await stream(body, (c) => {
      $outcome.innerHTML = marked.parse(c);
    });
    $result.innerHTML = /* html */ `<details>
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

  const body = {
    messages: [
      {
        role: "system",
        content: `Given the below hypotheses and results, summarize the key takeaways and actions in Markdown.
Begin with the hypotheses with lowest p-values AND highest business impact. Ignore results with errors.
Use action titles has H5 (#####). Just reading titles should tell the audience EXACTLY what to do.
Below each, add supporting bullet points that
  - PROVE the action title, mentioning which hypotheses led to this conclusion.
  - Do not mention the p-value but _interpret_ it to support the action
  - Highlight key phrases in **bold**.
Finally, after a break (---) add a 1-paragraph executive summary section (H5) summarizing these actions.
`,
      },
      {
        role: "user",
        content: hypotheses
          .map((h) => `Hypothesis: ${h.title}\nBenefit: ${h.benefit}\nResult: ${h.outcome}`)
          .join("\n\n"),
      },
    ],
  };

  $synthesisResult.innerHTML = loading;
  await stream(body, (c) => {
    $synthesisResult.innerHTML = marked.parse(c);
  });
});

on("reset", () => {
  for (const $hypothesis of document.querySelectorAll(".hypothesis")) {
    $hypothesis.querySelector(".result").innerHTML = testButton($hypothesis.dataset.index);
    $hypothesis.querySelector(".outcome").textContent = "";
  }
});

// Generate modeling experiment plans (cards) and per-card testing
// Expose the same functionality under a named function for reuse
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

  const sys = `You are an expert ML engineer. Propose a series of modeling experiments for the user's question and dataset. STRICTLY order experiments by increasing complexity: start with the simplest single-model baselines, then progress through regularized linear methods, shallow trees, bagging, boosting, and finally stacked/voting combinations. Do NOT include any ensemble/stacking before the simpler families are covered.

Respond ONLY with a JSON object of the form { "experiments": [...] } and nothing else.

For each experiment, include exactly these keys:
- problem_type: "classification" | "regression" | ... -- Explain why?
- title: short, business-friendly title (3-5 words, no jargon) tailored to the question (e.g., "Baseline Churn Benchmark", "Explainable Risk Score", "Robust Customer Segmenter", "Max-Accuracy Fraud Alert")
- target: best-guess target column as a string, or null if it should be inferred -- Explain why and how it is related to problem.
- split: object with keys { test_size: number in [0.2, 0.4], random_state: 42, stratify: boolean|string|null when classification }
- models: array of model names appropriate to the current complexity level
- metrics: array of metric names
- notes: 1-2 crisp lines explaining the rationale (why this stage appears here, the chosen split) and clearly naming the model family/complexity stage

Complexity stages (must appear in this order; do not skip from simple directly to combinations):
1) Baselines: DummyClassifier/DummyRegressor, LogisticRegression/LinearRegression (defaults), DecisionTree, Naive Bayes (classification).
2) Regularized linear: Ridge, Lasso, ElasticNet (use classification/regression variants as appropriate).
3) Shallow trees: DecisionTree with small depth tuning.
4) Bagging: RandomForest, ExtraTrees.
5) Boosting: GradientBoosting; optionally XGBoost/LightGBM if available (handle unavailability gracefully downstream).
6) Combinations: Voting or Stacking that combine 2-3 of the best prior models.

Rules:
- The experiments array MUST be sorted from simplest to most complex as per the stages above.
- Earlier experiments must NOT list ensemble/combination models.
- Include 7-8 experiments total.
- Vary split.test_size between 0.2 and 0.4 across experiments to test robustness (e.g., larger for simpler models or abundant data).
- Prefer setting target to a column name present in df; only use null if truly ambiguous or no sensible target exists.`;

  const body = {
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `${description}\n\nQuestion: ${$analysisContext.value}` },
    ],
    // Use a broad JSON object format for compatibility with providers that
    // don't support json_schema under chat/completions.
    response_format: { type: "json_object" },
  };

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

// Keep the button wired up, and also expose globally for programmatic usage
on("generate-model-plans", buildModels);
window.buildModels = buildModels;

function drawModelExperiments() {
  if (!Array.isArray(modelingExperiments)) return;
  const renderSplit = (s) =>
    `test_size=${s?.test_size ?? 0.2}, random_state=${s?.random_state ?? 42}${s?.stratify ? ", stratify" : ""}`;
  $modelExperiments.innerHTML = modelingExperiments
    .map((exp, index) => /* html */ `
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

  const systemPrompt = `You are an expert ML engineer.
Generate concise, robust Python to implement the given modeling experiment on df.
Requirements:
- Detect/confirm problem type and target (use plan.target if provided; else infer sensibly from df and plan.problem_type).
- Train/test split using plan.split (default test_size=0.2, random_state=42; use stratify when classification if possible).
- Preprocess with ColumnTransformer: numeric -> impute median + StandardScaler; categorical -> impute 'missing' + OneHotEncoder(handle_unknown='ignore').
- Fit models listed in plan.models (fallback gracefully for unavailable models).
- Compute metrics:\n  * Classification: accuracy, precision_weighted, recall_weighted, f1_weighted, roc_auc_ovr (guard with try/except), confusion_matrix\n  * Regression: r2, rmse, mae, mse (rmse = sqrt(mse))
- Return dict: { problem_type, target, models: [{name, metrics}], best, confusion_matrix|null, summary }
- Keep code compact and deterministic.
- If scikit-learn is unavailable in environment, gracefully fall back to a baseline using pandas/scipy (e.g., simple mean baseline for regression or majority-class for classification) and return feasible metrics.

Define exactly this function and return only a single Python code block and nothing else:
\`\`\`python
import pandas as pd
import numpy as np
from typing import Dict, Any

def run_models(df: pd.DataFrame, plan: Dict[str, Any]) -> dict:
    # ... implement and return the required dict
    return {}
\`\`\``;

  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Dataset:\n${description}\n\nPlan:\n${JSON.stringify(plan)}` },
    ],
  };

  const $card = $btn.closest(".card");
  const $result = $card.querySelector(".result");
  const $outcome = $card.querySelector(".outcome");
  const $stats = $card.querySelector(".stats");
  $result.innerHTML = loading;
  $outcome.innerHTML = "";
  $stats.innerHTML = "";

  let generatedContent;
  await stream(body, (c) => {
    generatedContent = c;
    try { $result.innerHTML = marked.parse(c); } catch {}
  });

  // Extract the code inside the last ```python ... ``` block
  const match = [...generatedContent.matchAll(/```python\n*([\s\S]*?)\n```(\n|$)/g)].at(-1);
  let code = match && match[1];
  if (!code) {
    $result.innerHTML = `<div class="alert alert-danger">No Python block generated. Please try again.</div>`;
    return;
  }
  // Append invocation
  code += "\n\nrun_models(pd.DataFrame(data), plan)";

  $outcome.innerHTML = loading;

  const listener = async (event) => {
    const { result, error } = event.data;
    pyodideWorker.removeEventListener("message", listener);
    if (error) {
      $outcome.innerHTML = `<pre class=\"alert alert-danger\">${error}</pre>`;
      return;
    }
    renderModelResultInCard2(result, $card);
    const summaryBody = {
      messages: [
        {
          role: "system",
          content: `Write a clear, decision-ready analysis in Markdown. Use this structure:\n\n##### Headline finding\n\n- Best Model: <model> — why it wins given the metrics\n- Problem: <classification|regression> — Target: <target> — Split: test_size and notes\n\n###### Ranked Comparison\n- Rank top models with 1 short reason each (interpret metrics; do not dump raw numbers).\n\n###### Key Insights\n- 2–4 insights the audience can act on (tie to the question).\n\n###### Risks & Limitations\n- 1–2 caveats (e.g., class imbalance, overfitting risk, data gaps).\n\n###### Next Steps\n- 2 concrete follow-ups (e.g., feature ideas, data collection, validation).\n\nGuidelines:\n- Interpret metrics; avoid raw number spam.\n- Use **bold** to highlight key phrases.\n- If confusion_matrix exists, comment on precision/recall trade-offs.`,
        },
        {
          role: "user",
          content: `Question: ${$analysisContext.value}\nPlan: ${plan.title}\nProblem: ${result.problem_type}\nTarget: ${result.target}\nBest: ${result.best}\nSplit: ${JSON.stringify(plan.split)}\nPlannedModels: ${JSON.stringify(plan.models)}\nModels: ${JSON.stringify(result.models)}\nConfusionMatrix: ${JSON.stringify(result.confusion_matrix)}`,
        },
      ],
    };
    await stream(summaryBody, (c) => {
      $outcome.innerHTML = marked.parse(c);
    });
    $result.innerHTML = /* html */ `<details>
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
}

$status.innerHTML = "";

// Initialize SQLite
const sqlite3 = await sqlite3InitModule({ printErr: console.error });
