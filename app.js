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
        rubricNotes:
          "Adapted for this part-based quiz. Reward a clear, comparative response with supported judgements and explanation of how methods present viewpoints. Mark out of 20 for this site layout."
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
        rubricNotes:
          "Adapted for this part-based quiz. Reward concise, relevant language analysis linked to viewpoint and effect. Mark out of 8 for this site layout."
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
  lastResults: [],
  notice: {
    message: "Marked work will appear here.",
    isError: false
  },
  busyTask: null
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
  syncToolbarButtons();
  renderResultWindow();
  await loadBank();
}

function populatePaperModeOptions() {
  if (!dom.paperMode) return;
  dom.paperMode.innerHTML = PAPER_MODES.map(
    (mode) => `<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.id)}</option>`
  ).join("");
}

function bindStaticEvents() {
  dom.paperMode.addEventListener("change", () => {
    state.paperMode = dom.paperMode.value;
    localStorage.setItem(PAPER_MODE_STORAGE_KEY, state.paperMode);
  });

  dom.generatePaperBtn.addEventListener("click", () => {
    if (!state.bank || state.busyTask) return;
    generatePaper(state.paperMode);
  });

  dom.clearAnswersBtn.addEventListener("click", clearCurrentAnswers);
  dom.markPaperBtn.addEventListener("click", markCurrentPaper);

  dom.copyFeedbackBtn.addEventListener("click", async () => {
    if (!state.lastCopyText || state.busyTask) return;
    try {
      await navigator.clipboard.writeText(state.lastCopyText);
      setNotice("Feedback copied to clipboard.");
    } catch {
      setNotice("Clipboard copy failed. You may need to allow clipboard access.", true);
    }
    renderResultWindow();
  });

  dom.paperView.addEventListener("input", handleAnswerInput);
  dom.paperView.addEventListener("change", handleAnswerInput);
  dom.resultWindow.addEventListener("click", handleResultWindowClick);
}

async function loadBank() {
  const fetched = await fetchBankWithFallback();

  if (!fetched) {
    state.notice = {
      message: "The paper bank could not be loaded.",
      isError: true
    };
    renderResultWindow();
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
    setNotice(`No quiz packs are available for ${mode.id}.`, true);
    state.lastResults = [];
    state.lastCopyText = "";
    syncToolbarButtons();
    renderResultWindow();
    return;
  }

  const nextBasePack = chooseDifferentRandomPack(candidates, state.currentPack?.basePackId);
  const displayPack = buildDisplayPack(nextBasePack, mode);

  state.currentPack = displayPack;
  state.answers = loadSavedAnswers(displayPack.id);
  state.lastCopyText = "";
  state.lastResults = [];
  setNotice("This quiz is ready. When the student has answered the questions, click Mark this paper.");
  renderPaper();
  syncToolbarButtons();
  renderResultWindow();
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
  if (!state.currentPack || state.busyTask) return;
  state.answers = {};
  localStorage.removeItem(ANSWER_STORAGE_PREFIX + state.currentPack.id);
  renderPaper();
  state.lastCopyText = "";
  state.lastResults = [];
  setNotice("All answer boxes for this paper have been cleared.");
  syncToolbarButtons();
  renderResultWindow();
}

async function markCurrentPaper() {
  const pack = state.currentPack;
  if (!pack) {
    setNotice("No paper has been generated yet.", true);
    renderResultWindow();
    return;
  }

  const endpoint = state.markerEndpoint;
  if (!endpoint) {
    setNotice("The marker is not configured in the page code.", true);
    renderResultWindow();
    return;
  }

  if (state.busyTask) return;

  state.busyTask = { type: "full" };
  state.lastResults = [];
  state.lastCopyText = "";
  setNotice(`Marking ${pack.questions.length} question${pack.questions.length === 1 ? "" : "s"}…`);
  syncToolbarButtons();
  renderResultWindow();

  const results = [];

  for (let index = 0; index < pack.questions.length; index += 1) {
    const question = pack.questions[index];
    const entry = await markSingleQuestion(question, pack, null);
    results.push(entry);
    state.lastResults = results.slice();

    if (entry.status === "error") {
      setNotice(
        `${question.questionNumber} was not marked. The rest of the paper is still being processed.`,
        true
      );
    } else {
      setNotice(`Marked ${question.questionNumber} (${index + 1} of ${pack.questions.length}).`);
    }

    renderResultWindow();
  }

  state.lastResults = results;
  state.lastCopyText = buildCopyText(pack, results);
  state.busyTask = null;

  const retryCount = countRetryableQuestions(results);
  if (retryCount) {
    setNotice(
      `${retryCount} question${retryCount === 1 ? " still needs" : "s still need"} retry. Use Mark again on the affected card${retryCount === 1 ? "" : "s"}.`,
      true
    );
  } else {
    setNotice("All questions marked. You can copy the full feedback now.");
  }

  syncToolbarButtons();
  renderResultWindow();
}

async function markSingleQuestion(question, pack, previousEntry) {
  const answer = normaliseAnswerForSending(question, state.answers[question.id]);
  const attemptCount = Number(previousEntry?.attemptCount || 0) + 1;

  if (!answer) {
    return buildResultEntry(question, buildBlankResult(question), {
      status: "blank",
      attemptCount
    });
  }

  try {
    const result = question.questionType === "select-true-statements"
      ? markTrueStatementsLocally(question, answer)
      : await sendForMarking(state.markerEndpoint, question, answer, pack);

    return buildResultEntry(question, result, {
      status: "marked",
      attemptCount
    });
  } catch (error) {
    return buildResultEntry(question, buildFailedResult(question, error), {
      status: "error",
      attemptCount,
      errorMessage: error?.message || "This question could not be marked."
    });
  }
}

function buildResultEntry(question, result, meta = {}) {
  return {
    question,
    result,
    status: meta.status || "marked",
    attemptCount: Number(meta.attemptCount || 1),
    errorMessage: meta.errorMessage || ""
  };
}

async function remarkQuestion(questionId) {
  if (!state.currentPack || state.busyTask) return;

  const question = state.currentPack.questions.find((item) => item.id === questionId);
  if (!question) return;

  const existingIndex = state.lastResults.findIndex((entry) => entry.question.id === questionId);
  const previousEntry = existingIndex >= 0 ? state.lastResults[existingIndex] : null;

  state.busyTask = {
    type: "retry",
    questionId
  };
  setNotice(`Marking ${question.questionNumber} again…`);
  syncToolbarButtons();
  renderResultWindow();

  const updatedEntry = await markSingleQuestion(question, state.currentPack, previousEntry);

  if (existingIndex >= 0) {
    state.lastResults.splice(existingIndex, 1, updatedEntry);
  } else {
    state.lastResults.push(updatedEntry);
  }

  state.lastCopyText = buildCopyText(state.currentPack, state.lastResults);
  state.busyTask = null;

  if (updatedEntry.status === "error") {
    setNotice(
      `${question.questionNumber} still could not be marked. Wait a few seconds and click Mark again for that question.`,
      true
    );
  } else if (updatedEntry.status === "blank") {
    setNotice(
      `${question.questionNumber} is still blank. Add an answer, then click Mark again for that question.`
    );
  } else {
    const remainingRetryCount = countRetryableQuestions(state.lastResults);
    if (remainingRetryCount) {
      setNotice(
        `${question.questionNumber} was marked again successfully. ${remainingRetryCount} question${remainingRetryCount === 1 ? " still needs" : "s still need"} retry.`,
        true
      );
    } else {
      setNotice(`${question.questionNumber} was marked again successfully.`);
    }
  }

  syncToolbarButtons();
  renderResultWindow();
}

function handleResultWindowClick(event) {
  const button = event.target.closest("[data-action='remark-question']");
  if (!button) return;
  const questionId = button.dataset.questionId;
  if (!questionId) return;
  remarkQuestion(questionId);
}

function buildBlankResult(question) {
  const subscores = question.markCategory === 40
    ? { content_and_organisation: 0, technical_accuracy: 0 }
    : null;

  return {
    score: 0,
    max_score: Number(question.markCategory || 0),
    level: "No response",
    strengths: [],
    weaknesses: [
      "No answer was provided.",
      "There is no evidence or explanation to reward."
    ],
    why_this_mark: "This response is blank, so it cannot be credited.",
    next_level: "Write an answer for this question, then click Mark again on this card.",
    feedback: "This response is blank, so it cannot be credited.",
    subscores
  };
}

function buildFailedResult(question, error) {
  const rawMessage = String(error?.message || "This question could not be marked.").trim();
  const isRateLimit = /rate|limit|quota|429|upgrade/i.test(rawMessage);
  const errorMessage = isRateLimit
    ? `This question was not marked because the API limit was reached. ${rawMessage}`
    : rawMessage;

  return {
    score: 0,
    max_score: Number(question.markCategory || 0),
    level: "Not marked",
    strengths: [],
    weaknesses: [
      isRateLimit
        ? "The API rate limit was reached before this question could be marked."
        : "The marking service did not return a usable result."
    ],
    why_this_mark: errorMessage,
    next_level: isRateLimit
      ? "Wait a few seconds, then click Mark again for this question only."
      : "Click Mark again for this question to retry the request.",
    feedback: errorMessage,
    subscores: question.markCategory === 40
      ? { content_and_organisation: 0, technical_accuracy: 0 }
      : null
  };
}

function computeResultTotals(results) {
  return results.reduce(
    (totals, entry) => {
      totals.score += Number(entry.result.score || 0);
      totals.max += Number(entry.result.max_score || entry.question.markCategory || 0);
      return totals;
    },
    { score: 0, max: 0 }
  );
}

function countRetryableQuestions(results) {
  return results.filter((entry) => entry.status === "error").length;
}

function renderResultWindow() {
  const pack = state.currentPack;
  const results = Array.isArray(state.lastResults) ? state.lastResults : [];
  const noticeHtml = renderNoticeHtml();

  if (!pack || !results.length) {
    dom.resultWindow.innerHTML = `
      ${noticeHtml}
      <p class="muted">Marked work will appear here.</p>
    `;
    return;
  }

  const totals = computeResultTotals(results);
  const retryCount = countRetryableQuestions(results);
  const totalQuestions = pack.questions.length;

  let summaryLine = `${results.length} question${results.length === 1 ? "" : "s"} marked.`;
  if (state.busyTask?.type === "full") {
    summaryLine = `Marked ${results.length} of ${totalQuestions} question${totalQuestions === 1 ? "" : "s"} so far.`;
  } else if (retryCount) {
    const completed = results.length - retryCount;
    summaryLine = `${completed} marked, ${retryCount} waiting for retry.`;
  }

  dom.resultWindow.innerHTML = `
    ${noticeHtml}
    <div class="result-summary">
      <div class="result-total">${escapeHtml(String(totals.score))}/${escapeHtml(String(totals.max))}</div>
      <div>
        <strong>${escapeHtml(pack.paper)}</strong><br />
        <span class="muted">${escapeHtml(summaryLine)}</span>
      </div>
    </div>
    <div class="result-list">
      ${results.map(renderResultCard).join("")}
    </div>
  `;
}

function renderResultCard(entry) {
  const { question, result, status, attemptCount } = entry;
  const strengths = Array.isArray(result.strengths) ? result.strengths.filter(Boolean) : [];
  const weaknesses = Array.isArray(result.weaknesses) ? result.weaknesses.filter(Boolean) : [];
  const subscores = result.subscores && typeof result.subscores === "object" ? result.subscores : null;
  const isRetrying = state.busyTask?.type === "retry" && state.busyTask.questionId === question.id;
  const retryDisabled = Boolean(state.busyTask);

  return `
    <article class="result-card">
      <div class="result-card-head">
        <div>
          <strong>${escapeHtml(question.questionNumber)}</strong>
          <div class="muted">${escapeHtml(question.section)} • ${escapeHtml(String(question.markCategory))} marks</div>
        </div>
        <div class="question-score">${escapeHtml(String(result.score))}/${escapeHtml(String(result.max_score))}</div>
      </div>
      <div class="badge-row result-badge-row">
        ${result.level ? `<span class="badge">${escapeHtml(result.level)}</span>` : ""}
        ${renderStatusPill(status)}
      </div>
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
      <div class="result-card-actions button-row">
        <button
          type="button"
          class="ghost-btn retry-btn"
          data-action="remark-question"
          data-question-id="${escapeHtml(question.id)}"
          ${retryDisabled ? "disabled" : ""}
        >${isRetrying ? "Marking again…" : "Mark again"}</button>
        <span class="attempt-note muted">Attempts: ${escapeHtml(String(attemptCount || 1))}</span>
      </div>
    </article>
  `;
}

function renderStatusPill(status) {
  if (status === "error") {
    return `<span class="status-pill error">Needs retry</span>`;
  }
  if (status === "blank") {
    return `<span class="status-pill blank">Blank</span>`;
  }
  return `<span class="status-pill ok">Marked</span>`;
}

function buildCopyText(pack, results) {
  const totals = computeResultTotals(results);

  const lines = [
    "AQA GCSE English Language Practice Quiz Marker",
    `${pack.paper}`,
    `Total score: ${totals.score}/${totals.max}`,
    ""
  ];

  results.forEach((entry) => {
    const { question, result, status, attemptCount } = entry;
    lines.push(`${question.questionNumber} (${question.markCategory} marks)`);
    lines.push(`Score: ${result.score}/${result.max_score}`);
    if (result.level) {
      lines.push(`Level: ${result.level}`);
    }
    if (status === "error") {
      lines.push("Status: Not marked yet - use Mark again on this question.");
    } else if (status === "blank") {
      lines.push("Status: Blank response.");
    } else {
      lines.push("Status: Marked.");
    }
    lines.push(`Attempts: ${attemptCount || 1}`);
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

function renderNoticeHtml() {
  if (!state.notice?.message) return "";
  return `<div class="notice result-inline-notice${state.notice.isError ? " error" : ""}">${escapeHtml(state.notice.message)}</div>`;
}

function setNotice(message, isError = false) {
  state.notice = {
    message,
    isError
  };
}

function syncToolbarButtons() {
  const busy = state.busyTask;

  dom.markPaperBtn.disabled = Boolean(busy);
  dom.generatePaperBtn.disabled = Boolean(busy);
  dom.clearAnswersBtn.disabled = Boolean(busy);

  if (busy?.type === "full") {
    dom.markPaperBtn.textContent = "Marking paper…";
  } else if (busy?.type === "retry") {
    dom.markPaperBtn.textContent = "Please wait…";
  } else {
    dom.markPaperBtn.textContent = "Mark this paper";
  }

  dom.copyFeedbackBtn.disabled = Boolean(busy) || !state.lastCopyText;
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
  const nextLevel = firstText(
    data.next_level,
    data.nextLevel,
    data.how_to_reach_next_level,
    "Develop the answer further with precise references and more detailed explanation."
  );
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
    why_this_mark:
      score === 4
        ? "All four correct statements were selected, so this response gains full marks."
        : `You selected ${score} correct statement${score === 1 ? "" : "s"}, so the mark reflects the number of statements supported by the text.`,
    next_level:
      score === 4
        ? "Keep checking each statement carefully against the wording of the source."
        : "Compare each statement closely with the wording of the source and only tick statements that are directly supported.",
    feedback:
      score === 4
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
