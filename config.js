const schema = ({ name, title, details }) => ({
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
                title: { type: "string", description: title },
                details: { type: "string", description: details },
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
});

const getText = (artifact, missing = "") =>
  [artifact?.hypothesis, artifact?.title, artifact?.details].find(
    (value) => typeof value === "string" && value.trim(),
  ) || missing;

const contextPrompt = ({ formData, datasetSummary }) =>
  `Context:\n${formData["analysis-context"]}\n\nData:\n${datasetSummary}`;

export default {
  hypothesis: {
    uiSchema: [
      {
        id: "analysis-context",
        type: "textarea",
        required: true,
        prefillFromDemo: "audience",
        label: "Analysis Context",
        placeholder:
          "E.g., Generate insights for pharmaceutical launch effectiveness, analyze customer behavior patterns, identify optimization opportunities...",
      },
    ],
    systemPrompt: "Propose high-impact hypotheses tailored to the provided context and dataset characteristics",
    userPromptTemplate: contextPrompt,
    responseSchema: schema({
      name: "hypotheses",
      title: "Short, business-friendly hypothesis title (4-8 words, no jargon)",
      details: "2-3 sentences: Business benefit of hypothesis, how to test, action to take",
    }),
    evaluationMeta: { scoreLabel: "p-value" },
    prompts: {
      evaluation: {
        system:
          `You are an expert data analyst. Test the given hypothesis on the provided Pandas DataFrame (df) as follows:

1. Create derived columns ONLY IF REQUIRED. E.g. If "CurrentMedication" contains "insulin", classify it as "Injectable", otherwise as "Pill".
2. If that's not possible, provide the best possible answer based on available data to the hypothesis, making assumptions.
3. Use the appropriate hypothesis test, e.g. t-test, chi-square, correlation significance test, etc.
4. Return the results as (success: bool, p_value: float)

Write the code as follows:

\`\`\`python
import pandas as pd
import scipy.stats as stats

def execute(df) -> (bool, float):
    # use the imported modules to test the hypothesis
    return result, p_value
\`\`\`
`,
        userTemplate: ({ artifact, datasetSummary }) =>
          `Hypothesis: ${getText(artifact, "Unspecified hypothesis")}\n\n${datasetSummary}`,
      },
      interpretation: {
        system: `You are an expert data analyst.
Given a hypothesis and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.
Highlight in **bold** the keywords in the supporting statements.
Do not mention the p-value but _interpret_ it to support the conclusion quantitatively.`,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          `Hypothesis: ${
            getText(artifact, "Unspecified hypothesis")
          }\n\n${datasetSummary}\n\nResult: ${result.success}. Score: ${result.formattedScore}`,
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
            .map((entry) => `Hypothesis: ${entry.title} Description: ${entry.description} Result: ${entry.outcome}`)
            .join("\n\n"),
      },
    },
  },
  modeling: {
    uiSchema: [
      {
        id: "analysis-context",
        type: "textarea",
        required: true,
        prefillFromDemo: "audience",
        label: "Modeling Context",
        placeholder:
          "Describe the business question, stakeholders, and any deployment constraints that the model must respect.",
      },
    ],
    systemPrompt:
      "Propose high-impact modeling experiments of increasing sophistication for the user's question and dataset",
    userPromptTemplate: contextPrompt,
    responseSchema: schema({
      name: "models",
      title: "Short, business-friendly model intent (4-8 words, no jargon)",
      details: "WHY this experiment, target column, model to run, eval metric, train/test split.",
    }),
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
- Code must define execute(df) exactly as below and return ONLY one Python block:
\`\`\`python
import pandas as pd
import numpy as np
from typing import Dict, Any

def execute(df: pd.DataFrame) -> dict:
    ...
\`\`\`
- If scikit-learn is unavailable, fall back to deterministic baselines using pandas/numpy/scipy.`,
        userTemplate: ({ artifact, datasetSummary }) => {
          const primary = getText(artifact).trim();
          return [primary && `PRIMARY EXPERIMENT DESCRIPTION:\n${primary}`, `Dataset Summary:\n${datasetSummary}`]
            .filter(Boolean)
            .join("\n\n");
        },
      },
      interpretation: {
        system: `Produce a SHORT, decision-ready Markdown summary focusing only on the top findings.
Output format (nothing more):

##### <Headline insight>
- Best: <model> - <one crisp reason referencing metrics qualitatively>
- Watch-out: <one risk or limitation>
- Next: <one concrete follow-up action>

Rules:
- Keep each bullet to a single sentence.
- Use **bold** for the most important phrase in each bullet.
- Mention precision/recall trade-offs only if confusion_matrix is provided.
- No additional sections, tables, or long prose.`,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          [`Dataset Context:\n${datasetSummary}`, `Plan: ${getText(artifact, "Modeling plan")}`, `result: ${result}`]
            .join("\n"),
      },
      synthesis: {
        system:
          `Summarize evaluated modeling plans as deployment recommendations with H5 headings. Each heading should call out when to prioritize the plan. Add bullet points citing which plans support the recommendation and the qualitative meaning of the metrics. Finish with --- and an executive brief.`,
        userTemplate: ({ artifacts }) =>
          artifacts
            .map((entry) => `Model plan: ${entry.title} Objective: ${entry.details} Result: ${entry.outcome}`)
            .join("\n\n"),
      },
    },
  },
  dataQuality: {
    uiSchema: [
      {
        id: "analysis-context",
        type: "textarea",
        required: true,
        prefillFromDemo: "audience",
        label: "Data Quality Context",
        placeholder:
          "E.g., Identify data quality issues affecting reporting accuracy, assess data completeness for customer records, evaluate data consistency across sources...",
      },
    ],
    systemPrompt:
      "Propose high-impact data quality checks tailored to the provided context and dataset characteristics",
    userPromptTemplate: contextPrompt,
    responseSchema: schema({
      name: "data_quality_checks",
      title: "Short, business-friendly check title (4-8 words, no jargon)",
      details: "2-3 sentences: Business impact of issue, how to detect, action to take",
    }),
    evaluationMeta: { scoreLabel: "Issue Score" },
    prompts: {
      evaluation: {
        system:
          `You are an expert data analyst. Evaluate the specified data quality check on the provided Pandas DataFrame (df) as follows:
    Implement the check as described, quantifying the issue (e.g., percentage of missing values, number of duplicates, inconsistency rate).
    Return the results as (success: bool, issue_score: float) where success indicates whether the data passes the quality check (True = pass, False = fail), and issue_score quantifies the severity of the issue (higher means more severe).
Write the code as follows:
\`\`\`python
import pandas as pd
import numpy as np
def execute(df) -> (bool, float):
    ...
\`\`\`
`,
        userTemplate: ({ artifact, datasetSummary }) =>
          `Data Quality Check: ${getText(artifact, "Unspecified data quality check")}\n\n${datasetSummary}`,
      },
      interpretation: {
        system: `You are an expert data analyst.
Given a data quality check and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.
Highlight in **bold** the keywords in the supporting statements.
Do not mention the issue score but _interpret_ it to support the conclusion quantitatively.`,
        userTemplate: ({ artifact, datasetSummary, result }) =>
          `Data Quality Check: ${
            getText(artifact, "Unspecified data quality check")}\n\n${datasetSummary}\n\nResult: ${result.success}. Score: ${result.formattedScore}`,
      },
      synthesis: {
        system: `Given the below data quality checks and results, summarize the key takeaways and actions in Markdown. Begin with the checks with highest issue scores AND highest business impact. Ignore results with errors.
         Use action titles has H5 (#####). Just reading titles should tell the audience EXACTLY what to do. 
         Below each, add supporting bullet points that - PROVE the action title, mentioning which checks led to this conclusion. - Do not mention the issue score but _interpret_ it to support the action - Highlight key phrases in **bold**. Finally, after a break (---) add a 1-paragraph executive summary section (H5) summarizing these actions.`,
        userTemplate: ({ artifacts }) =>  
          artifacts
            .map((entry) => `Data Quality Check: ${entry.title} Description: ${entry.description} Result: ${entry.outcome}`)
            .join("\n\n"),
      },
    },
  },
};
