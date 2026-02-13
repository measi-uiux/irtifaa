let questions = [];
let score = 0;

const TOTAL_QUESTIONS = 25;
const TOTAL_TIME = 600;
const PREP_TIME = 15;

let timer;
let timeLeft = TOTAL_TIME;

let prepTimer;
let prepLeft = PREP_TIME;

let quizStartTs = null;
let quizEnded = false;
let violations = 0;

/* ========================= Utilities ========================= */

function fisherYatesShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleOptionsKeepCorrect(q) {
  const opts = q.options.map((text, idx) => ({ text, idx }));
  fisherYatesShuffle(opts);
  const newOptions = opts.map(o => o.text);
  const newCorrect = opts.findIndex(o => o.idx === q.correct);
  return { ...q, options: newOptions, correct: newCorrect };
}

function formatMMSS(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getElapsedSeconds() {
  if (!quizStartTs) return 0;
  return Math.max(0, Math.floor((Date.now() - quizStartTs) / 1000));
}

/* ========================= UI ========================= */

function setTimerText(text) {
  document.getElementById("timer").textContent = text;
}

function showWarning(message) {
  const box = document.getElementById("warningBox");
  box.style.display = "block";
  box.textContent = message;
  setTimeout(() => (box.style.display = "none"), 3000);
}

function hideOverlayAndUnlock() {
  document.getElementById("startOverlay").style.display = "none";
  document.getElementById("mainContent").classList.remove("blurred");
  document.body.classList.remove("lock-scroll");
  document.getElementById("backBtn")?.remove();
}

/* ========================= Proctoring ========================= */

function registerViolation(reason) {
  if (quizEnded) return;
  violations++;
  if (violations === 1)
    showWarning(`⚠ Warning: ${reason}. Next time quiz will end.`);
  else
    showResult(true, `Rule violated: ${reason}`);
}

async function requestFullscreenStrictFromClick() {
  try { await document.documentElement.requestFullscreen(); } catch {}
}

function attachProctoringListeners() {
  document.addEventListener("visibilitychange", () => {
    if (quizStartTs && document.hidden) registerViolation("Switched tab");
  });
  window.addEventListener("blur", () => {
    if (quizStartTs) registerViolation("Left window");
  });
}

/* ========================= Load Questions ========================= */

fetch("data/round1.json")
  .then(res => res.json())
  .then(data => {
    let picked = data.slice(0, TOTAL_QUESTIONS);
    fisherYatesShuffle(picked);
    picked = picked.map(shuffleOptionsKeepCorrect);
    questions = picked;
    renderAllQuestions();
    initPrepPhase();
  });

/* ========================= Render ========================= */

function renderAllQuestions() {
  let html = `<h3>Answer all ${TOTAL_QUESTIONS} questions</h3>`;
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const q = questions[i];
    html += `
      <div class="question" id="question-${i}">
        <p><strong>Q${i + 1}.</strong> ${q.q}</p>
        ${q.options.map((opt, idx) => `
          <label>
            <input type="radio" name="q${i}" value="${idx}">
            ${opt}
          </label><br>`).join("")}
      </div>`;
  }
  document.getElementById("questionBox").innerHTML = html;
}

/* ========================= Prep Phase ========================= */

function updatePrepTimerUI() {
  document.getElementById("prepTimer").textContent = formatMMSS(prepLeft);
}

function initPrepPhase() {
  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = true;

  prepLeft = PREP_TIME;
  updatePrepTimerUI();

  prepTimer = setInterval(() => {
    prepLeft--;
    updatePrepTimerUI();
    if (prepLeft <= 0) {
      clearInterval(prepTimer);
      startBtn.disabled = false;
      startBtn.onclick = startQuizFromButton;
    }
  }, 1000);
}

/* ========================= Start Quiz ========================= */

async function startQuizFromButton() {
  await requestFullscreenStrictFromClick();
  hideOverlayAndUnlock();

  quizStartTs = Date.now();
  attachProctoringListeners();

  const submitBtn = document.getElementById("submitBtn");

  submitBtn.disabled = false;

  // 🚨 ONLY SUBMIT PIPELINE
  submitBtn.addEventListener("click", attemptSubmit);

  startTimer();
}

/* ========================= Timer ========================= */

function startTimer() {
  timeLeft = TOTAL_TIME;
  updateQuizTimerUI();
  timer = setInterval(() => {
    timeLeft--;
    updateQuizTimerUI();
    if (timeLeft <= 0) showResult(true, "Time up");
  }, 1000);
}

function updateQuizTimerUI() {
  setTimerText(`⏳ Time Left: ${formatMMSS(timeLeft)}`);
}

/* ========================= HARD SUBMIT LOCK ========================= */

function attemptSubmit() {
  if (!enforceAllAnsweredOrScroll()) return;
  showResult(false);
}

function enforceAllAnsweredOrScroll() {
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (!selected) {
      const qEl = document.getElementById(`question-${i}`);
      qEl.scrollIntoView({ behavior: "smooth", block: "center" });
      qEl.style.outline = "3px solid red";
      setTimeout(() => (qEl.style.outline = ""), 2000);
      showWarning(`Answer Question ${i + 1}`);
      return false;
    }
  }
  return true;
}

/* ========================= Result ========================= */

function calculateScore() {
  let s = 0;
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (selected && parseInt(selected.value) === questions[i].correct) s++;
  }
  return s;
}

function showResult(autoSubmitted, reasonText = "") {
  if (quizEnded) return;

  quizEnded = true;
  clearInterval(timer);

  score = calculateScore();
  const taken = formatMMSS(getElapsedSeconds());

  setTimerText(`Completed in: ${taken}`);

  document.getElementById("quizForm").style.display = "none";

  const participant = localStorage.getItem("participantName") || "Unknown";

  document.getElementById("resultBox").innerHTML = `
    <h2>PRELIMS COMPLETED</h2>
    ${reasonText ? `<p><strong>${reasonText}</strong></p>` : ``}
    <p><strong>Team Members:</strong> ${participant}</p>
    <p><strong>Score:</strong> ${score} / ${TOTAL_QUESTIONS}</p>
    <p><strong>Violations:</strong> ${violations}</p>
  `;
}
