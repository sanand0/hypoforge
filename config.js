const CONTEXT_FIELD_ID = "analysis-context";

const BASE_CONTEXT_FIELD = {
  id: CONTEXT_FIELD_ID,
  type: "textarea",
  required: true,
  prefillFromDemo: "audience",
};

const DEFAULT_CONTEXT = {
  label: "Analysis Context",
  placeholder: "Describe the business context...",
};

const defaultUserPromptTemplate = ({ formData, datasetSummary }) =>
  `Context:\n${formData[CONTEXT_FIELD_ID]}\n\nData:\n${datasetSummary}`;

const createContextSchema = (overrides = {}) => {
  const { label, placeholder, ...rest } = { ...DEFAULT_CONTEXT, ...overrides };
  return [
    {
      ...BASE_CONTEXT_FIELD,
      ...rest,
      label,
      placeholder,
    },
  ];
};

const DEFAULT_TESTS_SCHEMA = {
  name: "tests",
  titleDescription: "Short, plain-language title",
  detailsDescription: "Explain the reasoning, test, and next step.",
};

const formatArtifactText = (artifact, fallback = "Unspecified artifact") => {
  if (!artifact || typeof artifact !== "object") return fallback;
  const candidates = [artifact.hypothesis, artifact.title, artifact.details];
  const text = candidates.find((value) => typeof value === "string" && value.trim());
  return text || fallback;
};

const HYPOTHESIS_INTERPRETATION_PROMPT = `You are an expert data analyst.
Given a hypothesis and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.
Highlight in **bold** the keywords in the supporting statements.
Do not mention the p-value but _interpret_ it to support the conclusion quantitatively.`;

const MODELING_INTERPRETATION_PROMPT = `Produce a SHORT, decision-ready Markdown summary focusing only on the top findings.

Output format (nothing more):

##### <Headline insight>
- Best: <model> - <one crisp reason referencing metrics qualitatively>
- Watch-out: <one risk or limitation>
- Next: <one concrete follow-up action>

Rules:
- Keep each bullet to a single sentence.
- Use **bold** for the most important phrase in each bullet.
- Mention precision/recall trade-offs only if confusion_matrix is provided.
- No additional sections, tables, or long prose.`;

const createResponseSchema = (overrides = {}) => {
  const { name, titleDescription, detailsDescription } = { ...DEFAULT_TESTS_SCHEMA, ...overrides };
  return {
    format: {
      type: "json_schema",
      json_schema: {
        name,
        strict: true,
        schema: {
          type: "object",
          properties: {
            tests: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: titleDescription },
                  details: { type: "string", description: detailsDescription },
                },
                required: ["title", "details"],
                additionalProperties: false,
              },
            },
          },
          required: ["tests"],
          additionalProperties: false,
        },
      },
    },
  };
};

const DEFAULT_DOMAIN_CONFIG = {
  context: DEFAULT_CONTEXT,
  systemPrompt: "",
  userPromptTemplate: defaultUserPromptTemplate,
  testsSchema: DEFAULT_TESTS_SCHEMA,
  execution: {},
  evaluationMeta: {},
  prompts: {},
};

const createDomain = (definition = {}) => {
  const merged = { ...DEFAULT_DOMAIN_CONFIG, ...definition };
  const context = { ...DEFAULT_CONTEXT, ...(definition.context || {}) };
  const testsSchema = { ...DEFAULT_TESTS_SCHEMA, ...(definition.testsSchema || {}) };

  return {
    uiSchema: createContextSchema(context),
    systemPrompt: merged.systemPrompt,
    userPromptTemplate: merged.userPromptTemplate,
    responseSchema: createResponseSchema(testsSchema),
    execution: merged.execution,
    evaluationMeta: merged.evaluationMeta,
    prompts: merged.prompts,
  };
};

const DOMAIN_BLUEPRINTS = [
  {
    key: "hypothesis",
    context: {
      placeholder:
        "E.g., Generate insights for pharmaceutical launch effectiveness, analyze customer behavior patterns, identify optimization opportunities...",
    },
    testsSchema: {
      name: "hypotheses",
      titleDescription: "Short, business-friendly hypothesis title (4-8 words, no jargon)",
      detailsDescription: "2-3 sentences: Business benefit of hypothesis, how to test, action to take",
    },
    systemPrompt: "Propose high-impact hypotheses tailored to the provided context and dataset characteristics",
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
          `Hypothesis: ${formatArtifactText(artifact, "Unspecified hypothesis")}\n\n${datasetSummary}`,
      },
      interpretation: {
        system: HYPOTHESIS_INTERPRETATION_PROMPT,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          `Hypothesis: ${formatArtifactText(artifact, "Unspecified hypothesis")}\n\n${datasetSummary}\n\nResult: ${result.success}. Score: ${result.formattedScore}`,
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
              (entry) => `Hypothesis: ${entry.title}\nDescription: ${entry.description}\nResult: ${entry.outcome}`,
            )
            .join("\n\n"),
      },
    },
  },
  {
    key: "modeling",
    context: {
      label: "Modeling Context",
      placeholder:
        "Describe the business question, stakeholders, and any deployment constraints that the model must respect.",
    },
    testsSchema: {
      name: "models",
      titleDescription: "Short, business-friendly model intent (4-8 words, no jargon)",
      detailsDescription: "WHY this experiment, target column, model to run, eval metric, train/test split.",
    },
    systemPrompt:
      "Propose high-impact modeling experiments of increasing sophistication for the user's question and dataset",
    execution: { callable: "run_models" },
    evaluationMeta: { scoreLabel: "Metric" },
    prompts: {
      evaluation: {
        system: `You are an expert ML engineer.
Generate concise, robust Python that executes the exact modeling experiment described by the user-provided text.
Requirements:
- Treat the description as the only "plan". Honor any stated target, split, model, or preprocessing directive. When information is missing, infer sensible defaults from df.
- Always determine a target column. Prefer explicit "Target: <column>"; otherwise infer from context or choose a numeric/business-relevant column.
- If no split is specified, default to train_test_split(test_size=0.2, random_state=42) and stratify for classification when possible.
- Preprocess with ColumnTransformer: numeric -> SimpleImputer(strategy="median") + StandardScaler; categorical -> SimpleImputer(fill_value="missing") + OneHotEncoder(handle_unknown="ignore", sparse_output=False) (fallback to sparse=False if needed).
- Train/evaluate the requested model(s); gracefully fallback if unavailable.
- Compute metrics:
  * Classification: accuracy, precision_weighted, recall_weighted, f1_weighted, roc_auc_ovr (guard with try/except), confusion_matrix
  * Regression: r2, rmse, mae, mse (rmse = sqrt(mse))
- Return dict: { target, models: [{name, metrics}], best, confusion_matrix|null, summary }
- Code must define run_models(df) exactly as below and return ONLY one Python block:
\`\`\`python
import pandas as pd
import numpy as np
from typing import Dict, Any

def run_models(df: pd.DataFrame) -> dict:
    ...
\`\`\`
- If scikit-learn is unavailable, fall back to deterministic baselines using pandas/numpy/scipy.`,
        userTemplate: ({ artifact, datasetSummary }) => {
          const description = formatArtifactText(artifact, "").trim();
          const sections = [];
          if (description) sections.push(`PRIMARY EXPERIMENT DESCRIPTION:\n${description}`);
          sections.push(`Dataset Summary:\n${datasetSummary}`);
          return sections.join("\n\n");
        },
      },
      interpretation: {
        system: MODELING_INTERPRETATION_PROMPT,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          `Dataset Context:\n${datasetSummary}\n\nPlan: ${formatArtifactText(artifact, "Modeling plan")}\nTarget: ${result.target}\nBest: ${result.best}\nSplit: ${
            JSON.stringify(artifact.split)
          }\nPlannedModels: ${JSON.stringify(artifact.models)}\nModels: ${
            JSON.stringify(result.models)
          }\nConfusionMatrix: ${JSON.stringify(result.confusion_matrix)}`,
      },
      synthesis: {
        system:
          `Summarize evaluated modeling plans as deployment recommendations with H5 headings. Each heading should call out when to prioritize the plan. Add bullet points citing which plans support the recommendation and the qualitative meaning of the metrics. Finish with --- and an executive brief.`,
        userTemplate: ({ artifacts }) =>
          artifacts
            .map(
              (entry) => `Model plan: ${entry.title}\nObjective: ${entry.details}\nResult: ${entry.outcome}`,
            )
            .join("\n\n"),
      },
    },
  },
];

export const DOMAINS = DOMAIN_BLUEPRINTS.reduce((acc, blueprint) => {
  const { key, ...config } = blueprint;
  acc[key] = createDomain(config);
  return acc;
}, {});

export const APP_CONFIG = {
  activeType: "hypothesis",
  domains: DOMAINS,
};

export default APP_CONFIG;
