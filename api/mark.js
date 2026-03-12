const SENIOR_EXAMINER_PROMPT = String.raw`You are a senior AQA GCSE English Language (8700) examiner marking exactly as an expert human examiner would.

Your job:
1. Award the most accurate mark possible for the single response you are given.
2. Give examiner-standard feedback that tells the student exactly what earned marks, what is blocking higher marks, and what to change next time.

Non-negotiable rules:
- Use only the supplied question data, source text, rubric/accepted points, and student answer.
- Never invent quotations, line references, methods, events, attitudes, strengths, weaknesses, or writer intentions.
- Only mention evidence that appears in the supplied source text or the student's answer.
- If the response is blank, irrelevant, fabricated, badly misreads the text, or is too thin to support a claim, say so plainly and mark accordingly.
- Mark quality of response, not length.
- Ignore spelling and grammar unless AO6 is being assessed or meaning is unclear.
- Accept paraphrase where AO1 allows it.
- Decide the assessment objective first, then level first, mark second using best fit.
- For questions where levels apply, decide the best-fit level for the whole response, then place the mark at the bottom, middle, or top of that level.
- For Q5 writing, keep AO5 and AO6 separate.

Question guide:
- Paper 1 Q1 / Paper 2 Q1 (AO1, 4 marks): retrieval only. One mark per distinct correct point from the specified lines/section. Accept quotation or paraphrase. No inference. No double credit for the same idea.
- Paper 1 Q2 (AO2, 8 marks): language analysis. Reward precise references, clear explanation of how language creates the effect in the question, and useful terminology. L1 = spotting/repeating; L2 = some comment on effect; L3 = clear explanation with relevant range; L4 = detailed, perceptive analysis.
- Paper 1 Q3 (AO2, 8 marks): structure analysis. Reward whole-text structural choices such as shifts in focus, time, place, perspective, pace, order, repetition, contrast, and opening-middle-ending shape. A response focused on one isolated moment cannot be top level.
- Paper 1 Q4 (AO4, 20 marks): evaluation. Reward a clear judgement, evaluation of how methods support or challenge the statement, precise evidence, whole-text understanding, and writer intention/effect. Do not confuse analysis with evaluation. Empty phrases like "this is effective" without reasoning stay mid-band.
- Paper 1 Q5 / Paper 2 Q5 (AO5 24, AO6 16): for AO5 reward purpose, organisation, progression, register, audience awareness, and control; for AO6 reward sentence control, punctuation, spelling, and Standard English. Fancy vocabulary or a strong opening alone does not make a top-band response.
- Paper 2 Q2 (AO1, 8 marks): summary/inference across both texts. Reward accurate comparative inferences with evidence from both texts. Do not reward language analysis here.
- Paper 2 Q3 (AO2, 12 marks): language analysis on non-fiction. Reward explanation of tone, rhetoric, semantic fields, imagery, and how language presents viewpoint/experience.
- Paper 2 Q4 (AO3, 16 marks): compare viewpoints and methods. Reward clear similarities/differences in ideas, perspectives, and how they are presented. Responses that summarise but do not compare methods are limited.

Feedback rules:
- Start with the exact mark and, where relevant, the level plus position in level (bottom, mid, top).
- Give up to 3 real strengths only. If there are fewer than 3 genuine strengths, give fewer.
- Give 2 or 3 specific weaknesses that explain the gap to the next level.
- Explain why the mark fits the level/band using mark-scheme language.
- Give exactly 3 actionable next-step improvements where possible.
- Give a 2-3 sentence model answer fragment that shows the next level up and fits the same question/task.
- Give a clear target mark or mark range for the next paper.
- Never use vague feedback such as "good effort", "try harder", "write more", or "use better vocabulary".
- Keep feedback precise, concrete, and copyable.`;

/**
 * Vercel serverless function for Groq-backed GCSE English marking.
 * Frontend expects JSON with:
 * score, max_score, level, band, strengths, weaknesses, why_this_mark,
 * next_level, feedback, improvement_plan, model_answer_fragment,
 * target_for_next_paper, and subscores for 40-mark writing tasks.
 */
export default async function handler(req, res) {
  const allowOrigin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "Missing GROQ_API_KEY in Vercel environment variables." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }

  try {
    const { question, answer, packMeta } = body;

    if (!question || typeof answer !== "string") {
      return res.status(400).json({ error: "Missing question or answer." });
    }

    const maxScore = Number(question.markCategory || question.max_score || 0) || 0;
    if (!maxScore) {
      return res.status(400).json({ error: "Question is missing a valid mark value." });
    }

    const taskMessage = buildTaskMessage({
      question,
      answer,
      packMeta,
      maxScore
    });

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: SENIOR_EXAMINER_PROMPT
          },
          {
            role: "user",
            content: taskMessage
          }
        ]
      })
    });

    let groqData;
    try {
      groqData = await groqRes.json();
    } catch {
      groqData = null;
    }

    if (!groqRes.ok) {
      const message =
        groqData?.error?.message ||
        groqData?.error ||
        `Groq request failed (${groqRes.status}).`;
      return res.status(groqRes.status).json({ error: message });
    }

    const content = groqData?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ error: "Groq returned no message content." });
    }

    const parsed = parseModelJson(content);
    if (!parsed) {
      return res.status(502).json({ error: "Groq returned invalid JSON." });
    }

    const safeScore = clampNumber(parsed.score, 0, maxScore);
    const safeSubscores = maxScore === 40 ? normaliseSubscores(parsed.subscores, safeScore) : null;

    const baseLevel = firstText(parsed.level, parsed.band, parsed.mark_band);
    const levelPosition = firstText(parsed.position_in_level, parsed.level_position, parsed.position);
    const displayLevel = formatDisplayLevel(baseLevel, levelPosition);

    const strengths = normaliseStringArray(parsed.strengths, 3);
    const weaknesses = normaliseStringArray(parsed.weaknesses || parsed.improvements, 3);
    const improvementPlan = normaliseStringArray(parsed.improvement_plan || parsed.improvementPlan, 3);
    const modelAnswerFragment = firstText(
      parsed.model_answer_fragment,
      parsed.modelAnswerFragment,
      parsed.model_fragment
    );
    const targetForNextPaper = firstText(
      parsed.target_for_next_paper,
      parsed.targetForNextPaper,
      parsed.target
    );

    const whyThisMark = firstText(
      parsed.why_this_mark,
      parsed.whyThisMark,
      parsed.feedback,
      parsed.justification,
      "No explanation returned."
    );

    const nextLevel = buildNextLevelText(
      firstText(
        parsed.next_level,
        parsed.nextLevel,
        parsed.how_to_reach_next_level,
        "Use the feedback above to strengthen your next response with more secure evidence, tighter explanation, and closer alignment to the mark scheme."
      ),
      improvementPlan,
      modelAnswerFragment,
      targetForNextPaper
    );

    const result = {
      score: safeScore,
      max_score: maxScore,
      level: displayLevel,
      band: displayLevel,
      strengths,
      weaknesses,
      why_this_mark: whyThisMark,
      next_level: nextLevel,
      feedback: whyThisMark,
      improvement_plan: improvementPlan,
      model_answer_fragment: modelAnswerFragment,
      target_for_next_paper: targetForNextPaper,
      subscores: safeSubscores
    };

    if (maxScore !== 40) {
      delete result.subscores;
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected server error." });
  }
}

function buildTaskMessage({ question, answer, packMeta, maxScore }) {
  const rubricText = question?.rubric ? JSON.stringify(question.rubric) : "";
  const sourceAText = serialiseSourceCompact(packMeta?.sourceA);
  const sourceBText = serialiseSourceCompact(packMeta?.sourceB);
  const levelRule =
    maxScore >= 8
      ? "If levels genuinely apply, return both level and position_in_level. position_in_level must be bottom, mid, or top."
      : "If levels do not genuinely apply, return empty strings for level and position_in_level.";

  const outputSchema =
    maxScore === 40
      ? `Return valid JSON only in this shape:
{
  "score": number,
  "max_score": ${maxScore},
  "level": "string",
  "position_in_level": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "why_this_mark": "string",
  "next_level": "string",
  "improvement_plan": ["string"],
  "model_answer_fragment": "string",
  "target_for_next_paper": "string",
  "subscores": {
    "content_and_organisation": number,
    "technical_accuracy": number
  }
}
Rules:
- strengths: up to 3 genuine strengths only.
- weaknesses: 2 or 3 genuine weaknesses only.
- why_this_mark: must begin with the exact mark and, where relevant, level + position.
- next_level: concise and actionable.
- improvement_plan: 3 actions when possible.
- model_answer_fragment: 2 or 3 sentences only.
- target_for_next_paper: specific mark target or range.
- content_and_organisation is out of 24.
- technical_accuracy is out of 16.
- the two subscores must add up to score.`
      : `Return valid JSON only in this shape:
{
  "score": number,
  "max_score": ${maxScore},
  "level": "string",
  "position_in_level": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "why_this_mark": "string",
  "next_level": "string",
  "improvement_plan": ["string"],
  "model_answer_fragment": "string",
  "target_for_next_paper": "string"
}
Rules:
- strengths: up to 3 genuine strengths only.
- weaknesses: 2 or 3 genuine weaknesses only.
- why_this_mark: must begin with the exact mark and, where relevant, level + position.
- next_level: concise and actionable.
- improvement_plan: 3 actions when possible.
- model_answer_fragment: 2 or 3 sentences only.
- target_for_next_paper: specific mark target or range.`;

  const lines = [
    "Mark this single response using the system prompt.",
    "Return JSON only.",
    `Never award above ${maxScore}.`,
    levelRule,
    "",
    "Question data:",
    compactLine("Paper", packMeta?.paper),
    compactLine("Question number", question.questionNumber),
    compactLine("AO", question.assessmentObjective),
    compactLine("Question type", question.questionType),
    compactLine("Max marks", maxScore),
    compactLine("Focus lines", question.focusLines),
    compactLine("Instructions", question.instructionsTop),
    compactLine("Question", question.questionText),
    compactLine("Statement", question.statement),
    compactLine("Bullet points", joinArray(question.bulletPoints)),
    compactLine("Options", joinArray(question.options)),
    compactLine("Accepted points", joinArray(question.acceptedPoints)),
    compactLine("Rubric", rubricText),
    "",
    "Source A:",
    sourceAText,
    "",
    "Source B:",
    sourceBText,
    "",
    "Student answer:",
    answer,
    "",
    outputSchema
  ].filter(Boolean);

  return lines.join("\n");
}

function compactLine(label, value) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return `${label}: ${text}`;
}

function joinArray(value) {
  if (!Array.isArray(value) || !value.length) return "";
  return value.map((item) => String(item || "").trim()).filter(Boolean).join(" | ");
}

function serialiseSourceCompact(source) {
  if (!source || typeof source !== "object") {
    return "No source provided.";
  }

  const header = [
    source.label ? `Label: ${source.label}` : "",
    source.title ? `Title: ${source.title}` : ""
  ]
    .filter(Boolean)
    .join(" | ");

  const lines = Array.isArray(source.lines)
    ? source.lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
    : "No source lines provided.";

  return [header, lines].filter(Boolean).join("\n");
}

function buildNextLevelText(baseText, planItems, modelAnswerFragment, targetForNextPaper) {
  const parts = [];

  if (baseText) {
    parts.push(baseText.trim());
  }

  if (planItems.length) {
    parts.push(`Do these 3 things next: ${planItems.map((item, index) => `${index + 1}. ${item}`).join(" ")}`);
  }

  if (modelAnswerFragment) {
    parts.push(`Model fragment: ${modelAnswerFragment.trim()}`);
  }

  if (targetForNextPaper) {
    parts.push(`Target: ${targetForNextPaper.trim()}`);
  }

  return parts.join(" ").trim();
}

function formatDisplayLevel(level, position) {
  const safeLevel = typeof level === "string" ? level.trim() : "";
  const safePosition = typeof position === "string" ? position.trim() : "";

  if (!safeLevel) return "";
  if (!safePosition) return safeLevel;
  return `${safeLevel} (${safePosition})`;
}

function parseModelJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normaliseStringArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function normaliseSubscores(subscores, totalScore) {
  const content = clampNumber(subscores?.content_and_organisation, 0, 24);
  const technical = clampNumber(subscores?.technical_accuracy, 0, 16);
  const sum = content + technical;

  if (sum === totalScore) {
    return {
      content_and_organisation: content,
      technical_accuracy: technical
    };
  }

  const safeContent = clampNumber(Math.min(totalScore, 24), 0, 24);
  const safeTechnical = clampNumber(totalScore - safeContent, 0, 16);

  return {
    content_and_organisation: safeContent,
    technical_accuracy: safeTechnical
  };
}
