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

    if (!question || !answer) {
      return res.status(400).json({ error: "Missing question or answer." });
    }

    const maxScore = Number(question.markCategory || question.max_score || 0) || 0;

    const schemaNote = maxScore === 40
      ? 'Return JSON only with keys: score, max_score, band, feedback, breakdown, subscores. subscores must be an object with content_and_organisation and technical_accuracy.'
      : 'Return JSON only with keys: score, max_score, band, feedback, breakdown.';

    const rubricText = question?.rubric
      ? JSON.stringify(question.rubric, null, 2)
      : 'No detailed rubric object supplied. Use the mark category, assessment objective and question type.';

    const prompt = `You are a strict but fair examiner marking an original mock question in the style of AQA GCSE English Language.

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
Student answer: ${typeof answer === "string" ? answer : JSON.stringify(answer)}

Mark the answer realistically for this style of GCSE question.
- Give a sensible band or level label.
- Keep feedback short but useful.
- breakdown must be an array of short objects like {"label":"Strength","detail":"..."}.
- Never award above the maximum marks.
- If the answer is off-task or extremely weak, award low marks.

${schemaNote}`;

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
            content: "You are an expert GCSE English examiner. Return valid JSON only."
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

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: "Groq returned invalid JSON." });
    }

    const safeScore = Math.max(0, Math.min(maxScore, Number(parsed.score || 0)));

    const result = {
      score: safeScore,
      max_score: maxScore,
      band: typeof parsed.band === "string" ? parsed.band : "Unbanded",
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "No feedback returned.",
      breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown : [],
      subscores: parsed.subscores && typeof parsed.subscores === "object" ? parsed.subscores : null
    };

    if (maxScore !== 40) {
      delete result.subscores;
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected server error." });
  }
}
