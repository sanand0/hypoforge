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
import domains from "./config.js";
const pyodideWorker = new Worker("./pyworker.js", { type: "module" });
let domain = "hypothesis";

const get = document.getElementById.bind(document);
const [
  $demoList,
  $fileUpload,
  $datasetPreview,
  $previewLoading,
  $previewTable,
  $contextSection,
  $artifactForm,
  $artifactList,
  $actionsSection,
  $summaryResult,
  $status,
] = [
  "demo-list",
  "file-upload",
  "dataset-preview",
  "preview-loading",
  "preview-table",
  "context-section",
  "artifact-form",
  "artifact-list",
  "artifact-actions",
  "artifact-summary",
  "status",
].map(get);
const loading = /* html */ `<div class="text-center my-5"><div class="spinner-border" role="status"></div></div>`;

let data, datasetSummary, artifacts, currentDemo;

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
      model: document.getElementById("llm-engine").value,
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

const $analysisPromptEl = document.getElementById("analysis-prompt");
const syncAnalysisPrompt = () => {
  if (!$analysisPromptEl.value.trim()) $analysisPromptEl.value = domains[domain].prompts.evaluation.system;
};
syncAnalysisPrompt();

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

const renderField = (field) => {
  const { id, label, type = "text", placeholder = "", helperText = "", required = false, options = [], rows = 4 } =
    field;
  const labelHtml = label ? `<label for="${id}" class="form-label">${label}</label>` : "";
  const requirement = required ? "required" : "";
  const baseClass = field.type === "checkbox" ? "form-check-input" : "form-control";
  const sharedAttributes = `id="${id}" name="${id}" class="${baseClass}" placeholder="${placeholder}" ${requirement}`;
  let control = "";

  if (type === "textarea") {
    control = `<textarea ${sharedAttributes} rows="${rows}"></textarea>`;
  } else if (type === "select") {
    const opts = options
      .map(({ label: optionLabel, value }) => `<option value="${value}">${optionLabel}</option>`)
      .join("");
    control = `<select ${sharedAttributes}>${opts}</select>`;
  } else {
    control = `<input type="${type}" ${sharedAttributes} />`;
  }

  const helper = helperText ? `<div class="form-text">${helperText}</div>` : "";
  return `<div class="mb-3">${labelHtml}${control}${helper}</div>`;
};

const renderForm = () => {
  if (!$artifactForm) return;
  $artifactForm.innerHTML = domains[domain].uiSchema.map(renderField).join("")
    || `<p class="text-muted mb-0">No inputs required.</p>`;
};

const buildMessages = (system, user) => ({
  messages: [
    system && { role: "system", content: system },
    { role: "user", content: user || "" },
  ].filter(Boolean),
});

const getFieldNode = (id) => $artifactForm?.querySelector(`#${id}`);

const setFieldValue = (id, value) => {
  const node = getFieldNode(id);
  if (node) node.value = value ?? "";
};

const collectFormData = () => {
  if (!$artifactForm) return {};
  const formData = new FormData($artifactForm);
  const values = {};
  const missing = [];

  for (const field of domains[domain].uiSchema) {
    const raw = formData.get(field.id);
    const value = typeof raw === "string" ? raw.trim() : raw ?? "";
    values[field.id] = value;
    const input = getFieldNode(field.id);
    if (field.required && !value) {
      missing.push(field.label || field.id);
      if (input) input.classList.add("is-invalid");
    } else if (input) {
      input.classList.remove("is-invalid");
    }
  }

  if (missing.length) {
    throw new Error("FORM_VALIDATION_ERROR");
  }

  return values;
};

const prefillFormFromDemo = (demo) => {
  for (const field of domains[domain].uiSchema) {
    if (field.prefillFromDemo && demo && demo[field.prefillFromDemo]) {
      setFieldValue(field.id, demo[field.prefillFromDemo]);
    }
  }
};

const resetPrefilledFields = () => {
  for (const field of domains[domain].uiSchema) {
    if (field.prefillFromDemo) {
      setFieldValue(field.id, "");
    }
  }
};

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
  /* html */ `<button type="button" class="btn btn-sm btn-primary test-artifact" data-index="${index}">Test</button>`;

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
  $artifactList.innerHTML = "";
  $actionsSection.classList.add("d-none");
  artifacts = [];
  datasetSummary = "";

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

  // Prefill form inputs if needed
  prefillFormFromDemo(currentDemo);
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
  resetPrefilledFields();
});

// Generate artifacts button
on("generate-artifacts", async () => {
  if (!data) {
    alert("Please select a dataset or upload a CSV/XLSX file first.");
    return;
  }

  let formValues = {};
  try {
    formValues = collectFormData();
  } catch (error) {
    if (error.message === "FORM_VALIDATION_ERROR") {
      alert("Please complete all required inputs before generating artifacts.");
      return;
    }
    throw error;
  }

  const columns = Object.keys(data[0] ?? {});
  const columnDescription = columns.map((col) => `- ${col}: ${describe(data, col)}`).join("\n");
  const numColumns = columns.length;
  datasetSummary = `The Pandas DataFrame df has ${data.length} rows and ${numColumns} columns:\n${columnDescription}`;

  const systemPromptDefinition = domains[domain].systemPrompt;
  const resolvedSystemPrompt = typeof systemPromptDefinition === "function"
    ? systemPromptDefinition({ formData: formValues, datasetSummary })
    : systemPromptDefinition;
  const userPromptDefinition = domains[domain].userPromptTemplate;
  const resolvedUserPrompt = typeof userPromptDefinition === "function"
    ? userPromptDefinition({ formData: formValues, datasetSummary })
    : userPromptDefinition;

  const userMessage = resolvedUserPrompt || datasetSummary || "Use the dataset summary to craft meaningful artifacts.";
  const body = buildMessages(resolvedSystemPrompt, userMessage);

  if (domains[domain].responseSchema?.format) {
    body.response_format = domains[domain].responseSchema.format;
  }

  $artifactList.innerHTML = loading;
  await stream(body, (c) => {
    const parsed = parse(c) || {};
    artifacts = Array.isArray(parsed.tests) ? parsed.tests : [];
    renderArtifacts();
  });
  $actionsSection.classList.remove("d-none");
});

function renderArtifacts() {
  if (!Array.isArray(artifacts)) {
    $artifactList.innerHTML = "";
    return;
  }
  $artifactList.innerHTML = artifacts
    .map((entry, index) => {
      const title = entry.title ?? `Artifact ${index + 1}`;
      const details = entry.details ?? "";
      return /* html */ `
        <div class="artifact col py-3" data-index="${index}">
          <div class="card h-100">
            <div class="card-body">
              <h5 class="card-title artifact-title">${title}</h5>
              <p class="card-text artifact-details">${details}</p>
            </div>
            <div class="card-footer">
              <div class="result"></div>
              <div class="outcome"></div>
              <div class="stats small text-secondary font-monospace mb-3"></div>
              <div>${testButton(index)}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

$artifactList.addEventListener("click", async (e) => {
  const $trigger = e.target.closest(".test-artifact");
  if (!$trigger) return;
  const index = Number($trigger.dataset.index);
  const artifact = artifacts?.[index];
  if (!artifact) return;

  const promptInput = document.getElementById("analysis-prompt");
  const evaluationSystemPrompt = (promptInput?.value?.trim() || domains[domain].prompts?.evaluation?.system || "")
    .trim();
  if (!evaluationSystemPrompt) {
    alert("Please provide an evaluation prompt before testing artifacts.");
    return;
  }

  const evaluationTemplate = domains[domain].prompts?.evaluation?.userTemplate;
  const body = buildMessages(
    evaluationSystemPrompt,
    typeof evaluationTemplate === "function"
      ? evaluationTemplate({ artifact, datasetSummary })
      : evaluationTemplate || datasetSummary || "",
  );

  const $resultContainer = $trigger.closest(".card");
  const $result = $resultContainer.querySelector(".result");
  const $outcome = $resultContainer.querySelector(".outcome");
  const $stats = $resultContainer.querySelector(".stats");
  let generatedContent = "";
  $result.innerHTML = loading;
  await stream(body, (c) => {
    generatedContent = c;
    $result.innerHTML = marked.parse(c);
  });

  const codeBlocks = [...generatedContent.matchAll(/```python\n*([\s\S]*?)\n```(\n|$)/g)];
  let code = codeBlocks.length ? codeBlocks.at(-1)[1] : generatedContent;
  code += `\n\nexecute(${["pd.DataFrame(data)"]})`;

  $outcome.classList.remove("success", "failure");
  $outcome.innerHTML = loading;

  const listener = async (event) => {
    const { result, error } = event.data;
    pyodideWorker.removeEventListener("message", listener);

    if (error) {
      $outcome.innerHTML = `<pre class="alert alert-danger">${error}</pre>`;
      return;
    }
    $outcome.classList.add(result?.success ? "success" : "failure");
    $stats.innerHTML = /* html */ `<p class="mt-2 mb-0">${result?.summary || result[1]}</p>`;
    if (domains[domain].prompts?.interpretation?.system && domains[domain].prompts?.interpretation?.userTemplate) {
      const interpretationBody = buildMessages(
        domains[domain].prompts?.interpretation.system,
        domains[domain].prompts?.interpretation.userTemplate({
          artifact,
          datasetSummary,
          result: JSON.stringify(result),
        }),
      );
      await stream(interpretationBody, (c) => {
        $outcome.innerHTML = marked.parse(c);
      });
    } else {
      $outcome.innerHTML = `<p class="mb-0">Result: ${success ? "Pass" : "Fail"} (${scoreLabel}=${formattedScore})</p>`;
    }

    $result.innerHTML = /* html */ `<details>
      <summary class="h5 my-3">Analysis</summary>
      ${marked.parse(generatedContent)}
    </details>`;
  };

  $outcome.innerHTML = loading;
  pyodideWorker.addEventListener("message", listener);
  pyodideWorker.postMessage({ id: "1", code, data, context: artifact });
});

on("run-all", () => {
  const $cards = [...document.querySelectorAll(".artifact")];
  const $pending = $cards.filter((d) => !d.querySelector(".outcome").textContent.trim());
  $pending.forEach((el) => el.querySelector(".test-artifact").click());
});

on("synthesize", async () => {
  const testedArtifacts = [...document.querySelectorAll(".artifact")]
    .map((card) => ({
      title: card.querySelector(".artifact-title")?.textContent ?? "",
      details: card.querySelector(".artifact-details")?.textContent ?? "",
      outcome: card.querySelector(".outcome")?.textContent.trim() ?? "",
    }))
    .filter((entry) => entry.outcome);

  if (!testedArtifacts.length) {
    alert("Please test at least one artifact before summarizing.");
    return;
  }

  const body = buildMessages(
    domains[domain].prompts?.synthesis?.system || "Summarize the evaluated artifacts.",
    (domains[domain].prompts?.synthesis?.userTemplate
      && domains[domain].prompts.synthesis.userTemplate({ artifacts: testedArtifacts }))
      || testedArtifacts.map((entry) => `Title: ${entry.title}\nResult: ${entry.outcome}`).join("\n\n"),
  );

  $summaryResult.innerHTML = loading;
  await stream(body, (c) => {
    $summaryResult.innerHTML = marked.parse(c);
  });
});

on("reset", () => {
  for (const $card of document.querySelectorAll(".artifact")) {
    $card.querySelector(".result").innerHTML = testButton($card.dataset.index);
    const $outcome = $card.querySelector(".outcome");
    $outcome.textContent = "";
    $outcome.classList.remove("success", "failure");
  }
});

function init(domain) {
  $analysisPromptEl.value = domains[domain].prompts.evaluation.system;
  renderForm();
}

document.querySelector("#domain-selection").addEventListener("change", (e) => init(domain = e.target.value));
init(domain);

$status.innerHTML = "";

// Initialize SQLite
const sqlite3 = await sqlite3InitModule({ printErr: console.error });
