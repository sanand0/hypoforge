
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.mjs";

const pyodideReadyPromise = loadPyodide();

self.onmessage = async (event) => {
  // make sure loading is done
  const pyodide = await pyodideReadyPromise;
  const { id, code, data, context } = event.data;

  // Now load any packages we need
  await pyodide.loadPackagesFromImports(code);
  // Build a fresh globals mapping for each run and convert JS values to Python
  const dict = pyodide.globals.get("dict");
  const globals = dict();
  if (context && typeof context === "object") {
    for (const [k, v] of Object.entries(context)) {
      globals.set(k, pyodide.toPy(v));
    }
  }
  globals.set("data", pyodide.toPy(data));
  try {
    const resultProxy = await pyodide.runPythonAsync(code, { globals });
    // Convert Python objects to plain JS, ensuring dict -> plain object (not Map)
    // and deeply converting nested structures so they are structured-cloneable.
    let result;
    try {
      result = resultProxy?.toJs
        ? resultProxy.toJs({ dict_converter: Object.fromEntries, depth: 20 })
        : resultProxy;
    } finally {
      // Free proxy if applicable to avoid leaks in the long-lived worker
      try { resultProxy?.destroy?.(); } catch {}
    }
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
    return;
  }
};
