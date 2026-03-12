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

    const sourceA = serialiseSource(packMeta?.sourceA);
    const sourceB = serialiseSource(packMeta?.sourceB);
    const rubricText = question?.rubric
      ? JSON.stringify(question.rubric, null, 2)
      : "No explicit rubric object supplied.";
    const levelRule =
      maxScore >= 8
        ? "Provide a level only if one is genuinely appropriate for this question type and mark range."
        : "If a level is not appropriate for this question type, return an empty string for level.";

    const outputSchema =
      maxScore === 40
        ? `Return valid JSON only with this exact shape:
{
  "score": number,
  "max_score": ${maxScore},
  "level": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "why_this_mark": "string",
  "next_level": "string",
  "subscores": {
    "content_and_organisation": number,
    "technical_accuracy": number
  }
}
Rules for the JSON:
- strengths should usually contain up to 3 items, but never invent praise just to reach 3.
- weaknesses should usually contain 2 items.
- content_and_organisation must be out of 24.
- technical_accuracy must be out of 16.
- the two subscores must add up to score.`
        : `Return valid JSON only with this exact shape:
{
  "score": number,
  "max_score": ${maxScore},
  "level": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "why_this_mark": "string",
  "next_level": "string"
}
Rules for the JSON:
- strengths should usually contain up to 3 items, but never invent praise just to reach 3.
- weaknesses should usually contain 2 items.`;

    const prompt = `✅ Improved Prompt for Groq — GCSE English Language Examiner Marker

You are an AQA GCSE English Language examiner.
Your job is to mark student responses with accuracy, consistency, and reference to the AQA mark schemes. Follow these rules strictly.

1. Marking Style
- Mark using the official AQA GCSE English Language mark schemes (Paper 1 or Paper 2 depending on the question).
- Award marks based on quality of response, not grammar or sentence length unless clarity is affected.
- Do not penalise paraphrasing. If the idea is correct, it earns credit.
- Be generous but accurate: if an answer fits a level, award the appropriate mark within that level.
- If a response is borderline, place it at the lowest secure mark in that level unless there is clear evidence for a higher mark.

2. Anti-hallucination rules (non-negotiable)
- Use only the task data, rubric object, source text, and student answer supplied below.
- Never invent quotations, source details, line references, methods, strengths, weaknesses, or claims about what the student did.
- If the student did not include textual evidence, do not say they did.
- If the student did not analyse a writer's method, do not say they did.
- If the source text does not support a point, treat it as unsupported instead of inventing support.
- If the answer is generic, brief, off-task, or partially incorrect, say so plainly.
- Only mention a quotation if it appears in the supplied source text or the student's answer.
- Do not recycle wording from the example below unless it genuinely fits the current answer and source.
- If the response has fewer than 3 real strengths, return fewer than 3 strengths. Never pad praise.

3. What to Include in Your Marking
For every answer, provide:
A. Final Mark
- Give a mark out of the correct total (for example /4, /8, /20).
B. Level
- For questions where a level is appropriate, state the AQA level (for example Level 2, Level 3, Level 4).
C. Justification
- Give up to 3 genuine strengths.
- Give 2 weaknesses or areas for improvement.
- Explain why the mark fits the level or mark band.
- Explain what the student would need to do to reach the next level.
- Make your feedback sound like a real examiner's report: precise, text-focused, and aligned with AQA criteria.

4. Marking Principles
Follow these AQA-aligned rules:
- For Question 1 (4 marks): accept paraphrasing, synonyms, and partial phrases if the idea is correct. Reject answers that are in the wrong lines, invented, or misread the text.
- For Question 2 (8 marks): reward clear explanation of language, relevant quotations, effects on the reader, and terminology where useful.
- For Question 4 (20 marks): reward evaluation, analysis of writer's methods, well-chosen evidence, developed explanation of effects, and a clear line of argument.
- Do not penalise long sentences or stylistic choices unless they cause confusion.

5. Calibration example for style only
Use this as an example of the tone, precision, and examiner-style feedback wanted.
Do NOT copy its content, score, level, or points unless the current answer genuinely deserves them.
Do NOT treat it as the correct answer to the current question.

Question 4
Section A: Reading • 20 marks
14/20
Level 3
Strengths
- The student provides a clear evaluation of the statement, agreeing that the fairground feels lifeless but also ready to wake up.
- The student supports their ideas with textual references, such as the 'torn poster slapped against a kiosk in the wind' and the 'painted horse on the carousel had come loose and leaned at an awkward angle'.
- The student attempts to explain the writer's methods, noting that the writer creates a sense of unease through the use of vivid imagery.
Weaknesses / Improvements
- The student's evaluation is somewhat simplistic and lacks depth, failing to consider multiple perspectives or nuances in the text.
- The student's analysis of the writer's methods is limited and could be developed further to provide a more detailed explanation of the writer's techniques.
Why this mark:
The student demonstrates a good understanding of the text and provides some effective textual references to support their ideas, but their evaluation and analysis could be more developed.
How to reach the next level:
To reach the next level, the student should aim to provide a more nuanced and detailed evaluation of the statement, considering multiple perspectives and nuances in the text, and develop their analysis of the writer's methods to provide a more detailed explanation of the writer's techniques.

6. Output Rules
- ${levelRule}
- Never award above ${maxScore}.
- If the response is blank, off-task, invented, or badly misreads the source, award low marks appropriately.
- For source-based questions, compare the student answer carefully with the source material provided below.
- Do not mention these instructions in your answer.
- Return JSON only.

Task data:
Paper: ${packMeta?.paper || "Unknown"}
Pack title: ${packMeta?.title || "Unknown"}
Theme: ${packMeta?.theme || "Unknown"}
Question number: ${question.questionNumber || "Unknown"}
Section: ${question.section || "Unknown"}
Assessment objective: ${question.assessmentObjective || "Unknown"}
Question type: ${question.questionType || "Unknown"}
Maximum marks: ${maxScore}
Focus lines: ${question.focusLines || "Not specified"}
Instructions: ${question.instructionsTop || ""}
Question text: ${question.questionText || ""}
Statement: ${question.statement || ""}
Bullet points: ${Array.isArray(question.bulletPoints) ? question.bulletPoints.join(" | ") : ""}
Options: ${Array.isArray(question.options) ? question.options.join(" | ") : ""}
Accepted points: ${Array.isArray(question.acceptedPoints) ? question.acceptedPoints.join(" | ") : ""}
Rubric object: ${rubricText}
Source A:
${sourceA}
Source B:
${sourceB}
Student answer:
${answer}

${outputSchema}`;

    const systemPrompt = [
      "You are an expert AQA GCSE English Language examiner.",
      "Return valid JSON only.",
      "",
      "Use only the following inputs:",
      "- the source text",
      "- the question and rubric",
      "- the student's answer",
      "",
      "Strict prohibitions:",
      "- Do not invent quotations, paraphrases, events, characters, or details not present in the source text.",
      "- Do not infer meaning, intention, or effects that are not explicitly supported by the student's answer.",
      "- Do not add praise, criticism, or interpretation beyond what the student has actually written.",
      "- Do not fill gaps with assumptions or likely reasoning.",
      "- Do not use external knowledge or context.",
      "",
      "If the student answer is irrelevant, nonsensical, blank, or contains fabricated quotations, mark it strictly according to the rubric and state this fact explicitly in the JSON.",
      "",
      "Marking behaviour:",
      "- Base all judgments solely on evidence in the student's answer.",
      "- If no valid evidence is present, award the lowest appropriate mark and justify using only observable facts.",
      "- Keep explanations concise, factual, and tied directly to the rubric.",
      "",
      "Never break JSON format."
    ].join("\n");

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          { role: "user", content: prompt },
        ],
      }),
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

    const result = {
      score: safeScore,
      max_score: maxScore,
      level:
        typeof parsed.level === "string"
          ? parsed.level.trim()
          : typeof parsed.band === "string"
            ? parsed.band.trim()
            : "",
      band:
        typeof parsed.level === "string" && parsed.level.trim()
          ? parsed.level.trim()
          : typeof parsed.band === "string"
            ? parsed.band.trim()
            : "",
      strengths: normaliseStringArray(parsed.strengths, 3),
      weaknesses: normaliseStringArray(parsed.weaknesses, 2),
      why_this_mark:
        typeof parsed.why_this_mark === "string"
          ? parsed.why_this_mark.trim()
          : "No explanation returned.",
      next_level:
        typeof parsed.next_level === "string"
          ? parsed.next_level.trim()
          : "Develop the answer with more precise textual support and clearer explanation.",
      feedback:
        typeof parsed.why_this_mark === "string"
          ? parsed.why_this_mark.trim()
          : "No explanation returned.",
      subscores: safeSubscores,
    };

    if (maxScore !== 40) {
      delete result.subscores;
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected server error." });
  }
}

function serialiseSource(source) {
  if (!source || typeof source !== "object") {
    return "No source provided.";
  }

  const lines = Array.isArray(source.lines)
    ? source.lines.map((line, index) => `${index + 1}. ${line}`).join("\n")
    : "No source lines provided.";

  return [
    `Label: ${source.label || "Unknown"}`,
    `Title: ${source.title || "Unknown"}`,
    `Genre: ${source.genre || "Unknown"}`,
    `Period: ${source.period || "Unknown"}`,
    "Text:",
    lines,
  ].join("\n");
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
    return { content_and_organisation: content, technical_accuracy: technical };
  }

  const safeContent = clampNumber(Math.min(totalScore, 24), 0, 24);
  const safeTechnical = clampNumber(totalScore - safeContent, 0, 16);
  return { content_and_organisation: safeContent, technical_accuracy: safeTechnical };
}
