const BANK_CANDIDATE_URLS = [
  "./data/question-bank.json",
  "data/question-bank.json",
  "/data/question-bank.json"
];

const ENDPOINT_STORAGE_KEY = "aqaPaperMarkerEndpoint";
const PAPER_MODE_STORAGE_KEY = "aqaPaperMode";
const ANSWER_STORAGE_PREFIX = "aqaPaperAnswers:";

const state = {
  bank: null,
  currentPack: null,
  paperMode: localStorage.getItem(PAPER_MODE_STORAGE_KEY) || "Paper 1",
  markerEndpoint: localStorage.getItem(ENDPOINT_STORAGE_KEY) || "",
  answers: {},
  lastCopyText: "",
  lastResults: []
};

const dom = {
  bankStatus: document.getElementById("bank-status"),
  endpointInput: document.getElementById("endpoint-input"),
  saveEndpointBtn: document.getElementById("save-endpoint-btn"),
  clearEndpointBtn: document.getElementById("clear-endpoint-btn"),
  paperMode: document.getElementById("paper-mode"),
  generatePaperBtn: document.getElementById("generate-paper-btn"),
  currentPaperMeta: document.getElementById("current-paper-meta"),
  paperView: document.getElementById("paper-view"),
  markPaperBtn: document.getElementById("mark-paper-btn"),
  clearAnswersBtn: document.getElementById("clear-answers-btn"),
  resultWindow: document.getElementById("result-window"),
  copyFeedbackBtn: document.getElementById("copy-feedback-btn")
};

dom.endpointInput.value = state.markerEndpoint;
dom.paperMode.value = state.paperMode;

init();

async function init() {
  bindStaticEvents();
  await loadBank();
}

function bindStaticEvents() {
  dom.saveEndpointBtn.addEventListener("click", () => {
    state.markerEndpoint = dom.endpointInput.value.trim();
    localStorage.setItem(ENDPOINT_STORAGE_KEY, state.markerEndpoint);
    setBankStatus(state.markerEndpoint ? "Marker endpoint saved in this browser." : "Marker endpoint cleared.");
  });

  dom.clearEndpointBtn.addEventListener("click", () => {
    state.markerEndpoint = "";
    dom.endpointInput.value = "";
    localStorage.removeItem(ENDPOINT_STORAGE_KEY);
    setBankStatus("Marker endpoint cleared.");
  });

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
    } catch (error) {
      showNotice("Clipboard copy failed. You may need to allow clipboard access.", true);
    }
  });

  dom.paperView.addEventListener("input", handleAnswerInput);
  dom.paperView.addEventListener("change", handleAnswerInput);
}

async function loadBank() {
  setBankStatus("Loading question bank…");
  const fetched = await fetchBankWithFallback();

  if (!fetched) {
    setBankStatus("Question bank failed to load.");
    dom.paperView.innerHTML = `<div class="notice error">The question bank could not be loaded from JSON or from the embedded fallback.</div>`;
    return;
  }

  state.bank = fetched;
  const packCount = Array.isArray(state.bank.packs) ? state.bank.packs.length : 0;
  setBankStatus(`${packCount} full paper packs loaded.`);
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
    } catch (error) {
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

function generatePaper(requestedMode) {
  const availablePacks = Array.isArray(state.bank?.packs) ? state.bank.packs : [];
  if (!availablePacks.length) return;

  const actualPaper = requestedMode === "Random"
    ? sampleOne(state.bank.paperTypes.map((paper) => paper.id))
    : requestedMode;

  const candidates = availablePacks.filter((pack) => pack.paper === actualPaper);
  if (!candidates.length) {
    dom.paperView.innerHTML = `<div class="notice error">No paper packs are available for ${escapeHtml(actualPaper)}.</div>`;
    return;
  }

  const nextPack = chooseDifferentRandomPack(candidates, state.currentPack?.id);
  state.currentPack = nextPack;
  state.answers = loadSavedAnswers(nextPack.id);
  state.lastCopyText = "";
  state.lastResults = [];
  dom.copyFeedbackBtn.disabled = true;
  renderPaper();
  dom.resultWindow.innerHTML = `<p class="muted">This paper is ready. When the student has answered the questions, click <strong>Mark this paper</strong>.</p>`;
}

function chooseDifferentRandomPack(candidates, previousId) {
  if (candidates.length === 1) return candidates[0];
  const filtered = candidates.filter((pack) => pack.id !== previousId);
  return sampleOne(filtered.length ? filtered : candidates);
}

function renderPaper() {
  const pack = state.currentPack;
  if (!pack) return;

  const paperInfo = state.bank.paperTypes.find((paper) => paper.id === pack.paper);
  const totalMarks = pack.questions.reduce((sum, question) => sum + Number(question.markCategory || 0), 0);

  dom.currentPaperMeta.innerHTML = `
    <div class="meta-card">
      <strong>${escapeHtml(pack.paper)}</strong><br />
      ${escapeHtml(paperInfo?.title || "")}
    </div>
    <div class="meta-card">
      <strong>Time</strong><br />
      ${escapeHtml(paperInfo?.time || "1 hour 45 minutes")}
    </div>
    <div class="meta-card">
      <strong>Total marks</strong><br />
      ${escapeHtml(String(totalMarks))}
    </div>
    <div class="meta-card">
      <strong>Pack</strong><br />
      ${escapeHtml(pack.title)}
    </div>
  `;

  dom.paperView.innerHTML = `
    <div class="exam-front">
      <div class="exam-title-row">
        <div>
          <p class="paper-brand">AQA GCSE English Language</p>
          <h1>${escapeHtml(pack.paper)}: ${escapeHtml(paperInfo?.title || "")}</h1>
          <p class="muted">Original mock paper pack • Theme: ${escapeHtml(pack.theme)}</p>
        </div>
        <div class="total-badge">${escapeHtml(String(totalMarks))} marks</div>
      </div>
      <div class="front-boxes">
        <div class="front-box"><strong>Instructions</strong><br />Answer all questions. Write your answers in the spaces provided.</div>
        <div class="front-box"><strong>Reminder</strong><br />This dashboard generates a full paper automatically from the bank.</div>
      </div>
    </div>

    <section class="paper-section">
      <div class="section-title">Section A: Reading</div>
      ${renderSourceBlock(pack.sourceA)}
      ${pack.sourceB ? renderSourceBlock(pack.sourceB) : ""}
      <div class="questions-area">
        ${pack.questions.filter((question) => question.section.includes("Section A")).map(renderQuestionCard).join("")}
      </div>
    </section>

    <section class="paper-section">
      <div class="section-title">Section B: Writing</div>
      <div class="questions-area">
        ${pack.questions.filter((question) => question.section.includes("Section B")).map(renderQuestionCard).join("")}
      </div>
    </section>
  `;
}

function renderSourceBlock(source) {
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
      <div class="muted">The selected letters are saved automatically in this browser.</div>
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
  dom.copyFeedbackBtn.disabled = true;
}

async function markCurrentPaper() {
  const pack = state.currentPack;
  if (!pack) {
    showNotice("No paper has been generated yet.", true);
    return;
  }

  const endpoint = dom.endpointInput.value.trim();
  const needsEndpoint = pack.questions.some((question) => {
    const answer = normaliseAnswerForSending(question, state.answers[question.id]);
    return answer && question.questionType !== "select-true-statements";
  });

  if (needsEndpoint && !endpoint) {
    showNotice("Add your /api/mark endpoint first, then click Mark this paper again.", true);
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
      const blankResult = {
        score: 0,
        max_score: Number(question.markCategory || 0),
        band: "0",
        feedback: "No answer was provided for this question.",
        breakdown: [{ label: "Status", detail: "Blank response" }],
        subscores: question.markCategory === 40 ? { content_and_organisation: 0, technical_accuracy: 0 } : null
      };
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
      results.push({
        question,
        result: {
          score: 0,
          max_score: Number(question.markCategory || 0),
          band: "Error",
          feedback: error?.message || "This question could not be marked.",
          breakdown: [{ label: "Problem", detail: "The marker endpoint did not return a usable result." }],
          subscores: question.markCategory === 40 ? { content_and_organisation: 0, technical_accuracy: 0 } : null
        }
      });
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
        theme: pack.theme
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

  return {
    score: Number.isFinite(Number(data.score)) ? Number(data.score) : 0,
    max_score: Number.isFinite(Number(data.max_score)) ? Number(data.max_score) : Number(question.markCategory || 0),
    band: typeof data.band === "string" ? data.band : "Unbanded",
    feedback: typeof data.feedback === "string" ? data.feedback : "No feedback returned.",
    breakdown: Array.isArray(data.breakdown) ? data.breakdown : [],
    subscores: data.subscores && typeof data.subscores === "object" ? data.subscores : null
  };
}

function markTrueStatementsLocally(question, answer) {
  const selected = Array.from(new Set(String(answer).match(/[A-H]/gi)?.map((value) => value.toUpperCase()) || []));
  const correct = Array.isArray(question.correctOptions) ? question.correctOptions.map((value) => String(value).toUpperCase()) : [];
  const score = selected.filter((value) => correct.includes(value)).length;
  const wrong = selected.filter((value) => !correct.includes(value));
  const missed = correct.filter((value) => !selected.includes(value));

  const breakdown = [
    { label: "Selected", detail: selected.length ? selected.join(", ") : "No options chosen" },
    { label: "Correct answers", detail: correct.join(", ") }
  ];

  if (wrong.length) {
    breakdown.push({ label: "Not credited", detail: wrong.join(", ") });
  }
  if (missed.length) {
    breakdown.push({ label: "Missed", detail: missed.join(", ") });
  }

  return {
    score,
    max_score: 4,
    band: score === 4 ? "Full marks" : score >= 2 ? "Partial" : score >= 1 ? "Limited" : "0",
    feedback: score === 4
      ? "All four correct statements were selected."
      : `You selected ${score} correct statement${score === 1 ? "" : "s"}. Check Source A carefully and choose only the statements supported by the text.`,
    breakdown,
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
        <strong>${escapeHtml(pack.paper)} • ${escapeHtml(pack.title)}</strong><br />
        <span class="muted">${escapeHtml(results.length)} questions marked</span>
      </div>
    </div>
    <div class="result-list">
      ${results.map(({ question, result }) => renderResultCard(question, result)).join("")}
    </div>
  `;
}

function renderResultCard(question, result) {
  const breakdown = Array.isArray(result.breakdown) ? result.breakdown : [];
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
      <div class="badge-row"><span class="badge">${escapeHtml(result.band || "Unbanded")}</span></div>
      ${subscores ? `
        <div class="subscore-box">
          <div><strong>Content and organisation:</strong> ${escapeHtml(String(subscores.content_and_organisation ?? 0))}</div>
          <div><strong>Technical accuracy:</strong> ${escapeHtml(String(subscores.technical_accuracy ?? 0))}</div>
        </div>
      ` : ""}
      <p class="question-text">${escapeHtml(result.feedback || "No feedback returned.")}</p>
      ${breakdown.length ? `<ul class="breakdown-list">${breakdown.map(renderBreakdownItem).join("")}</ul>` : ""}
    </article>
  `;
}

function renderBreakdownItem(item) {
  if (typeof item === "string") {
    return `<li>${escapeHtml(item)}</li>`;
  }
  if (item && typeof item === "object") {
    const label = item.label ? `<strong>${escapeHtml(item.label)}:</strong> ` : "";
    const detail = item.detail ? escapeHtml(item.detail) : "";
    return `<li>${label}${detail}</li>`;
  }
  return `<li>${escapeHtml(String(item))}</li>`;
}

function buildCopyText(pack, results) {
  const total = results.reduce((sum, item) => sum + Number(item.result.score || 0), 0);
  const maxTotal = results.reduce((sum, item) => sum + Number(item.result.max_score || item.question.markCategory || 0), 0);

  const lines = [
    "AQA GCSE English Language Mock Marker",
    `${pack.paper} - ${pack.title}`,
    `Theme: ${pack.theme}`,
    `Total score: ${total}/${maxTotal}`,
    ""
  ];

  results.forEach(({ question, result }) => {
    lines.push(`${question.questionNumber} (${question.markCategory} marks)`);
    lines.push(`Score: ${result.score}/${result.max_score}`);
    lines.push(`Band: ${result.band}`);
    if (result.subscores) {
      lines.push(`Content and organisation: ${result.subscores.content_and_organisation ?? 0}`);
      lines.push(`Technical accuracy: ${result.subscores.technical_accuracy ?? 0}`);
    }
    lines.push(`Feedback: ${result.feedback}`);
    if (Array.isArray(result.breakdown) && result.breakdown.length) {
      lines.push("Marking breakdown:");
      result.breakdown.forEach((item) => {
        if (typeof item === "string") {
          lines.push(`- ${item}`);
        } else if (item && typeof item === "object") {
          lines.push(`- ${item.label ? item.label + ": " : ""}${item.detail || ""}`);
        }
      });
    }
    lines.push("");
  });

  return lines.join("\n");
}

function setBankStatus(message) {
  dom.bankStatus.textContent = message;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
