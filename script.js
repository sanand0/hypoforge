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
import config from './config.js';
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

const DEFAULT_BASE_URLS = [
  "https://api.openai.com/v1",
  "https://llmfoundry.straivedemo.com/openai/v1",
  "https://llmfoundry.straive.com/openai/v1",
];

async function* llm(body) {
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
  for await (const event of asyncLLM(`${baseUrl}/chat/completions`, request)) yield event;
}

const stream = async (body, fn) => {
  for await (const { content } of llm(body)) if (content) fn(content);
};
const on = (id, fn) => get(id).addEventListener("click", fn);

saveform("#hypoforge-settings", { exclude: "[type=\"file\"]" });

const $analysisPromptEl = document.getElementById('analysis-prompt');
if ($analysisPromptEl && !$analysisPromptEl.value.trim()) {
  $analysisPromptEl.value = config.prompts.code;
}


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
      json_schema: { name: config.schema.name, strict: true, schema: config.schema.schema },
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
          content: config.prompts.interpret,
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
        content: config.prompts.synthesize,
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

$status.innerHTML = "";

// Initialize SQLite
const sqlite3 = await sqlite3InitModule({ printErr: console.error });








