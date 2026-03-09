export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST is allowed." });
  }

  try {
    const body = parseBody(req.body);
    const question = body?.question;
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    const packMeta = body?.packMeta && typeof body.packMeta === "object" ? body.packMeta : null;

    if (!question || !question.questionNumber || !question.markCategory) {
      return res.status(400).json({ error: "A valid question object is required." });
    }

    if (!answer) {
      return res.status(200).json(buildBlankResponse(question));
    }

    if (question.questionType === "select-true-statements") {
      return res.status(200).json(markTrueStatements(question, answer));
    }

    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

    if (!apiKey) {
      return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
    }

    const promptPayload = buildPromptPayload(question, answer, packMeta);
    const result = await requestGroqWithRetry({ apiKey, model, promptPayload, question });

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unexpected server error."
    });
  }
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function setCors(res) {
  const allowOrigin = process.env.ALLOW_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function buildBlankResponse(question) {
  return {
    score: 0,
    max_score: Number(question.markCategory || 0),
    band: "0",
    feedback: "No answer was provided for this question.",
    breakdown: [{ label: "Status", detail: "Blank response" }],
    subscores: Number(question.markCategory) === 40 ? { content_and_organisation: 0, technical_accuracy: 0 } : null
  };
}

function markTrueStatements(question, answer) {
  const correct = Array.isArray(question.correctOptions)
    ? question.correctOptions.map((item) => String(item).toUpperCase())
    : [];

  const selected = Array.from(
    new Set((String(answer).match(/[A-H]/gi) || []).map((item) => item.toUpperCase()))
  );

  const score = selected.filter((item) => correct.includes(item)).length;
  const wrong = selected.filter((item) => !correct.includes(item));
  const missed = correct.filter((item) => !selected.includes(item));

  const breakdown = [
    {
      label: "Selected",
      detail: selected.length ? selected.join(", ") : "No option letters detected."
    },
    {
      label: "Correct answers",
      detail: correct.join(", ")
    }
  ];

  if (wrong.length) {
    breakdown.push({
      label: "Not credited",
      detail: wrong.join(", ")
    });
  }

  if (missed.length) {
    breakdown.push({
      label: "Missed",
      detail: missed.join(", ")
    });
  }

  return {
    score,
    max_score: 4,
    band: score === 4 ? "Full marks" : score >= 2 ? "Partial" : score >= 1 ? "Limited" : "0",
    feedback:
      score === 4
        ? "All four correct statements were selected."
        : `You selected ${score} correct statement${score === 1 ? "" : "s"}. Check the source carefully and choose only the statements supported by the text.`,
    breakdown,
    subscores: null
  };
}

async function requestGroqWithRetry({ apiKey, model, promptPayload, question }) {
  const firstAttempt = await requestGroq({ apiKey, model, promptPayload, repairMode: false, question });

  if (firstAttempt.ok) {
    return firstAttempt.result;
  }

  if (firstAttempt.retryable) {
    const secondAttempt = await requestGroq({ apiKey, model, promptPayload, repairMode: true, question });
    if (secondAttempt.ok) {
      return secondAttempt.result;
    }
    throw new Error(secondAttempt.error || firstAttempt.error || "Groq returned malformed output.");
  }

  throw new Error(firstAttempt.error || "Groq request failed.");
}

async function requestGroq({ apiKey, model, promptPayload, repairMode, question }) {
  const messages = [
    {
      role: "system",
      content:
        "You are a strict but fair GCSE English examiner marking original AQA-style mock questions. Return valid JSON only with no markdown fences and no commentary outside the JSON object."
    },
    {
      role: "user",
      content: JSON.stringify(promptPayload)
    }
  ];

  if (repairMode) {
    messages.push({
      role: "user",
      content:
        "Your previous reply was unusable. Return a single valid JSON object only. Do not include markdown, notes or extra text."
    });
  }

  const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });

  const groqData = await groqRes.json().catch(() => null);

  if (!groqRes.ok) {
    return {
      ok: false,
      retryable: false,
      error: groqData?.error?.message || `Groq request failed (${groqRes.status}).`
    };
  }

  const content = groqData?.choices?.[0]?.message?.content;
  if (!content) {
    return {
      ok: false,
      retryable: true,
      error: "Groq returned no content."
    };
  }

  const parsed = safeJsonParse(content);
  if (!parsed) {
    return {
      ok: false,
      retryable: true,
      error: "Groq returned malformed JSON."
    };
  }

  return {
    ok: true,
    retryable: false,
    result: normalizeResult(parsed, question)
  };
}

function buildPromptPayload(question, answer, packMeta) {
  const isWriting = Number(question.markCategory) === 40;

  return {
    task: "Mark the student's answer for this original AQA-style GCSE English Language mock question.",
    context: packMeta,
    marking_rules: [
      "Be strict but fair.",
      "Use the supplied rubric and assessment objective.",
      "Base the mark on what is actually written, not on what the student may have meant.",
      "Keep the feedback concise, clear and useful for a student sending it to a teacher.",
      isWriting
        ? "For 40-mark writing tasks, give subscores for content_and_organisation out of 24 and technical_accuracy out of 16."
        : "For non-writing tasks, set content_and_organisation and technical_accuracy to null."
    ],
    output_schema: {
      score: "number",
      max_score: Number(question.markCategory),
      band: "string",
      feedback: "short paragraph",
      breakdown: [
        {
          label: "short label",
          detail: "brief explanation"
        }
      ],
      subscores: {
        content_and_organisation: isWriting ? "number" : null,
        technical_accuracy: isWriting ? "number" : null
      }
    },
    question,
    student_answer: answer
  };
}

function normalizeResult(parsed, question) {
  const maxScore = Number(question.markCategory || 0);
  const score = clampNumber(parsed.score, 0, maxScore);
  const writing = maxScore === 40;

  let subscores = null;
  if (writing) {
    const content = clampNumber(parsed?.subscores?.content_and_organisation, 0, 24);
    const technical = clampNumber(parsed?.subscores?.technical_accuracy, 0, 16);
    subscores = {
      content_and_organisation: content,
      technical_accuracy: technical
    };
  }

  return {
    score,
    max_score: maxScore,
    band: typeof parsed.band === "string" ? parsed.band : defaultBand(score, maxScore),
    feedback: typeof parsed.feedback === "string" ? parsed.feedback : "No feedback returned.",
    breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown : [],
    subscores
  };
}

function defaultBand(score, maxScore) {
  if (maxScore === 40) {
    if (score >= 33) return "High";
    if (score >= 25) return "Secure";
    if (score >= 17) return "Developing";
    if (score >= 9) return "Limited";
    return "0–8";
  }
  if (maxScore === 20) {
    if (score >= 16) return "Level 4";
    if (score >= 11) return "Level 3";
    if (score >= 6) return "Level 2";
    if (score >= 1) return "Level 1";
    return "0";
  }
  if (maxScore === 16) {
    if (score >= 13) return "High";
    if (score >= 9) return "Secure";
    if (score >= 5) return "Developing";
    if (score >= 1) return "Limited";
    return "0";
  }
  if (maxScore === 12) {
    if (score >= 10) return "High";
    if (score >= 7) return "Secure";
    if (score >= 4) return "Developing";
    if (score >= 1) return "Limited";
    return "0";
  }
  if (maxScore === 8) {
    if (score >= 7) return "High";
    if (score >= 5) return "Secure";
    if (score >= 3) return "Developing";
    if (score >= 1) return "Limited";
    return "0";
  }
  if (maxScore === 4) {
    if (score === 4) return "Full marks";
    if (score >= 2) return "Partial";
    if (score >= 1) return "Limited";
    return "0";
  }
  return "Unbanded";
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}