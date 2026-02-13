let questions = [];
let score = 0;

const TOTAL_QUESTIONS = 25;
const TOTAL_TIME = 600;   // 10 minutes quiz time
const PREP_TIME = 15;     // 15 secs instructions time

let timer;
let timeLeft = TOTAL_TIME;

let prepTimer;
let prepLeft = PREP_TIME;

let quizStartTs = null;
let quizEnded = false;

let violations = 0;       // warning mode: 1st warning, 2nd auto-submit

/* =========================
   Utilities
   ========================= */

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

/* =========================
   UI helpers
   ========================= */

function setTimerText(text) {
  const t = document.getElementById("timer");
  if (t) t.textContent = text;
}

function showWarning(message) {
  const box = document.getElementById("warningBox");
  if (!box) {
    alert(message);
    return;
  }
  box.style.display = "block";
  box.textContent = message;

  clearTimeout(showWarning._t);
  showWarning._t = setTimeout(() => {
    box.style.display = "none";
  }, 2500);
}

function hideOverlayAndUnlock() {
  const overlay = document.getElementById("startOverlay");
  if (overlay) overlay.style.display = "none";

  const main = document.getElementById("mainContent");
  if (main) main.classList.remove("blurred");

  document.body.classList.remove("lock-scroll");

  // hide back button once quiz starts
  const backBtn = document.getElementById("backBtn");
  if (backBtn) backBtn.style.display = "none";
}

/* =========================
   Proctoring / Fullscreen
   ========================= */

function registerViolation(reason) {
  if (quizEnded) return;

  violations += 1;

  if (violations === 1) {
    showWarning(`⚠ Warning: ${reason}. Next time the quiz will end.`);
  } else {
    showResult(true, `Rule violated: ${reason}`);
  }
}

async function requestFullscreenStrictFromClick() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (e) {
    console.warn("Fullscreen request failed:", e);
    showWarning("⚠ Fullscreen could not be enabled in this browser.");
  }
}

function isFullscreenNow() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function attachProctoringListeners() {
  document.addEventListener("fullscreenchange", () => {
    if (quizEnded) return;
    if (!quizStartTs) return;
    if (!isFullscreenNow()) registerViolation("Exited fullscreen");
  });

  document.addEventListener("webkitfullscreenchange", () => {
    if (quizEnded) return;
    if (!quizStartTs) return;
    if (!isFullscreenNow()) registerViolation("Exited fullscreen");
  });

  document.addEventListener("visibilitychange", () => {
    if (quizEnded) return;
    if (!quizStartTs) return;
    if (document.hidden) registerViolation("Switched tab or minimized the window");
  });

  window.addEventListener("blur", () => {
    if (quizEnded) return;
    if (!quizStartTs) return;
    registerViolation("Left the quiz window");
  });

  window.addEventListener("beforeunload", (e) => {
    if (quizEnded) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

/* =========================
   Load + Prepare Questions
   ========================= */

fetch("data/round1.json")
  .then((res) => res.json())
  .then((data) => {
    let picked = data.slice(0, TOTAL_QUESTIONS);

    // shuffle questions per user
    fisherYatesShuffle(picked);

    // shuffle options per question (fix correct index)
    picked = picked.map(shuffleOptionsKeepCorrect);

    questions = picked;

    renderAllQuestions();
    initPrepPhase();
  })
  .catch((err) => {
    console.error("Failed to load questions:", err);
    const qb = document.getElementById("questionBox");
    if (qb) qb.innerHTML = "<p>Failed to load questions. Please try again.</p>";
  });

/* =========================
   Render
   ========================= */

function renderAllQuestions() {
  let html = `<h3>Answer all ${TOTAL_QUESTIONS} questions</h3>`;

  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const q = questions[i];
    html += `
      <div class="question">
        <p><strong>Q${i + 1}.</strong> ${q.q}</p>
        ${q.options.map((opt, idx) => `
          <label>
            <input type="radio" name="q${i}" value="${idx}">
            ${opt}
          </label>
        `).join("")}
      </div>
    `;
  }

  const qb = document.getElementById("questionBox");
  if (qb) qb.innerHTML = html;
}

/* =========================
   Prep Phase (1 minute)
   ========================= */

function updatePrepTimerUI() {
  const el = document.getElementById("prepTimer");
  if (el) el.textContent = formatMMSS(prepLeft);
}

function initPrepPhase() {
  // Lock submit until quiz starts
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("locked");
    submitBtn.onclick = () => showResult(false);
  }

  // Keep timer area empty during instructions
  setTimerText("");

  // Ensure start button exists and is disabled initially
  const startBtn = document.getElementById("startBtn");
  const hint = document.getElementById("gestureHint");

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.classList.add("locked");
    startBtn.onclick = null; // will be set when unlocked
  }

  // Start 1-minute countdown
  prepLeft = PREP_TIME;
  updatePrepTimerUI();

  clearInterval(prepTimer);
  prepTimer = setInterval(() => {
    prepLeft--;
    updatePrepTimerUI();

    if (prepLeft <= 0) {
      clearInterval(prepTimer);

      // Unlock the start button now
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.classList.remove("locked");
        startBtn.textContent = "Start Quiz";
        startBtn.onclick = () => startQuizFromButton();
      }

      if (hint) {
        hint.textContent = "✅ Start button unlocked. Click Start to begin the quiz in fullscreen.";
      }
    }
  }, 1000);
}

async function startQuizFromButton() {
  if (quizEnded) return;
  if (quizStartTs) return; // already started

  // Request fullscreen INSIDE this click handler (browser allows)
  await requestFullscreenStrictFromClick();

  // Close overlay + unlock background (no scroll, no peeking before this)
  hideOverlayAndUnlock();

  // Start timestamp (for completed-in metric)
  quizStartTs = Date.now();

  // Enable proctoring now
  attachProctoringListeners();

  // Enable submit now
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.classList.remove("locked");
    submitBtn.onclick = () => showResult(false);
  }

  // Start quiz timer
  startTimer();
}

/* =========================
   Quiz Timer (10 min)
   ========================= */

function startTimer() {
  clearInterval(timer);
  timeLeft = TOTAL_TIME;
  updateQuizTimerUI();

  timer = setInterval(() => {
    timeLeft--;
    updateQuizTimerUI();

    if (timeLeft <= 0) {
      clearInterval(timer);
      showResult(true, "Time up");
    }
  }, 1000);
}

function updateQuizTimerUI() {
  setTimerText(`⏳ Time Left: ${formatMMSS(timeLeft)}`);
}

/* =========================
   Submit / Score / Result
   ========================= */

function calculateScore() {
  let s = 0;
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    if (selected && parseInt(selected.value, 10) === questions[i].correct) s++;
  }
  return s;
}

function showResult(autoSubmitted, reasonText = "") {
  if (quizEnded) return;
  quizEnded = true;

  clearInterval(timer);
  clearInterval(prepTimer);

  score = calculateScore();

  const elapsed = getElapsedSeconds();
  const taken = formatMMSS(elapsed);

  // Replace top timer with completion time
  setTimerText(`✅ Completed in: ${taken} (mm:ss)`);

  // Hide quiz UI
  const quizForm = document.getElementById("quizForm");
  if (quizForm) quizForm.style.display = "none";

  const resultBox = document.getElementById("resultBox");
  if (resultBox) {
    resultBox.style.display = "block";
    const participant = localStorage.getItem("participantName") || "Unknown";

    resultBox.innerHTML = `
      <h2>PRELIMS COMPLETED</h2>
      ${autoSubmitted ? `<p><strong>Auto-submitted.</strong></p>` : ``}
      ${reasonText ? `<p><strong>${reasonText}</strong></p>` : ``}
      <p><strong>Team Members:</strong> ${participant}</p>
      <p><strong>Score:</strong> ${score} / ${TOTAL_QUESTIONS}</p>
      <p style="margin-top:12px;color:#6f1414;"><strong>Violations:</strong> ${violations}</p>
    `;
  }

  localStorage.setItem("round1Completed", "true");
  localStorage.setItem("round1Score", String(score));
  localStorage.setItem("round1TimeTaken", taken);

  // Exit fullscreen (optional)
  try {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (_) {}
}
