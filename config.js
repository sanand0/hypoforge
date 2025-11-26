// Centralized configuration for prompts and schemas
// Toggle analysisType to switch between presets
export const analysisType = "hypotheses"; // or 'modeling'

// Schemas for different analysis types
const schemas = {
  hypotheses: {
    name: "hypotheses",
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
  // Placeholder modeling schema (not used yet). Adjust as needed when enabling modeling.
  modeling: {
    name: "models",
    schema: {
      type: "object",
      properties: {
        models: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objective: { type: "string" },
              target: { type: "string" },
              features: { type: "array", items: { type: "string" } },
            },
            required: ["objective", "target"],
            additionalProperties: true,
          },
        },
      },
      required: ["models"],
      additionalProperties: false,
    },
  },
};

// Prompts for different analysis types
const promptsByType = {
  hypotheses: {
    // Code generation (analysis) prompt shown in the Settings textarea by default
    code: `You are an expert data analyst. Test the given hypothesis on the provided Pandas DataFrame (df) as follows:

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
    // Result interpretation prompt
    interpret: `You are an expert data analyst.
Given a hypothesis and its outcome, provide a plain English summary of the findings as a crisp H5 heading (#####), followed by 1-2 concise supporting sentences.
Highlight in **bold** the keywords in the supporting statements.
Do not mention the p-value but _interpret_ it to support the conclusion quantitatively.`,
    // Synthesis prompt for combining outcomes
    synthesize: `Given the below hypotheses and results, summarize the key takeaways and actions in Markdown.
Begin with the hypotheses with lowest p-values AND highest business impact. Ignore results with errors.
Use action titles has H5 (#####). Just reading titles should tell the audience EXACTLY what to do.
Below each, add supporting bullet points that
  - PROVE the action title, mentioning which hypotheses led to this conclusion.
  - Do not mention the p-value but _interpret_ it to support the action
  - Highlight key phrases in **bold**.
Finally, after a break (---) add a 1-paragraph executive summary section (H5) summarizing these actions.
`,
  },
  // Early modeling presets (not used yet)
  modeling: {
    code:
      `You are an expert data scientist. Propose a minimal, explainable model plan on the provided Pandas DataFrame (df). Prefer simple, robust baselines. Output only Python code stub defining build_model(df) and return (model_name: str, metric: float).`,
    interpret:
      `You are an expert data scientist. Summarize the model outcome with a crisp H5 heading and 1-2 supporting sentences highlighting trade-offs and key drivers in **bold**. Avoid raw metric values; interpret them instead.`,
    synthesize:
      `Summarize model proposals and outcomes as actionable recommendations (H5 titles), with bullet points citing which proposals support each action.`,
  },
};

export function getConfig() {
  const type = analysisType;
  return {
    analysisType: type,
    schema: {
      name: schemas[type].name,
      schema: schemas[type].schema,
    },
    prompts: promptsByType[type],
  };
}

const config = getConfig();
export default config;
