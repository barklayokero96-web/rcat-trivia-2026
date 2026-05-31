const CONFIG = {
  questionsPerQuiz: 5,
  secondsPerQuestion: 40,
  adminCode: "RCAT2026",
  storageKey: "rcat-weekly-attempts",
  activeStorageKey: "rcat-active-participants",
  weeklySetStorageKey: "rcat-weekly-question-sets",
  activeWindowSeconds: 40,
};

const state = {
  questions: [],
  route: "home",
  participant: null,
  sessionId: null,
  activeQuestions: [],
  currentIndex: 0,
  answers: [],
  questionStartedAt: 0,
  quizStartedAt: 0,
  timerId: null,
  activeHeartbeatId: null,
  secondsLeft: CONFIG.secondsPerQuestion,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function currentWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function readAttempts() {
  const all = JSON.parse(localStorage.getItem(CONFIG.storageKey) || "{}");
  return all[currentWeekKey()] || [];
}

function readWeeklySets() {
  return JSON.parse(localStorage.getItem(CONFIG.weeklySetStorageKey) || "{}");
}

function writeWeeklySets(sets) {
  localStorage.setItem(CONFIG.weeklySetStorageKey, JSON.stringify(sets));
}

function getQuestionById(id) {
  return state.questions.find((question) => question.id === id);
}

function weeklyQuestions(forceNew = false) {
  const week = currentWeekKey();
  const sets = readWeeklySets();
  const hasValidSet =
    !forceNew &&
    Array.isArray(sets[week]) &&
    sets[week].length === CONFIG.questionsPerQuiz &&
    sets[week].every((id) => getQuestionById(id));

  if (!hasValidSet) {
    const picked = [];
    const candidates = selectDiverseQuestions();

    for (const q of candidates) {
      if (picked.length < CONFIG.questionsPerQuiz) picked.push(q.id);
    }

    // Fill up if fewer than required
    const remaining = shuffle(state.questions.filter((q) => !picked.includes(q.id)));
    for (const q of remaining) {
      if (picked.length >= CONFIG.questionsPerQuiz) break;
      picked.push(q.id);
    }

    sets[week] = picked.slice(0, CONFIG.questionsPerQuiz);
    writeWeeklySets(sets);
  }

  return (sets[week] || []).map(getQuestionById).filter(Boolean);
}

function readActiveSessions() {
  const all = JSON.parse(localStorage.getItem(CONFIG.activeStorageKey) || "{}");
  return all[currentWeekKey()] || [];
}

function writeActiveSessions(sessions) {
  const all = JSON.parse(localStorage.getItem(CONFIG.activeStorageKey) || "{}");
  all[currentWeekKey()] = sessions;
  localStorage.setItem(CONFIG.activeStorageKey, JSON.stringify(all));
}

function activeSessions() {
  const cutoff = Date.now() - CONFIG.activeWindowSeconds * 1000;
  const sessions = readActiveSessions().filter((session) => session.lastSeen >= cutoff);
  writeActiveSessions(sessions);
  return sessions;
}

function touchActiveSession(status = "answering") {
  if (!state.sessionId || !state.participant) return;
  const sessions = activeSessions().filter((session) => session.id !== state.sessionId);
  sessions.push({
    id: state.sessionId,
    name: state.participant.fullName,
    status,
    questionNumber: Math.min(state.currentIndex + 1, CONFIG.questionsPerQuiz),
    startedAt: state.quizStartedAt,
    lastSeen: Date.now(),
  });
  writeActiveSessions(sessions);
}

function clearActiveSession() {
  if (!state.sessionId) return;
  writeActiveSessions(activeSessions().filter((session) => session.id !== state.sessionId));
  if (state.activeHeartbeatId) clearInterval(state.activeHeartbeatId);
  state.activeHeartbeatId = null;
}

function writeAttempts(attempts) {
  const all = JSON.parse(localStorage.getItem(CONFIG.storageKey) || "{}");
  all[currentWeekKey()] = attempts;
  localStorage.setItem(CONFIG.storageKey, JSON.stringify(all));
}

function rankedAttempts() {
  return readAttempts().slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.completionTime !== b.completionTime) return a.completionTime - b.completionTime;
    return new Date(a.completedAt) - new Date(b.completedAt);
  });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function selectDiverseQuestions() {
  const requiredTopics = ["Flooding", "EMS", "MCI", "HAZMAT", "SAF"];
  const picked = [];

  for (const topic of requiredTopics) {
    const pool = shuffle(state.questions.filter((q) => q.topic === topic));
    if (pool.length) picked.push(pool[0]);
  }

  // If fewer than needed, add random remaining
  const remaining = shuffle(state.questions.filter((q) => !picked.some((p) => p.id === q.id)));
  for (const q of remaining) {
    if (picked.length >= CONFIG.questionsPerQuiz) break;
    picked.push(q);
  }

  return picked.slice(0, CONFIG.questionsPerQuiz);
}

function publicQuizUrl() {
  const path = window.location.pathname.endsWith("/") ? window.location.pathname : `${window.location.pathname}/`;
  return `${window.location.origin}${path}#quiz`;
}

function setRoute(route) {
  const isAdmin = route === "admin";
  const newRoute = isAdmin ? "admin" : "quiz";
  state.route = newRoute;
  location.hash = newRoute;
  document.body.classList.toggle("public-quiz", newRoute === "quiz");
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${newRoute}View`)?.classList.add("active");
  if (newRoute === "quiz") resetQuizEntry();
  if (newRoute === "admin") renderAdmin();
}

function formatSeconds(value) {
  return `${Math.round(value)}s`;
}

function renderLeaderboard(target, attempts = rankedAttempts().slice(0, 3)) {
  const list = $(target);
  list.innerHTML = "";
  if (!attempts.length) {
    const empty = document.createElement("li");
    empty.textContent = "No attempts yet";
    list.appendChild(empty);
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  attempts.forEach((attempt, index) => {
    const li = document.createElement("li");
    const medal = medals[index] || "";
    const office = attempt.clusterOffice || attempt.team || "Independent";
    li.textContent = `${medal} ${attempt.fullName} — ${office} — ${attempt.score}/5 · ${formatSeconds(attempt.completionTime)}`;
    list.appendChild(li);
  });
}

function renderHome() {
  const topics = new Set(state.questions.map((question) => question.topic));
  $("#publicLink").textContent = publicQuizUrl();
  $("#weekLabel").textContent = currentWeekKey();
  $("#questionCount").textContent = state.questions.length;
  $("#topicCount").textContent = topics.size;
  $("#attemptCount").textContent = readAttempts().length;
  renderLeaderboard("#publicLeaderboard");
}

function startQuiz(participant) {
  state.participant = participant;
  state.sessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  // Build activeQuestions with keyed options and correctAnswer as a key (A,B,C...)
  state.activeQuestions = weeklyQuestions().map((question) => {
    const opts = shuffle(question.options || []);
    const keyed = opts.map((text, i) => ({ key: String.fromCharCode(65 + i), text }));
    let correctKey = null;
    if (question.correctAnswer) {
      // correctAnswer may be text or a key
      const idx = keyed.findIndex((o) => o.text === question.correctAnswer || o.key === question.correctAnswer);
      correctKey = idx >= 0 ? keyed[idx].key : null;
    }
    return {
      ...question,
      options: keyed,
      correctAnswer: correctKey,
    };
  });
  state.currentIndex = 0;
  state.answers = [];
  state.quizStartedAt = Date.now();
  $("#participantForm")?.classList.add("hidden");
  $("#resultPanel")?.classList.add("hidden");
  $("#questionPanel")?.classList.remove("hidden");
  touchActiveSession();
  if (state.activeHeartbeatId) clearInterval(state.activeHeartbeatId);
  state.activeHeartbeatId = setInterval(() => touchActiveSession(), 5000);
  showQuestion();
}

function resetQuizEntry() {
  if (state.timerId) clearInterval(state.timerId);
  clearActiveSession();
  state.participant = null;
  state.activeQuestions = [];
  state.currentIndex = 0;
  state.answers = [];
  $("#participantForm")?.reset();
  $("#participantForm")?.classList.remove("hidden");
  $("#questionPanel")?.classList.add("hidden");
  $("#resultPanel")?.classList.add("hidden");
}

function showQuestion() {
  if (state.timerId) clearInterval(state.timerId);
  const question = state.activeQuestions[state.currentIndex];
  state.secondsLeft = CONFIG.secondsPerQuestion;
  state.questionStartedAt = Date.now();
  $("#progressText").textContent = `Question ${state.currentIndex + 1} of ${CONFIG.questionsPerQuiz}`;
  $("#topicPill").textContent = question.topic || "";
  $("#questionText").textContent = question.question || question.text || "";
  $("#progressBar").style.width = `${(state.currentIndex / CONFIG.questionsPerQuiz) * 100}%`;
  renderAnswerButtons(question);
  touchActiveSession();
  tickTimer();
  state.timerId = setInterval(tickTimer, 250);
}

function tickTimer() {
  const elapsed = (Date.now() - state.questionStartedAt) / 1000;
  state.secondsLeft = Math.max(0, CONFIG.secondsPerQuestion - elapsed);
  $("#timer").textContent = Math.ceil(state.secondsLeft);
  if (state.secondsLeft <= 0) {
    // timed out
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    submitAnswer(null);
  }
}

function renderAnswerButtons(question) {
  const container = $("#answers");
  container.innerHTML = "";
  if (!question || !Array.isArray(question.options)) return;
  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${option.key}. ${option.text}`;
    button.addEventListener("click", () => submitAnswer(option.key));
    container.appendChild(button);
  });
}

function submitAnswer(selectedAnswer) {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  const question = state.activeQuestions[state.currentIndex];
  const responseTime = Math.min(CONFIG.secondsPerQuestion, (Date.now() - state.questionStartedAt) / 1000);
  const isCorrect = selectedAnswer && question.correctAnswer ? selectedAnswer === question.correctAnswer : false;
  state.answers.push({
    questionId: question.id,
    topic: question.topic,
    question: question.question || question.text,
    selectedAnswer,
    correctAnswer: question.correctAnswer,
    isCorrect,
    responseTime,
    explanation: question.explanation || "",
  });

  state.currentIndex += 1;
  $("#progressBar").style.width = `${(state.currentIndex / CONFIG.questionsPerQuiz) * 100}%`;
  if (state.currentIndex >= CONFIG.questionsPerQuiz) finishQuiz();
  else setTimeout(showQuestion, 220);
}

function finishQuiz() {
  clearActiveSession();
  const completionTime = (Date.now() - state.quizStartedAt) / 1000;
  const score = state.answers.filter((answer) => answer.isCorrect).length;
  const attempt = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    ...state.participant,
    score,
    completionTime,
    startedAt: new Date(state.quizStartedAt).toISOString(),
    completedAt: new Date().toISOString(),
    week: currentWeekKey(),
    answers: state.answers,
  };
  const attempts = readAttempts();
  attempts.push(attempt);
  writeAttempts(attempts);
  renderResult(attempt);
}

function renderResult(attempt) {
  $("#questionPanel")?.classList.add("hidden");
  $("#resultPanel")?.classList.remove("hidden");
  $("#resultTitle").textContent = `${attempt.fullName}, you scored ${attempt.score}/5`;
  $("#resultDetail").textContent = `Completed in ${formatSeconds(attempt.completionTime)}. The weekly ranking uses score first, then fastest completion time.`;
  const review = $("#reviewList");
  review.innerHTML = "";
  attempt.answers.forEach((answer, index) => {
    const item = document.createElement("div");
    item.className = "review-item";
    item.innerHTML = `
      <strong>Q${index + 1}: ${answer.isCorrect ? "Correct" : "Incorrect"}</strong>
      <div>${answer.question}</div>
      <div>Your answer: ${answer.selectedAnswer || "Timed out"} · Correct answer: ${answer.correctAnswer}</div>
      <div>${answer.explanation || ""}</div>
    `;
    review.appendChild(item);
  });
  renderHome();
}

function renderAdmin() {
  if (sessionStorage.getItem("rcatAdmin") === "true") {
    $("#adminGate")?.classList.add("hidden");
    $("#adminDashboard")?.classList.remove("hidden");
    renderReports();
  }
}

function renderReports() {
  const attempts = rankedAttempts();
  const fastest = attempts.length ? Math.min(...attempts.map((attempt) => attempt.completionTime)) : 0;
  const average = attempts.length ? attempts.reduce((sum, attempt) => sum + attempt.score, 0) / attempts.length : 0;
  $("#adminAttempts").textContent = attempts.length;
  $("#activeParticipants").textContent = activeSessions().length;
  $("#averageScore").textContent = average.toFixed(1);
  $("#fastestTime").textContent = formatSeconds(fastest);
  $("#bestScore").textContent = `${attempts[0]?.score || 0}/5`;
  renderLeaderboard("#adminTopThree", attempts.slice(0, 3));
  renderOfficeReport(attempts);
  renderWeeklyQuestions();
  renderTopicReport(attempts);
  renderQuestionReport(attempts);
  renderAttemptRows(attempts);
}

function correctAnswerText(question) {
  // If correctAnswer is a key (A/B/...), map to text; otherwise return as-is
  if (Array.isArray(question.options)) {
    const opt = question.options.find((o) => o.key === question.correctAnswer || o.text === question.correctAnswer);
    return opt ? `${opt.key}. ${opt.text}` : question.correctAnswer;
  }
  return question.correctAnswer;
}

function renderWeeklyQuestions() {
  const rows = $("#weeklyQuestionRows");
  rows.innerHTML = "";
  weeklyQuestions().forEach((question) => {
    const tr = document.createElement("tr");
    const qText = question.question || question.text || "";
    tr.innerHTML = `<td>${qText}</td><td>${question.topic || ""}</td><td>${correctAnswerText(question)}</td>`;
    rows.appendChild(tr);
  });
}

function renderOfficeReport(attempts) {
  const officeStats = new Map();
  attempts.forEach((attempt) => {
    const office = attempt.clusterOffice || attempt.team || "Unspecified";
    officeStats.set(office, (officeStats.get(office) || 0) + 1);
  });
  const report = $("#officeReport");
  report.innerHTML = "";
  if (!officeStats.size) {
    report.innerHTML = `Office participation appears after the first submission.`;
    return;
  }
  [...officeStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([office, total]) => {
      const row = document.createElement("div");
      row.className = "topic-row";
      row.innerHTML = `<strong>${office}</strong><div>${total}</div>`;
      report.appendChild(row);
    });
}

function renderTopicReport(attempts) {
  const topicStats = new Map();
  attempts.flatMap((attempt) => attempt.answers).forEach((answer) => {
    const current = topicStats.get(answer.topic) || { total: 0, correct: 0 };
    current.total += 1;
    current.correct += answer.isCorrect ? 1 : 0;
    topicStats.set(answer.topic, current);
  });
  const report = $("#topicReport");
  report.innerHTML = "";
  if (!topicStats.size) {
    report.innerHTML = `Topic performance appears after the first submission.`;
    return;
  }
  [...topicStats.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([topic, stats]) => {
      const accuracy = Math.round((stats.correct / stats.total) * 100);
      const row = document.createElement("div");
      row.className = "topic-row";
      row.innerHTML = `<strong>${topic}</strong><div>${accuracy}%</div>`;
      report.appendChild(row);
    });
}

function renderQuestionReport(attempts) {
  const byQuestion = new Map(state.questions.map((question) => [question.id, { ...question, total: 0, correct: 0 }]));
  attempts.flatMap((attempt) => attempt.answers).forEach((answer) => {
    const current = byQuestion.get(answer.questionId);
    if (!current) return;
    current.total += 1;
    current.correct += answer.isCorrect ? 1 : 0;
  });

  const answered = [...byQuestion.values()].filter((question) => question.total > 0);
  const passed = [...answered].sort((a, b) => {
    const aRate = a.correct / a.total;
    const bRate = b.correct / b.total;
    if (bRate !== aRate) return bRate - aRate;
    return b.total - a.total;
  });
  const failed = [...answered].sort((a, b) => {
    const aFail = (a.total - a.correct) / a.total;
    const bFail = (b.total - b.correct) / b.total;
    if (bFail !== aFail) return bFail - aFail;
    return b.total - a.total;
  });

  $("#mostPassedQuestion").textContent = passed[0]
    ? `${passed[0].question} (${Math.round((passed[0].correct / passed[0].total) * 100)}% correct)`
    : "No data yet";
  $("#mostFailedQuestion").textContent = failed[0]
    ? `${failed[0].question} (${Math.round(((failed[0].total - failed[0].correct) / failed[0].total) * 100)}% failed)`
    : "No data yet";

  const rows = $("#questionRows");
  rows.innerHTML = "";
  if (!answered.length) {
    rows.innerHTML = `Question-level performance appears after the first completed quiz.`;
    return;
  }
  answered
    .sort((a, b) => b.total - a.total || b.correct - a.correct)
    .forEach((question) => {
      const accuracy = Math.round((question.correct / question.total) * 100);
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${question.question}</td><td>${question.topic}</td><td>${question.total}</td><td>${question.correct}</td><td>${accuracy}%</td><td>${correctAnswerText(question)}</td>`;
      rows.appendChild(tr);
    });
}

function renderAttemptRows(attempts) {
  const rows = $("#attemptRows");
  rows.innerHTML = "";
  if (!attempts.length) {
    rows.innerHTML = `No submissions yet.`;
    return;
  }
  attempts.forEach((attempt) => {
    const office = attempt.clusterOffice || attempt.team || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${attempt.fullName}</td><td>${office}</td><td>${attempt.score}/5</td><td>${formatSeconds(attempt.completionTime)}</td><td>${new Date(attempt.completedAt).toLocaleString()}</td>`;
    rows.appendChild(tr);
  });
}

function downloadCsv() {
  const attempts = rankedAttempts();
  const header = ["name", "cluster_office", "score", "completion_time", "submitted_at", "questions"];
  const lines = attempts.map((attempt) => [
    attempt.fullName,
    attempt.clusterOffice || attempt.team || "",
    `${attempt.score}/5`,
    attempt.completionTime.toFixed(1),
    attempt.completedAt,
    attempt.answers.map((answer) => `${answer.questionId}:${answer.selectedAnswer || "timeout"}`).join(" | "),
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rcat-trivia-${currentWeekKey()}-report.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  $$("[data-route]").forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });
  $("#copyPublicLink")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(publicQuizUrl());
    $("#copyPublicLink").textContent = "Copied";
    setTimeout(() => ($("#copyPublicLink").textContent = "Copy Public Link"), 1300);
  });

  $("#participantForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const fullName = $("#fullName").value.trim();
    if (alreadySubmitted && alreadySubmitted(fullName)) {
      alert("You have already completed this week's RCAT Quiz.");
      return;
    }
    startQuiz({
      fullName,
      clusterOffice: $("#clusterOffice").value.trim(),
    });
  });

  $("#adminLogin")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if ($("#adminCode").value === CONFIG.adminCode) {
      sessionStorage.setItem("rcatAdmin", "true");
      renderAdmin();
    } else {
      $("#adminCode").setCustomValidity("Use the admin access code.");
      $("#adminCode").reportValidity();
      $("#adminCode").setCustomValidity("");
    }
  });

  $("#downloadCsv")?.addEventListener("click", downloadCsv);
  $("#resetWeek")?.addEventListener("click", () => {
    if (!confirm("Reset this week's participant submissions and generate a new weekly question set?")) return;
    writeAttempts([]);
    writeActiveSessions([]);
    weeklyQuestions(true);
    renderHome();
    renderReports();
  });
}

async function init() {
  const response = await fetch("./questions.json");
  state.questions = await response.json();
  weeklyQuestions();
  bindEvents();
  setRoute(location.hash.replace("#", "") || "home");
}

init().catch((error) => {
  document.body.innerHTML = `Unable to load quiz: ${error.message}`;
});