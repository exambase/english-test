
const BANK_URL = "./data/question-bank.json";
const ENDPOINT_STORAGE_KEY = "aqaMockMarkerEndpoint";
const ANSWER_STORAGE_PREFIX = "aqaMockAnswer:";

const state = {
  bank: null,
  filteredQuestions: [],
  selectedQuestionId: null,
  markerEndpoint: localStorage.getItem(ENDPOINT_STORAGE_KEY) || "",
  lastResultText: ""
};

const dom = {
  bankStatus: document.getElementById("bank-status"),
  endpointInput: document.getElementById("endpoint-input"),
  saveEndpointBtn: document.getElementById("save-endpoint-btn"),
  clearEndpointBtn: document.getElementById("clear-endpoint-btn"),
  paperFilter: document.getElementById("paper-filter"),
  markFilter: document.getElementById("mark-filter"),
  questionList: document.getElementById("question-list"),
  questionCount: document.getElementById("question-count"),
  questionView: document.getElementById("question-view"),
  answerBox: document.getElementById("answer-box"),
  autosaveStatus: document.getElementById("autosave-status"),
  markBtn: document.getElementById("mark-btn"),
  clearAnswerBtn: document.getElementById("clear-answer-btn"),
  resultWindow: document.getElementById("result-window"),
  copyFeedbackBtn: document.getElementById("copy-feedback-btn")
};

dom.endpointInput.value = state.markerEndpoint;

async function init() {
  bindEvents();
  await loadBank();
}

function bindEvents() {
  dom.paperFilter.addEventListener("change", applyFilters);
  dom.markFilter.addEventListener("change", applyFilters);

  dom.saveEndpointBtn.addEventListener("click", () => {
    const value = dom.endpointInput.value.trim();
    state.markerEndpoint = value;
    localStorage.setItem(ENDPOINT_STORAGE_KEY, value);
    flashStatus(value ? "Endpoint saved in this browser." : "Endpoint cleared.");
  });

  dom.clearEndpointBtn.addEventListener("click", () => {
    state.markerEndpoint = "";
    dom.endpointInput.value = "";
    localStorage.removeItem(ENDPOINT_STORAGE_KEY);
    flashStatus("Endpoint cleared.");
  });

  dom.answerBox.addEventListener("input", () => {
    const question = getSelectedQuestion();
    if (!question) return;
    localStorage.setItem(ANSWER_STORAGE_PREFIX + question.id, dom.answerBox.value);
    dom.autosaveStatus.textContent = "Answer saved locally.";
  });

  dom.clearAnswerBtn.addEventListener("click", () => {
    const question = getSelectedQuestion();
    dom.answerBox.value = "";
    if (question) {
      localStorage.removeItem(ANSWER_STORAGE_PREFIX + question.id);
    }
    dom.autosaveStatus.textContent = "Answer cleared.";
  });

  dom.markBtn.addEventListener("click", markCurrentResponse);

  dom.copyFeedbackBtn.addEventListener("click", async () => {
    if (!state.lastResultText) return;
    try {
      await navigator.clipboard.writeText(state.lastResultText);
      flashResultNotice("Feedback copied to clipboard.");
    } catch (error) {
      flashResultNotice("Clipboard copy failed. You may need to allow clipboard access.", true);
    }
  });
}

async function loadBank() {
  try {
    dom.bankStatus.textContent = "Loading question bank…";
    const response = await fetch(BANK_URL);
    if (!response.ok) {
      throw new Error(`Question bank request failed (${response.status}).`);
    }
    state.bank = await response.json();
    dom.bankStatus.textContent = `${state.bank.questions.length} questions loaded.`;
    applyFilters();
  } catch (error) {
    dom.bankStatus.textContent = "Question bank failed to load.";
    dom.questionView.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  }
}

function applyFilters() {
  if (!state.bank) return;

  const paperValue = dom.paperFilter.value;
  const markValue = dom.markFilter.value;

  state.filteredQuestions = state.bank.questions.filter((question) => {
    const paperOk = paperValue === "all" || question.paper === paperValue;
    const markOk = markValue === "all" || String(question.markCategory) === markValue;
    return paperOk && markOk;
  });

  dom.questionCount.textContent = String(state.filteredQuestions.length);

  if (!state.filteredQuestions.length) {
    state.selectedQuestionId = null;
    dom.questionList.innerHTML = `<div class="notice">No questions match the current filters.</div>`;
    dom.questionView.innerHTML = `<div class="empty-state">No question selected.</div>`;
    dom.answerBox.value = "";
    return;
  }

  if (!state.filteredQuestions.some((q) => q.id === state.selectedQuestionId)) {
    state.selectedQuestionId = state.filteredQuestions[0].id;
  }

  renderQuestionList();
  renderSelectedQuestion();
}

function renderQuestionList() {
  dom.questionList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.filteredQuestions.forEach((question) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "question-item" + (question.id === state.selectedQuestionId ? " active" : "");
    item.innerHTML = `
      <h3>${escapeHtml(question.displayTitle)}</h3>
      <div class="question-tags">
        <span class="tag">${escapeHtml(question.paper)}</span>
        <span class="tag">${escapeHtml(question.questionNumber)}</span>
        <span class="tag">${escapeHtml(String(question.markCategory))} marks</span>
      </div>
      <div class="muted">${escapeHtml(question.theme)} • ${escapeHtml(question.assessmentObjective)}</div>
    `;
    item.addEventListener("click", () => {
      state.selectedQuestionId = question.id;
      renderQuestionList();
      renderSelectedQuestion();
    });
    fragment.appendChild(item);
  });

  dom.questionList.appendChild(fragment);
}

function renderSelectedQuestion() {
  const question = getSelectedQuestion();
  if (!question) return;

  dom.questionView.innerHTML = `
    <div class="paper-heading">
      <div class="paper-meta">
        <div>
          <h2>AQA GCSE English Language</h2>
          <h3>${escapeHtml(question.paper)} • ${escapeHtml(question.section)}</h3>
          <p class="exam-subtitle">Mock practice task • ${escapeHtml(question.displayTitle)}</p>
        </div>
        <span class="mark-badge">${escapeHtml(String(question.markCategory))} marks</span>
      </div>
    </div>
    <div class="info-block">
      <strong>${escapeHtml(question.questionNumber)}</strong><br />
      ${escapeHtml(question.instructionsTop || "")}<br />
      <span class="muted">${escapeHtml(question.assessmentObjective)} • Suggested time: ${escapeHtml(question.timeGuide || "—")}</span>
    </div>
    ${renderSourceBlock(question.sourceA)}
    ${question.sourceB ? renderSourceBlock(question.sourceB) : ""}
    ${question.statement ? `<div class="statement-block"><strong>Statement</strong><p class="question-text">${escapeHtml(question.statement)}</p></div>` : ""}
    ${renderOptions(question.options)}
    <div class="question-block">
      <p class="question-text"><strong>${escapeHtml(question.questionText)}</strong></p>
      ${renderBullets(question.bulletPoints)}
    </div>
  `;

  const savedAnswer = localStorage.getItem(ANSWER_STORAGE_PREFIX + question.id) || "";
  dom.answerBox.value = savedAnswer;
  dom.autosaveStatus.textContent = savedAnswer ? "Saved answer loaded from this browser." : "Answers auto-save in this browser.";
  resetResultIfNeeded(question);
}

function renderSourceBlock(source) {
  if (!source) return "";
  const linesHtml = source.lines.map((line, index) => `
    <div class="source-line">
      <span class="line-no">${index + 1}</span>
      <span class="line-text">${escapeHtml(line)}</span>
    </div>
  `).join("");

  return `
    <div class="source-block">
      <strong>${escapeHtml(source.label)}: ${escapeHtml(source.title)}</strong>
      <div class="source-meta">${escapeHtml(source.genre)} • ${escapeHtml(source.period)}</div>
      <div class="line-grid">${linesHtml}</div>
    </div>
  `;
}

function renderOptions(options) {
  if (!Array.isArray(options) || !options.length) return "";
  const optionHtml = options.map((option) => `<div class="option">${escapeHtml(option)}</div>`).join("");
  return `
    <div class="options-block">
      <strong>Statements</strong>
      <div class="options-list">${optionHtml}</div>
    </div>
  `;
}

function renderBullets(bullets) {
  if (!Array.isArray(bullets) || !bullets.length) return "";
  return `<ul class="bullets">${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>`;
}

function getSelectedQuestion() {
  return state.filteredQuestions.find((question) => question.id === state.selectedQuestionId) || null;
}

function resetResultIfNeeded(question) {
  state.lastRenderedQuestionId = question.id;
  state.lastResultText = "";
  dom.copyFeedbackBtn.disabled = true;
  dom.resultWindow.innerHTML = `<p class="muted">Marked work for <strong>${escapeHtml(question.displayTitle)}</strong> will appear here.</p>`;
}

async function markCurrentResponse() {
  const question = getSelectedQuestion();
  if (!question) {
    flashResultNotice("Pick a question first.", true);
    return;
  }

  const answer = dom.answerBox.value.trim();
  const endpoint = dom.endpointInput.value.trim();

  if (!endpoint) {
    flashResultNotice("Add your serverless marker endpoint first.", true);
    return;
  }

  if (!answer) {
    flashResultNotice("Enter the student's answer before marking.", true);
    return;
  }

  dom.markBtn.disabled = true;
  dom.markBtn.textContent = "Marking…";
  flashResultNotice("Sending answer for marking…");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        question,
        answer
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Marking request failed (${response.status}).`);
    }

    renderResult(data, question);
  } catch (error) {
    flashResultNotice(error.message || "Marking failed.", true);
  } finally {
    dom.markBtn.disabled = false;
    dom.markBtn.textContent = "Mark response";
  }
}

function renderResult(data, question) {
  const score = Number.isFinite(Number(data.score)) ? Number(data.score) : 0;
  const maxScore = Number.isFinite(Number(data.max_score)) ? Number(data.max_score) : question.markCategory;
  const band = typeof data.band === "string" ? data.band : "Unbanded";
  const feedback = typeof data.feedback === "string" ? data.feedback : "No feedback returned.";
  const breakdown = Array.isArray(data.breakdown) ? data.breakdown : [];
  const subscores = data.subscores && typeof data.subscores === "object" ? data.subscores : null;

  const subscoresHtml = subscores
    ? `
      <div class="info-block">
        <strong>Subscores</strong><br />
        ${Object.entries(subscores).map(([key, value]) => `${escapeHtml(formatKey(key))}: ${escapeHtml(String(value))}`).join("<br />")}
      </div>
    `
    : "";

  dom.resultWindow.innerHTML = `
    <div class="result-score">
      <span class="score-number">${escapeHtml(String(score))}/${escapeHtml(String(maxScore))}</span>
      <span class="badge">${escapeHtml(band)}</span>
    </div>
    ${subscoresHtml}
    <p class="question-text">${escapeHtml(feedback)}</p>
    ${breakdown.length ? `<ul class="breakdown-list">${breakdown.map(renderBreakdownItem).join("")}</ul>` : ""}
  `;

  state.lastResultText = buildCopyText({ question, score, maxScore, band, feedback, breakdown, subscores });
  dom.copyFeedbackBtn.disabled = false;
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

function buildCopyText({ question, score, maxScore, band, feedback, breakdown, subscores }) {
  const lines = [
    "AQA GCSE English Mock Marker",
    `${question.paper} - ${question.questionNumber} - ${question.displayTitle}`,
    `Score: ${score}/${maxScore}`,
    `Band: ${band}`,
    ""
  ];

  if (subscores) {
    lines.push("Subscores:");
    Object.entries(subscores).forEach(([key, value]) => {
      lines.push(`- ${formatKey(key)}: ${value}`);
    });
    lines.push("");
  }

  lines.push("Feedback:");
  lines.push(feedback);
  lines.push("");

  if (breakdown.length) {
    lines.push("Marking breakdown:");
    breakdown.forEach((item) => {
      if (typeof item === "string") {
        lines.push(`- ${item}`);
      } else if (item && typeof item === "object") {
        const label = item.label ? `${item.label}: ` : "";
        lines.push(`- ${label}${item.detail || ""}`);
      }
    });
  }

  return lines.join("\n");
}

function flashStatus(message) {
  dom.bankStatus.textContent = message;
}

function flashResultNotice(message, isError = false) {
  dom.resultWindow.innerHTML = `<div class="notice${isError ? " error" : ""}">${escapeHtml(message)}</div>`;
}

function formatKey(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
