// Centralized prompts and schemas for Hypothesis Forge
// Switch ANALYSIS to 'modeling' to toggle the active config

const ANALYSIS = 'hypotheses'; // 'hypotheses' | 'modeling'

// Hypotheses analysis configuration
const hypotheses = (() => {
  const hypothesesSchema = {
    type: 'object',
    properties: {
      hypotheses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hypothesis: { type: 'string' },
            benefit: { type: 'string' },
          },
          required: ['hypothesis', 'benefit'],
          additionalProperties: false,
        },
      },
    },
    required: ['hypotheses'],
    additionalProperties: false,
  };

  const codeSystemPrompt = `You are an expert data analyst. Test the given hypothesis on the provided Pandas DataFrame (df) as follows:

1. Create derived columns ONLY IF REQUIRED. E.g. If "CurrentMedication" contains "insulin", classify it as "Injectable", otherwise as "Pill".
2. If that's not possible, provide the best possible answer based on available data to the hypothesis, making assumptions.
3. Use the appropriate hypothesis test, e.g. t-test, chi-square, correlation significance test, etc.
4. Return the results as (success: bool, p_value: float)

Write the code as follows:

\`\`\`python
import pandas as pd
import scipy.stats as stats

def test_hypothesis(df) -> (bool, float):
    # use the imported modules to test the hypothesis
    return result, p_value
\`\`\``;

  const prompts = {
    // Generate list of hypotheses
    list: ({ analysisContext, description }) => ({
      messages: [
        { role: 'system', content: analysisContext },
        { role: 'user', content: description },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'hypotheses', strict: true, schema: hypothesesSchema },
      },
    }),

    // Interpret a single hypothesis outcome
    interpretItem: ({ hypothesis, description, success, pValue }) => ({
      messages: [
        {
          role: 'system',
          content:
            `You are an expert data analyst.\n` +
            `Given a hypothesis and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.\n` +
            `Highlight in **bold** the keywords in the supporting statements.\n` +
            `Do not mention the p-value but _interpret_ it to support the conclusion quantitatively.`,
        },
        {
          role: 'user',
          content: `Hypothesis: ${hypothesis}\n\n${description}\n\nResult: ${success}. p-value: ${pValue}`,
        },
      ],
    }),

    // Synthesize across hypotheses and outcomes
    synthesize: ({ items }) => ({
      messages: [
        {
          role: 'system',
          content:
            `Given the below hypotheses and results, summarize the key takeaways and actions in Markdown.\n` +
            `Begin with the hypotheses with lowest p-values AND highest business impact. Ignore results with errors.\n` +
            `Use action titles has H5 (#####). Just reading titles should tell the audience EXACTLY what to do.\n` +
            `Below each, add supporting bullet points that\n` +
            `  - PROVE the action title, mentioning which hypotheses led to this conclusion.\n` +
            `  - Do not mention the p-value but _interpret_ it to support the action\n` +
            `  - Highlight key phrases in **bold**.\n` +
            `Finally, after a break (---) add a 1-paragraph executive summary section (H5) summarizing these actions.\n`,
        },
        {
          role: 'user',
          content: items
            .map((h) => `Hypothesis: ${h.title}\nBenefit: ${h.benefit}\nResult: ${h.outcome}`)
            .join('\n\n'),
        },
      ],
    }),

    // (concise insights removed)
  };

  return {
    type: 'hypotheses',
    schemas: { list: hypothesesSchema },
    defaults: { codeSystemPrompt },
    prompts,
  };
})();

// Modeling analysis configuration
const modeling = (() => {
  // Note: We keep experiments generation as json_object to match current behavior.
  // A tighter schema is provided but not enforced by default.
  const modelingSchema = {
    type: 'object',
    properties: {
      experiments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            problem_type: { type: 'string' },
            target: { type: ['string', 'null'] },
            split: {
              type: 'object',
              properties: {
                test_size: { type: 'number' },
                random_state: { type: 'number' },
                stratify: { type: ['boolean', 'string', 'null'] },
              },
              required: ['test_size', 'random_state'],
              additionalProperties: true,
            },
            models: { type: 'array', items: { type: 'string' } },
            metrics: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['title', 'problem_type', 'split', 'models'],
          additionalProperties: true,
        },
      },
    },
    required: ['experiments'],
    additionalProperties: false,
  };

  const planSystemPrompt = `You are an expert ML engineer. Propose a series of modeling experiments for the user's question and dataset. STRICTLY order experiments by increasing complexity: start with the simplest single-model baselines, then progress through regularized linear methods, shallow trees, bagging, boosting, and finally stacked/voting combinations. Do NOT include any ensemble/stacking before the simpler families are covered.

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

  const codeSystemPrompt = `You are an expert ML engineer.
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

  const interpretSystemPrompt = `Write a clear, decision-ready analysis in Markdown. Use this structure:\n\n##### Headline finding\n\n- Best Model: <model> — why it wins given the metrics\n- Problem: <classification|regression> — Target: <target> — Split: test_size and notes\n\n###### Ranked Comparison\n- Rank top models with 1 short reason each (interpret metrics; do not dump raw numbers).\n\n###### Key Insights\n- 2–4 insights the audience can act on (tie to the question).\n\n###### Risks & Limitations\n- 1–2 caveats (e.g., class imbalance, overfitting risk, data gaps).\n\n###### Next Steps\n- 2 concrete follow-ups (e.g., feature ideas, data collection, validation).\n\nGuidelines:\n- Interpret metrics; avoid raw number spam.\n- Use **bold** to highlight key phrases.\n- If confusion_matrix exists, comment on precision/recall trade-offs.`;

  const prompts = {
    // Build modeling experiments
    list: ({ analysisContext, description }) => ({
      messages: [
        { role: 'system', content: planSystemPrompt },
        { role: 'user', content: `${description}\n\nQuestion: ${analysisContext}` },
      ],
      // Keep broad to preserve behavior across providers
      response_format: { type: 'json_object' },
      // To enforce strict output, switch to: { type: 'json_schema', json_schema: { name: 'experiments', strict: true, schema: modelingSchema } }
    }),

    // Generate modeling code
    code: ({ plan, description }) => ({
      messages: [
        { role: 'system', content: codeSystemPrompt },
        { role: 'user', content: `Dataset:\n${description}\n\nPlan:\n${JSON.stringify(plan)}` },
      ],
    }),

    // Interpret modeling results
    interpretItem: ({ analysisContext, plan, result }) => ({
      messages: [
        { role: 'system', content: interpretSystemPrompt },
        {
          role: 'user',
          content: `Question: ${analysisContext}\nPlan: ${plan.title}\nProblem: ${result.problem_type}\nTarget: ${result.target}\nBest: ${result.best}\nSplit: ${JSON.stringify(plan.split)}\nPlannedModels: ${JSON.stringify(plan.models)}\nModels: ${JSON.stringify(result.models)}\nConfusionMatrix: ${JSON.stringify(result.confusion_matrix)}`,
        },
      ],
    }),

    // (concise insights removed)
  };

  return {
    type: 'modeling',
    schemas: { list: modelingSchema },
    defaults: { codeSystemPrompt },
    prompts,
  };
})();

// Data Quality configuration
const quality = (() => {
  const planSystemPrompt = `You are a senior data quality engineer. Analyze the dataset and plan a sequence of data quality agents to improve it.

Respond ONLY with a JSON object of the form { "agents": [...] } and nothing else.

Each agent is a concise step that fixes a specific issue. For each agent include keys:
- title: short action name (e.g., "Deduplicate Rows", "Impute Missing", "Normalize Categories", "Parse Dates", "Fix Types", "Outlier Handling", "Trim Whitespace", "Drop Impossible Values")
- problem: one line describing the issue it solves
- approach: the transformation strategy in 1-2 lines
- columns: array of column names this applies to (or [] if all/auto)
- priority: integer 1..5 (1 earliest, 5 latest)

Rules:
- Start with safe, high-value fixes (trim/strip, standardize booleans, parse dates, fix types), then deduplicate, handle missing, normalize categories, and only then outliers.
- Keep 5–8 agents total, sorted by priority ascending.`;

  const codeSystemPrompt = `You are a Python data quality engineer. Generate robust, compact pandas code to execute the given data-quality agent on df.

Constraints:
- Use only pandas and numpy. Avoid heavy external libs.
- Do not mutate the input df in place; create df2 = df.copy() and modify df2.
- Implement only the scope of the current agent.
- Return a dict with keys:
  - summary: short, human-readable one-liner of what changed
  - rows_before, rows_after: ints
  - columns: list of columns affected
  - csv: the cleaned dataset as CSV text (df2.to_csv(index=False))

Define exactly this function and output only one Python code block:
\`\`\`python
import pandas as pd
import numpy as np
from typing import Dict, Any, List

def run_quality(df: pd.DataFrame, plan: Dict[str, Any]) -> Dict[str, Any]:
    # plan keys: title, problem, approach, columns (List[str]), priority (int)
    df2 = df.copy()
    cols: List[str] = plan.get('columns') or []
    title = (plan.get('title') or '').lower()

    # Example heuristics; implement common fixes guarded by column existence
    # 1) Trim whitespace for object columns
    if 'trim' in title or (not cols and 'whitespace' in (plan.get('problem') or '').lower()):
        for c in df2.select_dtypes(include=['object']).columns:
            df2[c] = df2[c].astype(str).str.strip()

    # 2) Parse dates
    if 'date' in title or 'parse date' in title:
        targets = cols or [c for c in df2.columns if 'date' in c.lower()]
        for c in targets:
            if c in df2.columns:
                try:
                    df2[c] = pd.to_datetime(df2[c], errors='coerce')
                except Exception:
                    pass

    # 3) Fix dtypes (e.g., numeric strings)
    if 'type' in title or 'dtype' in title:
        targets = cols or list(df2.columns)
        for c in targets:
            if c in df2.columns and df2[c].dtype == 'object':
                try:
                    df2[c] = pd.to_numeric(df2[c], errors='ignore')
                except Exception:
                    pass

    # 4) Deduplicate
    if 'duplicate' in title or 'deduplicate' in title:
        before = len(df2)
        df2 = df2.drop_duplicates()
        after = len(df2)
    else:
        before = len(df)
        after = len(df2)

    # 5) Handle missing
    if 'missing' in title or 'impute' in title:
        targets = cols or list(df2.columns)
        for c in targets:
            if c in df2.columns:
                if pd.api.types.is_numeric_dtype(df2[c]):
                    df2[c] = df2[c].fillna(df2[c].median())
                else:
                    df2[c] = df2[c].fillna('missing')

    # 6) Normalize categories (lowercase, unify yes/no, true/false)
    if 'normalize' in title or 'category' in title:
        targets = cols or list(df2.select_dtypes(include=['object']).columns)
        for c in targets:
            if c in df2.columns and pd.api.types.is_object_dtype(df2[c]):
                s = df2[c].astype(str).str.strip()
                s_low = s.str.lower()
                s_low = s_low.replace({'yes':'yes','y':'yes','true':'yes','no':'no','n':'no','false':'no'})
                df2[c] = s_low

    result = {
        'summary': f"{plan.get('title', 'Quality step')} applied",
        'rows_before': int(before),
        'rows_after': int(len(df2)),
        'columns': list(df2.columns),
        'csv': df2.to_csv(index=False),
    }
    return result
\`\`\``;

  const interpretSystemPrompt = `Write a concise Markdown note explaining the effect of this data-quality agent:
- 1-line headline (#####) describing the fix
- A few bullets: what changed (rows/columns), risks/assumptions, and next follow-up step
- Keep it crisp and decision-focused.`;

  const prompts = {
    list: ({ analysisContext, description }) => ({
      messages: [
        { role: 'system', content: planSystemPrompt },
        { role: 'user', content: `${description}\n\nObjective: Improve data quality for — ${analysisContext}` },
      ],
      response_format: { type: 'json_object' },
    }),
    code: ({ plan, description, analysisContext }) => ({
      messages: [
        { role: 'system', content: codeSystemPrompt },
        { role: 'user', content: `Dataset:\n${description}\n\nAgent:\n${JSON.stringify(plan)}` },
      ],
    }),
    interpretItem: ({ plan, result }) => ({
      messages: [
        { role: 'system', content: interpretSystemPrompt },
        { role: 'user', content: `Agent: ${plan.title}\nChanges: rows ${result.rows_before} -> ${result.rows_after}; Columns: ${result.columns?.length}` },
      ],
    }),

    // (concise insights removed)
  };

  return {
    type: 'quality',
    schemas: {},
    defaults: { codeSystemPrompt },
    prompts,
  };
})();

const configs = { hypotheses, modeling, quality };
const active = configs[ANALYSIS];

export { ANALYSIS, configs };
export default active;
