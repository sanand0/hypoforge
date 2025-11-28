// Configuration-driven domain definitions for the app
export const DOMAINS = {
  hypothesis: {
    uiSchema: [
      {
        id: "analysis-context",
        label: "Analysis Context",
        type: "textarea",
        placeholder:
          "E.g., Generate insights for pharmaceutical launch effectiveness, analyze customer behavior patterns, identify optimization opportunities...",
        required: true,
        prefillFromDemo: "audience",
      },
    ],
    systemPrompt:
      "You are HypoForge, an expert research strategist. Produce a concise list of high-impact hypotheses tailored to the provided context and dataset characteristics.",
    userPromptTemplate: ({ formData, datasetSummary }) => {
      const context = (formData["analysis-context"] || "").trim() || "Use the dataset details to guide your hypotheses.";
      return `Context:\n${context}\n\nDataset Description:\n${datasetSummary}\n\nReturn diverse hypotheses that are actionable and testable.`;
    },
    responseSchema: {
      format: {
        type: "json_schema",
        json_schema: {
          name: "hypotheses",
          strict: true,
          schema: {
            type: "object",
            properties: {
              hypotheses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    hypothesis: { type: "string" },
                    benefit: { type: "string" },
                  },
                  required: ["hypothesis", "benefit"],
                  additionalProperties: false,
                },
              },
            },
            required: ["hypotheses"],
            additionalProperties: false,
          },
        },
      },
      collectionKey: "hypotheses",
      displayFields: {
        title: "hypothesis",
        description: "benefit",
      },
      detailFields: [],
    },
    execution: {
      callable: "test_hypothesis",
    },
    evaluationMeta: {
      scoreLabel: "p-value",
    },
    prompts: {
      evaluation: {
        system: `You are an expert data analyst. Test the given hypothesis on the provided Pandas DataFrame (df) as follows:

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
\`\`\`
`,
        userTemplate: ({ artifact, datasetSummary }) =>
          `Hypothesis: ${artifact.hypothesis}\n\n${datasetSummary}`,
      },
      interpretation: {
        system: `You are an expert data analyst.
Given a hypothesis and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.
Highlight in **bold** the keywords in the supporting statements.
Do not mention the p-value but _interpret_ it to support the conclusion quantitatively.`,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          `Hypothesis: ${artifact.hypothesis}\n\n${datasetSummary}\n\nResult: ${result.success}. Score: ${result.formattedScore}`,
      },
      synthesis: {
        system: `Given the below hypotheses and results, summarize the key takeaways and actions in Markdown.
Begin with the hypotheses with lowest p-values AND highest business impact. Ignore results with errors.
Use action titles has H5 (#####). Just reading titles should tell the audience EXACTLY what to do.
Below each, add supporting bullet points that
  - PROVE the action title, mentioning which hypotheses led to this conclusion.
  - Do not mention the p-value but _interpret_ it to support the action
  - Highlight key phrases in **bold**.
Finally, after a break (---) add a 1-paragraph executive summary section (H5) summarizing these actions.
`,
        userTemplate: ({ artifacts }) =>
          artifacts
            .map(
              (entry) =>
                `Hypothesis: ${entry.title}\nBenefit: ${entry.description}\nResult: ${entry.outcome}`,
            )
            .join("\n\n"),
      },
    },
  },
  modeling: {
    requiresTarget: true,
    uiSchema: [
      {
        id: "analysis-context",
        label: "Modeling Context",
        type: "textarea",
        placeholder:
          "Describe the business question, stakeholders, and any deployment constraints that the model must respect.",
        required: true,
        prefillFromDemo: "audience",
      },
    ],
    systemPrompt: `You are an expert ML engineer. Propose a series of modeling experiments for the user's question and dataset. STRICTLY order experiments by increasing complexity: start with the simplest single-model baselines, then progress through regularized linear methods, shallow trees, bagging, boosting, and finally stacked/voting combinations. Do NOT include any ensemble/stacking before the simpler families are covered.

Respond ONLY with a JSON object of the form { "experiments": [...] } and nothing else.

For each experiment, include exactly these keys:
- problem_type: "classification" | "regression" | ... -- Explain why?
- title: short, business-friendly title (3-5 words, no jargon) tailored to the question (e.g., "Baseline Churn Benchmark", "Explainable Risk Score", "Robust Customer Segmenter", "Max-Accuracy Fraud Alert")
- target: pick the most relevant EXISTING column name from the dataset summary (sales, revenue, churn_flag, etc.). Never leave it null; if unsure, choose the closest candidate and justify it briefly in notes.
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
- Prefer setting target to a column name present in df; only use null if truly ambiguous or no sensible target exists.`,
    userPromptTemplate: ({ formData, datasetSummary }) => {
      const context = (formData["analysis-context"] || "").trim();
      return `Dataset Summary:\n${datasetSummary}\n\nBusiness Question:\n${context || "Focus on the most commercially relevant outcome such as revenue, units sold, conversion, or risk."}\n\nReturn ONLY the JSON payload described in the system prompt (no markdown, no commentary).`;
    },
    responseSchema: {
      format: {
        type: "json_schema",
        json_schema: {
          name: "model_experiments",
          strict: true,
          schema: {
            type: "object",
            properties: {
              experiments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    problem_type: { type: "string" },
                    target: { type: "string" },
                    split: {
                      type: "object",
                      properties: {
                        test_size: { type: "number" },
                        random_state: { type: "number" },
                        stratify: { type: ["boolean", "string", "null"] },
                      },
                      required: ["test_size", "random_state", "stratify"],
                      additionalProperties: false,
                    },
                    models: { type: "array", items: { type: "string" } },
                    metrics: { type: "array", items: { type: "string" } },
                    notes: { type: "string" },
                  },
                  required: ["title", "problem_type", "target", "split", "models", "metrics", "notes"],
                  additionalProperties: false,
                },
              },
            },
            required: ["experiments"],
            additionalProperties: false,
          },
        },
      },
      collectionKey: "experiments",
      displayFields: {
        title: "title",
        description: "notes",
      },
      detailFields: [
        { id: "problem_type", label: "Problem Type" },
        { id: "target", label: "Target Column" },
        { id: "models", label: "Models" },
        { id: "metrics", label: "Metrics" },
        { id: "split", label: "Split" },
      ],
    },
    execution: {
      callable: "run_models",
      passArtifact: true,
    },
    evaluationMeta: {
      scoreLabel: "Metric",
    },
    prompts: {
      evaluation: {
        system: `You are an expert ML engineer.
Generate concise, robust Python to implement the given modeling experiment on df.
Requirements:
- Detect/confirm problem type and target (use plan.target if provided; else infer sensibly from df and plan.problem_type).
- Train/test split using plan.split (default test_size=0.2, random_state=42; use stratify when classification if possible).
- Preprocess with ColumnTransformer: numeric -> impute median + StandardScaler; categorical -> impute 'missing' + OneHotEncoder(handle_unknown='ignore'). For OneHotEncoder, prefer sparse_output=False (scikit-learn >= 1.2); if that raises TypeError, fallback to sparse=False.
- Fit models listed in plan.models (fallback gracefully for unavailable models).
- Compute metrics:
  * Classification: accuracy, precision_weighted, recall_weighted, f1_weighted, roc_auc_ovr (guard with try/except), confusion_matrix
  * Regression: r2, rmse, mae, mse (rmse = sqrt(mse))
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
\`\`\``,
        userTemplate: ({ artifact, datasetSummary }) =>
          `Dataset:\n${datasetSummary}\n\nPlan:\n${JSON.stringify(artifact, null, 2)}`,
      },
      interpretation: {
        system: `Produce a SHORT, decision-ready Markdown summary focusing only on the top findings.

Output format (nothing more):

##### <Headline insight>
- Best: <model> — <one crisp reason referencing metrics qualitatively>
- Watch-out: <one risk or limitation>
- Next: <one concrete follow-up action>

Rules:
- Keep each bullet to a single sentence.
- Use **bold** for the most important phrase in each bullet.
- Mention precision/recall trade-offs only if confusion_matrix is provided.
- No additional sections, tables, or long prose.`,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          `Dataset Context:\n${datasetSummary}\n\nPlan: ${artifact.title}\nProblem: ${result.problem_type}\nTarget: ${result.target}\nBest: ${result.best}\nSplit: ${JSON.stringify(
            artifact.split,
          )}\nPlannedModels: ${JSON.stringify(artifact.models)}\nModels: ${JSON.stringify(result.models)}\nConfusionMatrix: ${JSON.stringify(result.confusion_matrix)}`,
      },
      synthesis: {
        system: `Summarize evaluated modeling plans as deployment recommendations with H5 headings. Each heading should call out when to prioritize the plan. Add bullet points citing which plans support the recommendation and the qualitative meaning of the metrics. Finish with --- and an executive brief.`,
        userTemplate: ({ artifacts }) =>
          artifacts
            .map(
              (entry) =>
                `Model plan: ${entry.title}\nObjective: ${entry.description}\nResult: ${entry.outcome}`,
            )
            .join("\n\n"),
      },
    },
  },
};

export const APP_CONFIG = {
  activeType: "hypothesis",
  domains: DOMAINS,
};

export default APP_CONFIG;