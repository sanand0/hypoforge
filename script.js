// import { render, html } from "https://cdn.jsdelivr.net/npm/lit-html@3/+esm";
import { asyncLLM } from "https://cdn.jsdelivr.net/npm/asyncllm@2";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { Marked } from "https://cdn.jsdelivr.net/npm/marked@13/+esm";
import hljs from "https://cdn.jsdelivr.net/npm/highlight.js@11/+esm";
import { parse } from "https://cdn.jsdelivr.net/npm/partial-json@0.1.7/+esm";
import saveform from "https://cdn.jsdelivr.net/npm/saveform@1.2";
import sqlite3InitModule from "https://esm.sh/@sqlite.org/sqlite-wasm@3.46.1-build3";

const pyodideWorker = new Worker("./pyworker.js", { type: "module" });

const $demoList = document.getElementById("demo-list");
const $fileInput = document.getElementById("file-input");
const $preview = document.getElementById("preview");
const $context = document.getElementById("context");
const $generate = document.getElementById("generate-hypotheses");
const $demoDropdown = document.getElementById("demo-dropdown");
const $hypotheses = document.getElementById("hypotheses");
const $hypothesisPrompt = document.getElementById("hypothesis-prompt");
const $synthesis = document.getElementById("synthesis");
const $synthesisResult = document.getElementById("synthesis-result");
const $status = document.getElementById("status");
const loading = /* html */ `<div class="text-center my-5"><div class="spinner-border" role="status"></div></div>`;

let data;
let description;
let hypotheses;

async function* llm(body) {
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
  const token = document.getElementById("apiKeyInput").value;
  if (token) request.headers.Authorization = `Bearer ${token}`;
  else request.credentials = "include";
  const baseURL = document.getElementById("baseUrlInput").value;
  for await (const event of asyncLLM(`${baseURL}/chat/completions`, request)) yield event;
};

saveform("#hypoforge-settings", { exclude: '[type="file"]' });

const marked = new Marked();
marked.use({
  renderer: {
    table(header, body) {
      return `<table class="table table-sm">${header}${body}</table>`;
    },
    code(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return /* html */ `<pre class="hljs language-${language}"><code>${hljs
        .highlight(code, { language })
        .value.trim()}</code></pre>`;
    },
  },
});

// Load configurations and render the demos
$status.innerHTML = loading;
const { demos } = await fetch("config.json").then((r) => r.json());
$demoList.innerHTML = demos
  .map(
    ({ title, body }, index) =>
      `<li><a class="dropdown-item demo" href="#" data-index="${index}"><div>${title}</div><small class="text-muted d-block">${body}</small></a></li>`
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

const describe = (data, col) => {
  const values = data.map((d) => d[col]);
  const firstVal = values[0];
  if (typeof firstVal === "string") {
    // Return the top 3 most frequent values
    const freqMap = d3.rollup(
      values,
      (v) => v.length,
      (d) => d
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
  } else {
    // Load CSV as before
    return d3.csv(demo.href, d3.autoType);
  }
}

function drawPreview() {
  const head = Object.keys(data[0]);
  const rows = data.slice(0, 100);
  const header = head.map((d) => `<th>${d}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${head.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`)
    .join("");
  $preview.innerHTML = `<div class="table-responsive" style="max-height:300px;overflow:auto"><table class="table table-sm table-striped"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
  document.getElementById("context-section").classList.remove("d-none");
  $hypotheses.innerHTML = "";
}

// When the user selects a demo, load it and show preview
$demoList.addEventListener("click", async (e) => {
  e.preventDefault();
  const $demo = e.target.closest(".demo");
  if (!$demo) return;

  const demo = demos[+$demo.dataset.index];
  data = await loadData(demo);
  $hypothesisPrompt.value = demo.audience;
  $context.value = demo.context || "";
  $demoDropdown.textContent = demo.title;
  drawPreview();
  $synthesis.classList.add("d-none");
});

$fileInput.addEventListener("change", async () => {
  const file = $fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  data = d3.csvParse(text, d3.autoType);
  $hypothesisPrompt.value = "";
  $context.value = "";
  drawPreview();
  $demoDropdown.textContent = file.name;
  $synthesis.classList.add("d-none");
});

$generate.addEventListener("click", async () => {
  if (!data) return;
  const columnDescription = Object.keys(data[0])
    .map((col) => `- ${col}: ${describe(data, col)}`)
    .join("\n");
  const numColumns = Object.keys(data[0]).length;
  description = `The Pandas DataFrame df has ${data.length} rows and ${numColumns} columns:\n${columnDescription}`;
  const systemPrompt = $hypothesisPrompt.value;
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${description}\n\nContext:\n${$context.value}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "hypotheses", strict: true, schema: hypothesesSchema },
    },
  };

  $hypotheses.innerHTML = loading;
  for await (const { content } of llm(body)) {
    if (!content) continue;
    ({ hypotheses } = parse(content));
    drawHypotheses();
  }
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
            <div class="result">${testButton(index)}</div>
            <div class="outcome"></div>
          </div>
        </div>
      </div>
    `
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
  let generatedContent;
  for await (const { content } of llm(body)) {
    if (!content) continue;
    generatedContent = content;
    $result.innerHTML = marked.parse(content);
  }

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
          content: `Hypothesis: ${hypothesis.hypothesis}\n\n${description}\n\nResult: ${success}. p-value: ${num(
            pValue
          )}`,
        },
      ],
    };
    for await (const { content } of llm(body)) {
      if (!content) continue;
      $outcome.innerHTML = marked.parse(content);
    }
    $result.innerHTML = /* html */ `<details>
      <summary class="h5 my-3">Analysis</summary>
      ${marked.parse(generatedContent)}
    </details>`;
  };

  $outcome.innerHTML = loading;
  pyodideWorker.addEventListener("message", listener);
  pyodideWorker.postMessage({ id: "1", code, data, context: {} });
});

document.querySelector("#run-all").addEventListener("click", async (e) => {
  const $hypotheses = [...document.querySelectorAll(".hypothesis")];
  const $pending = $hypotheses.filter((d) => !d.querySelector(".outcome").textContent.trim());
  $pending.forEach((el) => el.querySelector(".test-hypothesis").click());
});

document.querySelector("#synthesize").addEventListener("click", async (e) => {
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
  for await (const { content } of llm(body)) {
    if (!content) continue;
    $synthesisResult.innerHTML = marked.parse(content);
  }
});

document.querySelector("#reset").addEventListener("click", async (e) => {
  for (const $hypothesis of document.querySelectorAll(".hypothesis")) {
    $hypothesis.querySelector(".result").innerHTML = testButton($hypothesis.dataset.index);
    $hypothesis.querySelector(".outcome").textContent = "";
  }
});

$status.innerHTML = "";

// Initialize SQLite
const sqlite3 = await sqlite3InitModule({ printErr: console.error });
