const BANK_CANDIDATE_URLS = [
  "./data/question-bank.json",
  "data/question-bank.json",
  "/data/question-bank.json"
];

const MARKER_ENDPOINT = "https://english-test-five.vercel.app/api/mark";
const ANSWER_STORAGE_PREFIX = "aqaPaperAnswers:";
const PAPER_MODE_STORAGE_KEY = "aqaPaperModeParts";

const PAPER_MODES = [
  {
    id: "Paper 1 - Part 1",
    basePaper: "Paper 1",
    part: "Part 1",
    time: "45 minutes",
    questionNumbers: ["Question 1", "Question 2", "Question 4"]
  },
  {
    id: "Paper 1 - Part 2",
    basePaper: "Paper 1",
    part: "Part 2",
    time: "1 hour",
    questionNumbers: ["Question 3", "Question 5"]
  },
  {
    id: "Paper 2 - Part 1",
    basePaper: "Paper 2",
    part: "Part 1",
    time: "45 minutes",
    questionNumbers: ["Question 1", "Question 2", "Question 4"],
    questionOverrides: {
      "Question 4": {
        markCategory: 20,
        rubricMaxScore: 20,
        rubricNotes: "Adapted for this part-based quiz. Reward a clear, comparative response with supported judgements and explanation of how methods present viewpoints. Mark out of 20 for this site layout."
      }
    }
  },
  {
    id: "Paper 2 - Part 2",
    basePaper: "Paper 2",
    part: "Part 2",
    time: "1 hour",
    questionNumbers: ["Question 3", "Question 5"],
    questionOverrides: {
      "Question 3": {
        markCategory: 8,
        rubricMaxScore: 8,
        rubricNotes: "Adapted for this part-based quiz. Reward concise, relevant language analysis linked to viewpoint and effect. Mark out of 8 for this site layout."
      }
    }
  }
];

const savedMode = localStorage.getItem(PAPER_MODE_STORAGE_KEY);
const defaultMode = PAPER_MODES.some((mode) => mode.id === savedMode) ? savedMode : PAPER_MODES[0].id;

const state = {
  bank: null,
  currentPack: null,
  paperMode: defaultMode,
  markerEndpoint: MARKER_ENDPOINT,
  answers: {},
  lastCopyText: "",
  lastResults: []
};

const dom = {
  paperMode: document.getElementById("paper-mode"),
  generatePaperBtn: document.getElementById("generate-paper-btn"),
  currentPaperMeta: document.getElementById("current-paper-meta"),
  paperView: document.getElementById("paper-view"),
  markPaperBtn: document.getElementById("mark-paper-btn"),
  clearAnswersBtn: document.getElementById("clear-answers-btn"),
  resultWindow: document.getElementById("result-window"),
  copyFeedbackBtn: document.getElementById("copy-feedback-btn")
};

init();

async function init() {
  populatePaperModeOptions();
  bindStaticEvents();
  if (dom.paperMode) {
    dom.paperMode.value = state.paperMode;
  }
  await loadBank();
}

function populatePaperModeOptions() {
  if (!dom.paperMode) return;
  dom.paperMode.innerHTML = PAPER_MODES.map((mode) => `<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.id)}</option>`).join("");
}

function bindStaticEvents() {
  dom.paperMode.addEventListener("change", () => {
    state.paperMode = dom.paperMode.value;
    localStorage.setItem(PAPER_MODE_STORAGE_KEY, state.paperMode);
  });

  dom.generatePaperBtn.addEventListener("click", () => {
    if (!state.bank) return;
    generatePaper(state.paperMode);
  });

  dom.clearAnswersBtn.addEventListener("click", clearCurrentAnswers);
  dom.markPaperBtn.addEventListener("click", markCurrentPaper);

  dom.copyFeedbackBtn.addEventListener("click", async () => {
    if (!state.lastCopyText) return;
    try {
      await navigator.clipboard.writeText(state.lastCopyText);
      showNotice("Feedback copied to clipboard.");
    } catch {
      showNotice("Clipboard copy failed. You may need to allow clipboard access.", true);
    }
  });

  dom.paperView.addEventListener("input", handleAnswerInput);
  dom.paperView.addEventListener("change", handleAnswerInput);
}

async function loadBank() {
  const fetched = await fetchBankWithFallback();

  if (!fetched) {
    dom.paperView.innerHTML = `<div class="notice error">The paper bank could not be loaded.</div>`;
    return;
  }

  state.bank = fetched;
  generatePaper(state.paperMode);
}

async function fetchBankWithFallback() {
  for (const url of BANK_CANDIDATE_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      if (isValidBank(data)) {
        return data;
      }
    } catch {
      // Try the next candidate URL.
    }
  }

  try {
    const embedded = document.getElementById("embedded-question-bank");
    if (!embedded) return null;
    const data = JSON.parse(embedded.textContent);
    return isValidBank(data) ? data : null;
  } catch {
    return null;
  }
}

function isValidBank(data) {
  return !!(data && Array.isArray(data.packs) && data.packs.length);
}

function getModeConfig(modeId) {
  return PAPER_MODES.find((mode) => mode.id === modeId) || PAPER_MODES[0];
}

function generatePaper(requestedMode) {
  const availablePacks = Array.isArray(state.bank?.packs) ? state.bank.packs : [];
  if (!availablePacks.length) return;

  const mode = getModeConfig(requestedMode);
  const candidates = availablePacks.filter((pack) => pack.paper === mode.basePaper);

  if (!candidates.length) {
    dom.paperView.innerHTML = `<div class="notice error">No quiz packs are available for ${escapeHtml(mode.id)}.</div>`;
    return;
  }

  const nextBasePack = chooseDifferentRandomPack(candidates, state.currentPack?.basePackId);
  const displayPack = buildDisplayPack(nextBasePack, mode);

  state.currentPack = displayPack;
  state.answers = loadSavedAnswers(displayPack.id);
  state.lastCopyText = "";
  state.lastResults = [];
  dom.copyFeedbackBtn.disabled = true;
  renderPaper();
  dom.resultWindow.innerHTML = `<p class="muted">This quiz is ready. When the student has answered the questions, click <strong>Mark this paper</strong>.</p>`;
}

function chooseDifferentRandomPack(candidates, previousId) {
  if (candidates.length === 1) return candidates[0];
  const filtered = candidates.filter((pack) => pack.id !== previousId);
  return sampleOne(filtered.length ? filtered : candidates);
}

function buildDisplayPack(basePack, mode) {
  const selectedQuestions = mode.questionNumbers
    .map((questionNumber) => getQuestionByNumber(basePack.questions, questionNumber))
    .filter(Boolean)
    .map((question) => cloneQuestionForMode(question, mode));

  return {
    ...basePack,
    id: `${basePack.id}__${slugify(mode.id)}`,
    basePackId: basePack.id,
    paper: mode.id,
    basePaper: mode.basePaper,
    part: mode.part,
    displayTime: mode.time,
    questions: selectedQuestions
  };
}

function getQuestionByNumber(questions, questionNumber) {
  return Array.isArray(questions)
    ? questions.find((question) => question.questionNumber === questionNumber)
    : null;
}

function cloneQuestionForMode(question, mode) {
  const cloned = JSON.parse(JSON.stringify(question));
  const override = mode.questionOverrides?.[cloned.questionNumber];

  if (override) {
    if (typeof override.markCategory === "number") {
      cloned.markCategory = override.markCategory;
    }
    if (typeof override.rubricMaxScore === "number") {
      cloned.rubric = cloned.rubric || {};
      cloned.rubric.maxScore = override.rubricMaxScore;
    }
    if (typeof override.rubricNotes === "string") {
      cloned.rubric = cloned.rubric || {};
      cloned.rubric.notes = override.rubricNotes;
    }
  }

  return cloned;
}

function renderPaper() {
  const pack = state.currentPack;
  if (!pack) return;

  const paperInfo = state.bank.paperTypes.find((paper) => paper.id === pack.basePaper);
  const totalMarks = pack.questions.reduce((sum, question) => sum + Number(question.markCategory || 0), 0);
  const readingQuestions = pack.questions.filter((question) => String(question.section || "").includes("Section A"));
  const writingQuestions = pack.questions.filter((question) => String(question.section || "").includes("Section B"));

  dom.currentPaperMeta.innerHTML = `
    <div class="meta-card">
      <strong>${escapeHtml(pack.paper)}</strong><br />
      ${escapeHtml(paperInfo?.title || "")}
    </div>
    <div class="meta-card">
      <strong>Time</strong><br />
      ${escapeHtml(pack.displayTime || paperInfo?.time || "1 hour")}
    </div>
    <div class="meta-card">
      <strong>Total marks</strong><br />
      ${escapeHtml(String(totalMarks))}
    </div>
    <div class="meta-card">
      <strong>Questions</strong><br />
      ${escapeHtml(String(pack.questions.length))}
    </div>
  `;

  const readingSection = readingQuestions.length
    ? `
      <section class="paper-section">
        <div class="section-title">Section A: Reading</div>
        ${renderSourceBlock(pack.sourceA)}
        ${pack.sourceB ? renderSourceBlock(pack.sourceB) : ""}
        <div class="questions-area">
          ${readingQuestions.map(renderQuestionCard).join("")}
        </div>
      </section>
    `
    : "";

  const writingSection = writingQuestions.length
    ? `
      <section class="paper-section">
        <div class="section-title">Section B: Writing</div>
        <div class="questions-area">
          ${writingQuestions.map(renderQuestionCard).join("")}
        </div>
      </section>
    `
    : "";

  dom.paperView.innerHTML = `
    <div class="exam-front">
      <div class="exam-title-row">
        <div>
          <p class="paper-brand">AQA GCSE English Language</p>
          <h1>${escapeHtml(pack.paper)}</h1>
          <p class="muted">${escapeHtml(paperInfo?.title || "")}</p>
        </div>
        <div class="total-badge">${escapeHtml(String(totalMarks))} marks</div>
      </div>
      <div class="front-boxes">
        <div class="front-box"><strong>Instructions</strong><br />Answer all questions in this part. Write your answers in the spaces provided.</div>
        <div class="front-box"><strong>Time allowed</strong><br />${escapeHtml(pack.displayTime || paperInfo?.time || "1 hour")}</div>
      </div>
    </div>

    ${readingSection}
    ${writingSection}
  `;
}

function renderSourceBlock(source) {
  if (!source) return "";
  const lines = Array.isArray(source.lines) ? source.lines : [];
  return `
    <div class="source-block">
      <div class="source-header">
        <div>
          <h2>${escapeHtml(source.label)}: ${escapeHtml(source.title)}</h2>
          <div class="muted">${escapeHtml(source.genre)} • ${escapeHtml(source.period)}</div>
        </div>
      </div>
      <div class="line-grid">
        ${lines.map((line, index) => `
          <div class="source-line">
            <span class="line-no">${index + 1}</span>
            <span class="line-text">${escapeHtml(line)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderQuestionCard(question) {
  const answerValue = state.answers[question.id] ?? (question.questionType === "select-true-statements" ? [] : "");
  const answerArea = question.questionType === "select-true-statements"
    ? renderTrueStatementAnswerArea(question, Array.isArray(answerValue) ? answerValue : [])
    : `
      <label class="small-label" for="answer-${escapeHtml(question.id)}">Student answer</label>
      <textarea id="answer-${escapeHtml(question.id)}" class="answer-field" data-question-id="${escapeHtml(question.id)}" placeholder="${escapeHtml(getPlaceholder(question))}">${escapeHtml(String(answerValue || ""))}</textarea>
    `;

  return `
    <article class="question-card" id="${escapeHtml(question.id)}">
      <div class="question-header">
        <div>
          <h3>${escapeHtml(question.questionNumber)}</h3>
          <div class="muted">${escapeHtml(question.assessmentObjective)}${question.focusLines ? " • " + escapeHtml(question.focusLines) : ""}</div>
        </div>
        <div class="mark-chip">${escapeHtml(String(question.markCategory))} marks</div>
      </div>

      <div class="question-instruction">${escapeHtml(question.instructionsTop || "")}</div>
      ${question.statement ? `<div class="statement-box"><strong>Statement:</strong> ${escapeHtml(question.statement)}</div>` : ""}
      <p class="question-text">${escapeHtml(question.questionText)}</p>
      ${renderBullets(question.bulletPoints)}
      ${renderOptions(question.options)}
      ${answerArea}
    </article>
  `;
}

function renderBullets(bullets) {
  if (!Array.isArray(bullets) || !bullets.length) return "";
  return `<ul class="bullets">${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`;
}

function renderOptions(options) {
  if (!Array.isArray(options) || !options.length) return "";
  return `
    <div class="options-block">
      ${options.map((option) => `<div class="option-row">${escapeHtml(option)}</div>`).join("")}
    </div>
  `;
}

function renderTrueStatementAnswerArea(question, selectedValues) {
  const selected = new Set(selectedValues.map((value) => String(value).toUpperCase()));
  return `
    <div class="true-answer-area">
      <div class="small-label">Tick up to four answers</div>
      <div class="checkbox-grid">
        ${question.options.map((option, index) => {
          const letter = getOptionLetter(index);
          return `
            <label class="check-option">
              <input
                type="checkbox"
                class="true-option"
                data-question-id="${escapeHtml(question.id)}"
                value="${escapeHtml(letter)}"
                ${selected.has(letter) ? "checked" : ""}
              />
              <span>${escapeHtml(letter)}</span>
            </label>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function getOptionLetter(index) {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(index);
}

function getPlaceholder(question) {
  if (question.markCategory === 40) {
    return "Write the student's full response here...";
  }
  if (question.markCategory >= 12) {
    return "Write a developed answer using references from the source(s)...";
  }
  return "Write the student's answer here...";
}

function handleAnswerInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.classList.contains("answer-field")) {
    const questionId = target.dataset.questionId;
    if (!questionId) return;
    state.answers[questionId] = target.value;
    persistAnswers();
    return;
  }

  if (target.classList.contains("true-option")) {
    const questionId = target.dataset.questionId;
    if (!questionId) return;
    const checkedBoxes = Array.from(dom.paperView.querySelectorAll(`.true-option[data-question-id="${cssEscape(questionId)}"]:checked`))
      .slice(0, 4)
      .map((input) => input.value);

    if (checkedBoxes.length >= 4) {
      const allBoxes = Array.from(dom.paperView.querySelectorAll(`.true-option[data-question-id="${cssEscape(questionId)}"]`));
      const checkedSet = new Set(checkedBoxes);
      allBoxes.forEach((box) => {
        if (!checkedSet.has(box.value)) {
          box.checked = false;
        }
      });
    }

    state.answers[questionId] = checkedBoxes;
    persistAnswers();
  }
}

function persistAnswers() {
  if (!state.currentPack) return;
  localStorage.setItem(ANSWER_STORAGE_PREFIX + state.currentPack.id, JSON.stringify(state.answers));
}

function loadSavedAnswers(packId) {
  try {
    const raw = localStorage.getItem(ANSWER_STORAGE_PREFIX + packId);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clearCurrentAnswers() {
  if (!state.currentPack) return;
  state.answers = {};
  localStorage.removeItem(ANSWER_STORAGE_PREFIX + state.currentPack.id);
  renderPaper();
  dom.resultWindow.innerHTML = `<p class="muted">All answer boxes for this paper have been cleared.</p>`;
  state.lastCopyText = "";
  state.lastResults = [];
  dom.copyFeedbackBtn.disabled = true;
}

async function markCurrentPaper() {
  const pack = state.currentPack;
  if (!pack) {
    showNotice("No paper has been generated yet.", true);
    return;
  }

  const endpoint = state.markerEndpoint;
  if (!endpoint) {
    showNotice("The marker is not configured in the page code.", true);
    return;
  }

  dom.markPaperBtn.disabled = true;
  dom.markPaperBtn.textContent = "Marking paper…";
  dom.copyFeedbackBtn.disabled = true;

  const results = [];
  let runningTotal = 0;
  const maxTotal = pack.questions.reduce((sum, question) => sum + Number(question.markCategory || 0), 0);

  for (let index = 0; index < pack.questions.length; index += 1) {
    const question = pack.questions[index];
    const answer = normaliseAnswerForSending(question, state.answers[question.id]);

    showNotice(`Marking ${question.questionNumber} (${index + 1} of ${pack.questions.length})…`);

    if (!answer) {
      const blankResult = buildBlankResult(question);
      results.push({ question, result: blankResult });
      renderLiveProgress(results, runningTotal, maxTotal);
      continue;
    }

    try {
      const result = question.questionType === "select-true-statements"
        ? markTrueStatementsLocally(question, answer)
        : await sendForMarking(endpoint, question, answer, pack);

      runningTotal += Number(result.score || 0);
      results.push({ question, result });
      renderLiveProgress(results, runningTotal, maxTotal);
    } catch (error) {
      const failedResult = {
        score: 0,
        max_score: Number(question.markCategory || 0),
        level: "Error",
        strengths: [],
        weaknesses: ["The marking service did not return a usable result."],
        why_this_mark: error?.message || "This question could not be marked.",
        next_level: "Try marking the paper again in a moment.",
        feedback: error?.message || "This question could not be marked.",
        subscores: question.markCategory === 40 ? { content_and_organisation: 0, technical_accuracy: 0 } : null
      };
      results.push({ question, result: failedResult });
      renderLiveProgress(results, runningTotal, maxTotal);
    }
  }

  state.lastResults = results;
  renderResultWindow(pack, results);
  state.lastCopyText = buildCopyText(pack, results);
  dom.copyFeedbackBtn.disabled = false;
  dom.markPaperBtn.disabled = false;
  dom.markPaperBtn.textContent = "Mark this paper";
}

function buildBlankResult(question) {
  const subscores = question.markCategory === 40
    ? { content_and_organisation: 0, technical_accuracy: 0 }
    : null;

  return {
    score: 0,
    max_score: Number(question.markCategory || 0),
    level: "0",
    strengths: [],
    weaknesses: [
      "No answer was provided.",
      "There is no evidence or explanation to reward."
    ],
    why_this_mark: "This response is blank, so it cannot be credited.",
    next_level: "Attempt the question and include clear points supported by the source or task.",
    feedback: "This response is blank, so it cannot be credited.",
    subscores
  };
}

function renderLiveProgress(results, runningTotal, maxTotal) {
  dom.resultWindow.innerHTML = `
    <div class="result-summary">
      <div class="result-total">${escapeHtml(String(runningTotal))}/${escapeHtml(String(maxTotal))}</div>
      <div class="muted">Marked ${escapeHtml(String(results.length))} question(s) so far.</div>
    </div>
  `;
}

async function sendForMarking(endpoint, question, answer, pack) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      question,
      answer,
      packMeta: {
        id: pack.id,
        paper: pack.paper,
        title: pack.title,
        theme: pack.theme,
        sourceA: pack.sourceA || null,
        sourceB: pack.sourceB || null
      }
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Marking request failed (${response.status}).`);
  }

  return normaliseRemoteResult(data, question);
}

function normaliseRemoteResult(data, question) {
  const score = clampNumber(data.score, 0, Number(question.markCategory || 0));
  const maxScore = clampNumber(data.max_score, 0, Number(question.markCategory || 0)) || Number(question.markCategory || 0);
  const level = firstText(data.level, data.band, data.mark_band, "Unbanded");
  const strengths = normaliseStringArray(data.strengths, 3);
  const weaknesses = normaliseStringArray(data.weaknesses || data.improvements, 2);
  const whyThisMark = firstText(data.why_this_mark, data.whyThisMark, data.feedback, "No explanation returned.");
  const nextLevel = firstText(data.next_level, data.nextLevel, data.how_to_reach_next_level, "Develop the answer further with precise references and more detailed explanation.");
  const subscores = data.subscores && typeof data.subscores === "object"
    ? {
        content_and_organisation: Number(data.subscores.content_and_organisation ?? 0),
        technical_accuracy: Number(data.subscores.technical_accuracy ?? 0)
      }
    : null;

  if ((!strengths.length || !weaknesses.length) && Array.isArray(data.breakdown)) {
    const fallbackNotes = data.breakdown.map(normaliseBreakdownItem).filter(Boolean);
    if (!strengths.length) {
      strengths.push(...fallbackNotes.slice(0, 3));
    }
    if (!weaknesses.length && fallbackNotes.length > 3) {
      weaknesses.push(...fallbackNotes.slice(3, 5));
    }
  }

  return {
    score,
    max_score: maxScore,
    level,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    why_this_mark: whyThisMark,
    next_level: nextLevel,
    feedback: whyThisMark,
    subscores
  };
}

function normaliseBreakdownItem(item) {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const label = item.label ? `${item.label}: ` : "";
    const detail = item.detail ? String(item.detail).trim() : "";
    return `${label}${detail}`.trim();
  }
  return "";
}

function markTrueStatementsLocally(question, answer) {
  const selected = Array.from(new Set(String(answer).match(/[A-H]/gi)?.map((value) => value.toUpperCase()) || []));
  const correct = Array.isArray(question.correctOptions) ? question.correctOptions.map((value) => String(value).toUpperCase()) : [];
  const score = selected.filter((value) => correct.includes(value)).length;
  const wrong = selected.filter((value) => !correct.includes(value));
  const missed = correct.filter((value) => !selected.includes(value));

  const strengths = [];
  if (score > 0) {
    strengths.push(`Correct selections: ${selected.filter((value) => correct.includes(value)).join(", ")}.`);
  }
  if (selected.length) {
    strengths.push(`You selected: ${selected.join(", ")}.`);
  }
  if (score === 4) {
    strengths.push("All four credited statements were identified.");
  }

  const weaknesses = [];
  if (wrong.length) {
    weaknesses.push(`These choices are not supported by the source: ${wrong.join(", ")}.`);
  }
  if (missed.length) {
    weaknesses.push(`You missed these credited choices: ${missed.join(", ")}.`);
  }

  return {
    score,
    max_score: 4,
    level: score === 4 ? "Full marks" : score >= 2 ? "Partial" : score >= 1 ? "Limited" : "0",
    strengths,
    weaknesses,
    why_this_mark: score === 4
      ? "All four correct statements were selected, so this response gains full marks."
      : `You selected ${score} correct statement${score === 1 ? "" : "s"}, so the mark reflects the number of statements supported by the text.`,
    next_level: score === 4
      ? "Keep checking each statement carefully against the wording of the source."
      : "Compare each statement closely with the wording of the source and only tick statements that are directly supported.",
    feedback: score === 4
      ? "All four correct statements were selected, so this response gains full marks."
      : `You selected ${score} correct statement${score === 1 ? "" : "s"}. Check each statement more carefully against the source.`,
    subscores: null
  };
}

function normaliseAnswerForSending(question, rawValue) {
  if (question.questionType === "select-true-statements") {
    const values = Array.isArray(rawValue) ? rawValue : [];
    return values.join(", ").trim();
  }
  return String(rawValue || "").trim();
}

function renderResultWindow(pack, results) {
  const total = results.reduce((sum, item) => sum + Number(item.result.score || 0), 0);
  const maxTotal = results.reduce((sum, item) => sum + Number(item.result.max_score || item.question.markCategory || 0), 0);

  dom.resultWindow.innerHTML = `
    <div class="result-summary">
      <div class="result-total">${escapeHtml(String(total))}/${escapeHtml(String(maxTotal))}</div>
      <div>
        <strong>${escapeHtml(pack.paper)}</strong><br />
        <span class="muted">${escapeHtml(String(results.length))} questions marked</span>
      </div>
    </div>
    <div class="result-list">
      ${results.map(({ question, result }) => renderResultCard(question, result)).join("")}
    </div>
  `;
}

function renderResultCard(question, result) {
  const strengths = Array.isArray(result.strengths) ? result.strengths.filter(Boolean) : [];
  const weaknesses = Array.isArray(result.weaknesses) ? result.weaknesses.filter(Boolean) : [];
  const subscores = result.subscores && typeof result.subscores === "object" ? result.subscores : null;

  return `
    <article class="result-card">
      <div class="result-card-head">
        <div>
          <strong>${escapeHtml(question.questionNumber)}</strong>
          <div class="muted">${escapeHtml(question.section)} • ${escapeHtml(String(question.markCategory))} marks</div>
        </div>
        <div class="question-score">${escapeHtml(String(result.score))}/${escapeHtml(String(result.max_score))}</div>
      </div>
      ${result.level ? `<div class="badge-row"><span class="badge">${escapeHtml(result.level)}</span></div>` : ""}
      ${subscores ? `
        <div class="subscore-box">
          <div><strong>Content and organisation:</strong> ${escapeHtml(String(subscores.content_and_organisation ?? 0))}</div>
          <div><strong>Technical accuracy:</strong> ${escapeHtml(String(subscores.technical_accuracy ?? 0))}</div>
        </div>
      ` : ""}
      ${strengths.length ? `
        <div>
          <strong>Strengths</strong>
          <ul class="breakdown-list">${strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      ${weaknesses.length ? `
        <div>
          <strong>Weaknesses / Improvements</strong>
          <ul class="breakdown-list">${weaknesses.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      ` : ""}
      <p class="question-text"><strong>Why this mark:</strong> ${escapeHtml(result.why_this_mark || "No explanation returned.")}</p>
      <p class="question-text"><strong>How to reach the next level:</strong> ${escapeHtml(result.next_level || "Develop the answer further with precise textual support and more detailed explanation.")}</p>
    </article>
  `;
}

function buildCopyText(pack, results) {
  const total = results.reduce((sum, item) => sum + Number(item.result.score || 0), 0);
  const maxTotal = results.reduce((sum, item) => sum + Number(item.result.max_score || item.question.markCategory || 0), 0);

  const lines = [
    "AQA GCSE English Language Practice Quiz Marker",
    `${pack.paper}`,
    `Total score: ${total}/${maxTotal}`,
    ""
  ];

  results.forEach(({ question, result }) => {
    lines.push(`${question.questionNumber} (${question.markCategory} marks)`);
    lines.push(`Score: ${result.score}/${result.max_score}`);
    if (result.level) {
      lines.push(`Level: ${result.level}`);
    }
    if (result.subscores) {
      lines.push(`Content and organisation: ${result.subscores.content_and_organisation ?? 0}`);
      lines.push(`Technical accuracy: ${result.subscores.technical_accuracy ?? 0}`);
    }
    if (Array.isArray(result.strengths) && result.strengths.length) {
      lines.push("Strengths:");
      result.strengths.forEach((item) => lines.push(`- ${item}`));
    }
    if (Array.isArray(result.weaknesses) && result.weaknesses.length) {
      lines.push("Weaknesses / Improvements:");
      result.weaknesses.forEach((item) => lines.push(`- ${item}`));
    }
    lines.push(`Why this mark: ${result.why_this_mark || ""}`);
    lines.push(`How to reach the next level: ${result.next_level || ""}`);
    lines.push("");
  });

  return lines.join("\n");
}

function showNotice(message, isError = false) {
  dom.resultWindow.innerHTML = `<div class="notice${isError ? " error" : ""}">${escapeHtml(message)}</div>`;
}

function sampleOne(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}


function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
