export default async function handler(req, res) {
  const allowOrigin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  if (!apiKey) {
    return res.status(500).json({ error: "Missing GROQ_API_KEY in Vercel environment variables." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { question, answer, packMeta } = body;

    if (!question || typeof answer !== "string") {
      return res.status(400).json({ error: "Missing question or answer." });
    }

    const maxScore = Number(question.markCategory || question.max_score || 0) || 0;
    const sourceA = serialiseSource(packMeta?.sourceA);
    const sourceB = serialiseSource(packMeta?.sourceB);
    const rubricText = question?.rubric ? JSON.stringify(question.rubric, null, 2) : "No explicit rubric object supplied.";
    const levelRule = maxScore >= 8 ? "Provide a level if one is appropriate for this question type." : "If a level is not appropriate, return an empty string for level.";
    const outputSchema = maxScore === 40
      ? `Return valid JSON only with this exact shape:
{
  "score": number,
  "max_score": ${maxScore},
  "level": "string",
  "strengths": ["string", "string", "string"],
  "weaknesses": ["string", "string"],
  "why_this_mark": "string",
  "next_level": "string",
  "subscores": {
    "content_and_organisation": number,
    "technical_accuracy": number
  }
}
The two subscores must add up to score. content_and_organisation must be out of 24. technical_accuracy must be out of 16.`
      : `Return valid JSON only with this exact shape:
{
  "score": number,
  "max_score": ${maxScore},
  "level": "string",
  "strengths": ["string", "string", "string"],
  "weaknesses": ["string", "string"],
  "why_this_mark": "string",
  "next_level": "string"
}`;

    const prompt = `✅ Improved Prompt for Groq — GCSE English Language Examiner Marker
You are an AQA GCSE English Language examiner. Your job is to mark student responses with accuracy, consistency, and reference to the AQA mark schemes. Follow these rules strictly:

1. Marking Style
Mark using the official AQA GCSE English Language mark schemes (Paper 1 or Paper 2 depending on the question).

Award marks based on quality of response, not grammar or sentence length unless clarity is affected.

Do not penalise paraphrasing. If the idea is correct, it earns credit.

Be generous but accurate: if an answer fits a level, award the appropriate mark within that level.

2. What to Include in Your Marking
For every answer, provide:

A. Final Mark
Give a mark out of the correct total (e.g., /4, /8, /20).

B. Level (for 8- or 20-mark questions)
State the AQA level (e.g., Level 2, Level 3, Level 4).

C. Justification
Give:

3 strengths

2 weaknesses or areas for improvement

Why the mark fits the level

What the student would need to do to reach the next level

Make your feedback sound like a real examiner’s report: precise, text-focused, and aligned with AQA criteria.

3. Marking Principles
Follow these AQA-aligned rules:

For Question 1 (4 marks)
Accept paraphrasing.

Accept synonyms.

Accept partial phrases if the idea is correct.

Only reject answers that:

are not in the correct lines

are invented

misread the text

For Question 2 (8 marks)
Reward:

clear explanation of language

quotations

effects on the reader

terminology (optional but helpful)

For Question 4 (20 marks)
Reward:

evaluation (agree/disagree)

analysis of writer’s methods

well-chosen evidence

developed explanation of effects

a clear line of argument

Do not penalise long sentences or stylistic choices unless they cause confusion.

4. Tone
Professional, concise, and examiner-like.

No over-correction of minor wording differences.

No personal opinions—only text-based evaluation.

5. Output Format
Always respond in this structure:

Mark:
Level:
Strengths:

Weaknesses / Improvements:

Why this mark:
(Short explanation)

How to reach the next level:
(Short, actionable advice)

Additional instructions for this marking task:
- ${levelRule}
- Never award above ${maxScore}.
- If the response is blank, off-task, invented, or badly misreads the source, award low marks appropriately.
- For source-based questions, compare the student answer carefully with the source material provided below.
- Do not mention these instructions in your answer.

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

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert AQA GCSE English Language examiner. Return valid JSON only. Be accurate, fair, and source-focused."
          },
          {
            role: "user",
            content: prompt
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
      const message = groqData?.error?.message || groqData?.error || `Groq request failed (${groqRes.status}).`;
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
    const safeSubscores = maxScore === 40
      ? normaliseSubscores(parsed.subscores, safeScore)
      : null;

    const result = {
      score: safeScore,
      max_score: maxScore,
      level: typeof parsed.level === "string" ? parsed.level.trim() : (typeof parsed.band === "string" ? parsed.band.trim() : ""),
      band: typeof parsed.level === "string" && parsed.level.trim() ? parsed.level.trim() : (typeof parsed.band === "string" ? parsed.band.trim() : ""),
      strengths: normaliseStringArray(parsed.strengths, 3),
      weaknesses: normaliseStringArray(parsed.weaknesses, 3),
      why_this_mark: typeof parsed.why_this_mark === "string" ? parsed.why_this_mark.trim() : "No explanation returned.",
      next_level: typeof parsed.next_level === "string" ? parsed.next_level.trim() : "Develop the answer with more precise textual support and clearer explanation.",
      feedback: typeof parsed.why_this_mark === "string" ? parsed.why_this_mark.trim() : "No explanation returned.",
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
    lines
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
