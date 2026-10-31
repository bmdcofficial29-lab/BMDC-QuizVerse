/*! BMDC QuizVerse — user interface and game flow. */
(function () {
  "use strict";

  const cfg = window.QUIZVERSE_CONFIG;
  const Game = window.QuizGame;
  const Wheel = window.QuizWheel;
  const I18N = window.QuizI18n;
  const t = I18N.t;
  const tn = I18N.tn;

  // ------------------------------------------------------------------ helpers
  const $ = (sel, scope) => (scope || document).querySelector(sel);

  /** Small safe element builder: text is always set with textContent, never innerHTML. */
  function h(tag, props) {
    const node = document.createElement(tag);
    const p = props || {};
    Object.keys(p).forEach((k) => {
      const v = p[k];
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) kid.forEach((k) => k != null && k !== false && node.append(k));
      else node.append(kid);
    }
    return node;
  }

  // -------------------------------------------------------------------- state
  const state = {
    bank: [],
    bankStatus: "idle", // idle | loading | ready | error
    bankSource: "local",
    bankPromise: null,
    daily: null,
    session: null, // { name, department, difficulty, timerEnabled }  (kept in memory only)
    rotation: 0,
    spinning: false,
    reduceMotion: false,
    round: null,
    screen: "welcome",
  };

  const screens = {
    welcome: $("#screen-welcome"),
    setup: $("#screen-setup"),
    wheel: $("#screen-wheel"),
    challenge: $("#screen-challenge"),
    results: $("#screen-results"),
    error: $("#screen-error"),
  };

  function showScreen(name) {
    state.screen = name;
    Object.keys(screens).forEach((k) => {
      screens[k].hidden = k !== name;
    });
    window.scrollTo(0, 0);
    const target = screens[name].querySelector("[data-focus]");
    if (target) target.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------------- motion
  const motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function applyMotion() {
    document.body.classList.toggle("reduce-motion", state.reduceMotion);
    const btn = $("#btn-motion");
    btn.setAttribute("aria-pressed", String(state.reduceMotion));
    $("#motion-state").textContent = t(state.reduceMotion ? "motion.on" : "motion.off");
  }

  // ------------------------------------------------------------ question bank
  async function fetchJson(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 5000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadBank() {
    state.bankStatus = "loading";
    renderBankStatus();
    let raw = null;
    let source = "local";
    const src = cfg.questionSource || {};
    if (src.remoteUrl) {
      try {
        raw = await fetchJson(src.remoteUrl, src.remoteTimeoutMs);
        source = "remote";
      } catch (e) {
        console.warn("Remote question bank unavailable; using the built-in set.", e && e.message);
      }
    }
    try {
      if (!raw) raw = await fetchJson(src.localUrl || "data/questions.json", 8000);
      const list = Array.isArray(raw) ? raw : raw && raw.questions;
      const result = Game.sanitizeBank(list);
      if (result.rejected.length) console.warn(result.rejected.length + " question(s) were ignored because they were invalid.", result.rejected);
      state.bank = result.valid;
      state.bankSource = source;
      const playable = Game.filterQuestions(state.bank, { allowedStatuses: cfg.allowedApprovalStatuses });
      state.bankStatus = playable.length ? "ready" : "error";
      state.bankEmpty = playable.length === 0;
    } catch (e) {
      console.error("Could not load questions", e);
      state.bankStatus = "error";
      state.bankEmpty = false;
    }
    renderBankStatus();
    return state.bankStatus === "ready";
  }

  function ensureBank() {
    if (state.bankStatus === "ready") return Promise.resolve(true);
    if (!state.bankPromise) {
      state.bankPromise = loadBank().finally(() => {
        state.bankPromise = null;
      });
    }
    return state.bankPromise;
  }

  async function loadDaily() {
    const d = cfg.dailyChallenge || {};
    if (!d.url) return;
    try {
      const data = await fetchJson(d.url, d.timeoutMs);
      const result = Game.sanitizeBank(data && data.questions);
      const playable = result.valid.filter((q) => (cfg.allowedApprovalStatuses || ["approved"]).includes(q.approvalStatus));
      if (playable.length) {
        state.daily = { title: data.title || t("daily.label"), questions: playable };
        $("#btn-daily").hidden = false;
      }
    } catch (e) {
      console.warn("Daily challenge not available.", e && e.message);
    }
  }

  function renderBankStatus() {
    const el = $("#bank-status");
    el.className = "bank-status " + state.bankStatus;
    el.replaceChildren();
    if (state.bankStatus === "loading") {
      el.append(h("span", { class: "spinner", "aria-hidden": "true" }), h("span", { text: t("bank.loading") }));
    } else if (state.bankStatus === "ready") {
      const n = Game.filterQuestions(state.bank, { allowedStatuses: cfg.allowedApprovalStatuses }).length;
      el.append(h("span", { text: "✅ " + tn("bank.ready", n) }));
      if (cfg.questionSource.remoteUrl && state.bankSource === "local") el.append(h("span", { class: "muted", text: " · " + t("bank.remoteFallback") }));
    } else if (state.bankStatus === "error") {
      el.append(
        h("span", { text: "⚠️ " + t(state.bankEmpty ? "bank.empty" : "bank.error") + " " }),
        h("button", { type: "button", class: "link-btn", text: t("bank.retry"), onclick: () => ensureBank() })
      );
    }
  }

  // -------------------------------------------------------------- setup form
  function buildSetupForm() {
    const dept = $("#department");
    dept.append(h("option", { value: "", text: t("setup.deptPlaceholder") }));
    Game.DEPARTMENTS.forEach((d) => dept.append(h("option", { value: d, text: t("dept." + d) })));

    const group = $("#difficulty-options");
    Game.DIFFICULTIES.forEach((d, i) => {
      const id = "difficulty-" + d.toLowerCase();
      group.append(
        h(
          "label",
          { class: "pill", for: id },
          h("input", { type: "radio", name: "difficulty", id: id, value: d }),
          h("span", { text: t("diff." + d) })
        )
      );
    });
    $("#difficulty-help").textContent = t("setup.diffHelp", { easy: cfg.points.Easy, medium: cfg.points.Medium, hard: cfg.points.Hard });

    const timerField = $("#timer-field");
    const timerToggle = $("#timer-toggle");
    timerToggle.checked = !!(cfg.rapidFire && cfg.rapidFire.timerEnabled);
    timerField.hidden = !(cfg.rapidFire && cfg.rapidFire.allowStudentToggle);
  }

  const fieldErrors = {
    name: { input: "#student-name", error: "#name-error" },
    department: { input: "#department", error: "#department-error" },
    difficulty: { input: "#difficulty-options", error: "#difficulty-error" },
  };

  function setFieldError(field, messageKey) {
    const f = fieldErrors[field];
    const err = $(f.error);
    const input = $(f.input);
    if (messageKey) {
      err.textContent = t(messageKey);
      err.hidden = false;
      if (field !== "difficulty") input.setAttribute("aria-invalid", "true");
    } else {
      err.textContent = "";
      err.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }

  function validateSetup() {
    const name = $("#student-name").value.trim();
    const department = $("#department").value;
    const checked = $("#setup-form input[name=difficulty]:checked");
    const difficulty = checked ? checked.value : "";
    const errors = {};
    if (!name) errors.name = "err.nameRequired";
    else if (name.length < 2 || name.length > 30) errors.name = "err.nameLength";
    else if (!Game.isValidName(name)) errors.name = "err.nameChars";
    if (!Game.DEPARTMENTS.includes(department)) errors.department = "err.dept";
    if (!Game.DIFFICULTIES.includes(difficulty)) errors.difficulty = "err.diff";
    return { values: { name, department, difficulty }, errors };
  }

  function onSetupSubmit(e) {
    e.preventDefault();
    const { values, errors } = validateSetup();
    Object.keys(fieldErrors).forEach((f) => setFieldError(f, errors[f]));
    const first = ["name", "department", "difficulty"].find((f) => errors[f]);
    if (first) {
      const target = first === "difficulty" ? $("#difficulty-options input") : $(fieldErrors[first].input);
      target.focus();
      return;
    }
    state.session = {
      name: values.name,
      department: values.department,
      difficulty: values.difficulty,
      timerEnabled: $("#timer-toggle").checked,
    };
    enterWheelScreen();
  }

  // -------------------------------------------------------------------- wheel
  const typeName = (type) => t("type." + type + ".name");

  function buildMainWheel() {
    const wheel = $("#wheel");
    wheel.replaceChildren(
      Wheel.buildSvg({
        types: Game.CHALLENGE_TYPES,
        labelLines: (type) => [t("type." + type + ".l1"), t("type." + type + ".l2")],
      })
    );
    wheel.setAttribute("aria-label", t("wheel.aria", { list: Game.CHALLENGE_TYPES.map(typeName).join(", ") }));
    $("#hero-wheel").replaceChildren(Wheel.buildSvg({ types: Game.CHALLENGE_TYPES }));
  }

  function buildManualList() {
    const list = $("#manual-list");
    list.replaceChildren();
    Game.CHALLENGE_TYPES.forEach((type) => {
      list.append(
        h(
          "button",
          { type: "button", class: "chip-btn", onclick: () => chooseManually(type) },
          h("span", { "aria-hidden": "true", text: Wheel.ICONS[type] + " " }),
          h("span", { text: typeName(type) })
        )
      );
    });
  }

  function enterWheelScreen(opts) {
    const s = state.session;
    $("#wheel-title").textContent = t("wheel.title", { name: s.name });
    $("#session-chip").textContent = t("dept." + s.department) + " · " + t("diff." + s.difficulty);
    resetWheelPanel();
    $("#manual-pick").open = !!(opts && opts.openChooser);
    showScreen("wheel");
  }

  function resetWheelPanel() {
    $("#wheel-result").hidden = true;
    $("#wheel-result").replaceChildren();
    $("#spin-controls").hidden = false;
    setSpinning(false);
  }

  function setSpinning(on) {
    state.spinning = on;
    const btn = $("#btn-spin");
    btn.disabled = on;
    btn.textContent = t(on ? "wheel.spinning" : "wheel.spin");
    btn.setAttribute("aria-busy", String(on));
    $("#manual-list").querySelectorAll("button").forEach((b) => (b.disabled = on));
  }

  async function handleSpin() {
    if (state.spinning || !state.session) return;
    const ready = await ensureBank();
    if (!ready) return showBankError();
    setSpinning(true);
    $("#wheel-result").hidden = true;

    const index = Game.pickSegmentIndex();
    const jitter = (Math.random() - 0.5) * 2 * Game.MAX_JITTER * 0.9;
    const spins = 5 + Math.floor(Math.random() * 3);
    const target = Game.rotationForSegment(index, state.rotation, { spins, jitter });
    const wheel = $("#wheel");

    await Wheel.rotateTo(wheel, target, { durationMs: state.reduceMotion ? 0 : cfg.wheel.spinDurationMs });

    // Guard: the segment visibly under the pointer must be the one the logic selected.
    let seen = Game.segmentAtRotation(Wheel.readAngle(wheel));
    if (seen !== index) {
      console.error("Wheel mismatch: logic chose segment " + index + " but the wheel shows " + seen + ". Snapping.");
      await Wheel.rotateTo(wheel, Game.rotationForSegment(index, 0, { spins: 0, jitter: 0 }), { durationMs: 0 });
      seen = index;
    }
    // Keep the stored angle small so it never grows without bound.
    state.rotation = Wheel.readAngle(wheel);
    await Wheel.rotateTo(wheel, state.rotation, { durationMs: 0 });

    setSpinning(false);
    announceLanding(Game.CHALLENGE_TYPES[index]);
  }

  async function chooseManually(type) {
    if (state.spinning || !state.session) return;
    const ready = await ensureBank();
    if (!ready) return showBankError();
    const index = Game.CHALLENGE_TYPES.indexOf(type);
    state.rotation = Game.rotationForSegment(index, 0, { spins: 0, jitter: 0 }) % 360;
    await Wheel.rotateTo($("#wheel"), state.rotation, { durationMs: 0 });
    announceLanding(type);
  }

  function poolFor(type) {
    const s = state.session;
    return Game.filterQuestions(state.bank, {
      challengeType: type,
      department: s.department,
      difficulty: s.difficulty,
      allowedStatuses: cfg.allowedApprovalStatuses,
    });
  }

  function announceLanding(type) {
    $("#wheel-live").textContent = t("wheel.landed", { challenge: typeName(type) });
    const pool = poolFor(type);
    if (pool.length === 0) renderFallback(type);
    else renderLanded(type, pool);
  }

  function renderLanded(type, pool) {
    const count = Math.min(pool.length, Game.roundSize(type, cfg));
    const hasSample = pool.some((q) => q.approvalStatus !== "approved");
    const panel = $("#wheel-result");
    panel.replaceChildren(
      h("p", { class: "big-emoji pop", "aria-hidden": "true", text: Wheel.ICONS[type] }),
      h("p", { class: "eyebrow", text: t("result.landed") }),
      h("h3", { id: "landed-heading", tabindex: "-1", text: typeName(type) }),
      h("p", { text: t("type." + type + ".desc") }),
      h("p", { class: "meta", text: tn("result.ready", count) }),
      hasSample ? h("p", { class: "fineprint", text: t("result.sampleNote") }) : null,
      h(
        "div",
        { class: "actions wrap" },
        h("button", { type: "button", id: "btn-begin", class: "btn btn-primary btn-lg", text: t("result.begin"), onclick: () => startRound(type) }),
        h("button", { type: "button", class: "btn btn-ghost", text: t("result.spinAgain"), onclick: resetWheelPanel })
      )
    );
    $("#spin-controls").hidden = true;
    panel.hidden = false;
    celebrate();
    $("#btn-begin").focus();
  }

  function renderFallback(type) {
    const s = state.session;
    const alternatives = Game.availableTypes(state.bank, { department: s.department, difficulty: s.difficulty, allowedStatuses: cfg.allowedApprovalStatuses });
    const keys = Object.keys(alternatives);
    const panel = $("#wheel-result");
    panel.replaceChildren(
      h("p", { class: "big-emoji", "aria-hidden": "true", text: "🔎" }),
      h("h3", { id: "fallback-heading", tabindex: "-1", text: t("fallback.title") }),
      h("p", {
        text: t("fallback.body", { challenge: typeName(type), department: t("dept." + s.department), difficulty: t("diff." + s.difficulty) }),
      }),
      keys.length
        ? h(
            "div",
            null,
            h("p", { class: "help", text: t("fallback.alternatives") }),
            h(
              "div",
              { class: "chip-grid" },
              keys.map((k) =>
                h(
                  "button",
                  { type: "button", class: "chip-btn", onclick: () => chooseManually(k) },
                  h("span", { "aria-hidden": "true", text: Wheel.ICONS[k] + " " }),
                  h("span", { text: t("fallback.altItem", { name: typeName(k), count: alternatives[k] }) })
                )
              )
            )
          )
        : h("p", { text: t("fallback.none") }),
      h(
        "div",
        { class: "actions wrap" },
        h("button", { type: "button", id: "btn-fallback-spin", class: "btn btn-primary", text: t("fallback.spinAgain"), onclick: resetWheelPanel }),
        h("button", { type: "button", class: "btn btn-ghost", text: t("wheel.change"), onclick: () => showScreen("setup") })
      )
    );
    $("#spin-controls").hidden = true;
    panel.hidden = false;
    $("#fallback-heading").focus();
  }

  function showBankError() {
    $("#error-message").textContent = t(state.bankEmpty ? "bank.empty" : "bank.error");
    showScreen("error");
  }

  // ---------------------------------------------------------------- challenge
  function startRound(type, preset) {
    const pool = preset ? preset.questions : poolFor(type);
    const size = preset ? pool.length : Game.roundSize(type, cfg);
    const picked = Game.selectRound(pool, size).map((q) => Game.prepareQuestion(q));
    if (!picked.length) return renderFallback(type);
    const timerDefault = !!(cfg.rapidFire && cfg.rapidFire.timerEnabled);
    state.round = {
      type: preset ? "daily" : type,
      label: preset ? t("daily.label") : typeName(type),
      department: preset ? null : state.session.department,
      difficulty: preset ? null : state.session.difficulty,
      timerEnabled: state.session ? state.session.timerEnabled : timerDefault,
      questions: picked,
      index: 0,
      results: [],
      activeMs: 0,
      shownAt: 0,
      answered: false,
      timer: null,
    };
    showScreen("challenge");
    renderQuestion();
  }

  function startDaily() {
    if (!state.daily) return;
    startRound("daily", state.daily);
  }

  function renderQuestion() {
    const r = state.round;
    const q = r.questions[r.index];
    r.answered = false;
    stopTimer();

    $("#challenge-kind").textContent = r.type === "daily" ? r.label + " · " + typeName(q.challengeType) : r.label;
    $("#progress-text").textContent = t("challenge.progress", { current: r.index + 1, total: r.questions.length });
    const bar = $("#progress");
    bar.setAttribute("aria-valuemax", String(r.questions.length));
    bar.setAttribute("aria-valuenow", String(r.index + 1));
    $("#progress-bar").style.width = Math.round(((r.index + 1) / r.questions.length) * 100) + "%";
    $("#score-chip").textContent = t("challenge.score", { correct: r.results.filter((x) => x.correct).length });

    const badge = $("#sample-badge");
    badge.hidden = q.approvalStatus === "approved";
    badge.textContent = t("badge.sample");

    $("#question-text").textContent = q.question;

    const fig = $("#question-figure");
    const img = $("#question-image");
    if (q.challengeType === "identify_image" && q.image) {
      img.src = q.image;
      img.alt = q.imageAlt || "";
      fig.hidden = false;
    } else {
      img.removeAttribute("src");
      img.alt = "";
      fig.hidden = true;
    }

    const fb = $("#feedback");
    fb.hidden = true;
    fb.replaceChildren();
    $("#btn-next").hidden = true;

    const area = $("#answer-area");
    area.replaceChildren();
    RENDERERS[q.challengeType](q, area);

    r.shownAt = performance.now();
    if (q.challengeType === "rapid_fire" && r.timerEnabled) startTimer();
    $("#question-text").focus({ preventScroll: true });
  }

  // ---- timer (Rapid Fire only) ----
  function startTimer() {
    const r = state.round;
    const total = (cfg.rapidFire.secondsPerQuestion || 15) * 1000;
    const end = performance.now() + total;
    const box = $("#timer");
    box.hidden = false;
    const tick = () => {
      const left = Math.max(0, end - performance.now());
      $("#timer-text").textContent = t("challenge.timer", { seconds: Math.ceil(left / 1000) });
      $("#timer-fill").style.transform = "scaleX(" + (left / total).toFixed(3) + ")";
      box.classList.toggle("urgent", left <= 5000);
      if (left <= 0) {
        stopTimer();
        if (!r.answered && r.timeoutHandler) r.timeoutHandler();
      }
    };
    tick();
    r.timer = setInterval(tick, 100);
  }

  function stopTimer() {
    const r = state.round;
    if (r && r.timer) {
      clearInterval(r.timer);
      r.timer = null;
    }
    $("#timer").hidden = true;
  }

  // ---- recording and feedback ----
  function settle(q, outcome) {
    const r = state.round;
    if (r.answered) return;
    r.answered = true;
    r.timeoutHandler = null;
    stopTimer();
    r.activeMs += performance.now() - r.shownAt;
    r.results.push({
      id: q.id,
      question: q.question,
      challengeType: q.challengeType,
      difficulty: q.difficulty,
      points: q.points,
      correct: !!outcome.correct,
      timedOut: !!outcome.timedOut,
      userAnswer: outcome.userAnswer,
      correctAnswer: outcome.correctAnswer,
      explanation: q.explanation,
    });
    $("#score-chip").textContent = t("challenge.score", { correct: r.results.filter((x) => x.correct).length });
    showFeedback(q, outcome);
  }

  function showFeedback(q, outcome) {
    const r = state.round;
    const fb = $("#feedback");
    const kind = outcome.correct ? "ok" : outcome.timedOut ? "late" : "bad";
    const title = outcome.correct ? t("challenge.correct") : outcome.timedOut ? t("challenge.timeUp") : t("challenge.incorrect");
    const icon = outcome.correct ? "✅" : outcome.timedOut ? "⏰" : "❌";
    fb.className = "feedback " + kind;
    // replaceChildren() turns null into the text "null", so drop empty entries first.
    fb.replaceChildren(
      ...[
        h("p", { class: "feedback-title" }, h("span", { "aria-hidden": "true", text: icon + " " }), h("span", { text: title })),
        outcome.nearMiss ? h("p", { text: t("challenge.nearMiss", { answer: outcome.correctAnswer }) }) : null,
        !outcome.correct ? h("p", null, h("strong", { text: t("challenge.correctAnswerIs") + " " }), h("span", { text: outcome.correctAnswer })) : null,
        h("p", null, h("strong", { text: t("challenge.why") + " " }), h("span", { text: q.explanation })),
      ].filter(Boolean)
    );
    fb.hidden = false;
    const next = $("#btn-next");
    const last = r.index + 1 >= r.questions.length;
    next.textContent = t(last ? "challenge.seeResults" : "challenge.next");
    next.hidden = false;
    fb.focus({ preventScroll: true });
    fb.scrollIntoView({ block: "nearest", behavior: state.reduceMotion ? "auto" : "smooth" });
  }

  function onNext() {
    const r = state.round;
    if (!r || !r.answered) return;
    if (r.index + 1 >= r.questions.length) finishRound();
    else {
      r.index += 1;
      renderQuestion();
    }
  }

  const answerLabel = (q, value) => (q.challengeType === "true_false" ? t(value ? "true.label" : "false.label") : String(value));

  // ---- renderers, one per challenge type ----
  function renderChoices(q, area) {
    const list = h("div", { class: "choices", role: "group", "aria-label": t("challenge.choicesLabel") });
    const buttons = [];
    function lock(pickedBtn, timedOut) {
      buttons.forEach((b) => {
        b.disabled = true;
        const isCorrect = b.dataset.value === q.correctAnswer;
        if (isCorrect) {
          b.classList.add("correct");
          b.querySelector(".choice-mark").textContent = "✓";
          b.append(h("span", { class: "sr-only", text: " " + t("challenge.srCorrect") }));
        } else if (b === pickedBtn) {
          b.classList.add("wrong");
          b.querySelector(".choice-mark").textContent = "✗";
          b.append(h("span", { class: "sr-only", text: " " + t("challenge.srWrong") }));
        }
      });
      const picked = pickedBtn ? pickedBtn.dataset.value : null;
      const res = picked == null ? { correct: false } : Game.checkAnswer(q, picked);
      settle(q, {
        correct: res.correct,
        timedOut: !!timedOut,
        userAnswer: picked == null ? t("challenge.noAnswer") : picked,
        correctAnswer: q.correctAnswer,
      });
    }
    q.options.forEach((opt, i) => {
      const b = h(
        "button",
        { type: "button", class: "choice", "data-value": opt, onclick: () => !state.round.answered && lock(b, false) },
        h("span", { class: "choice-key", "aria-hidden": "true", text: String.fromCharCode(65 + i) }),
        h("span", { class: "choice-text", text: opt }),
        h("span", { class: "choice-mark", "aria-hidden": "true" })
      );
      buttons.push(b);
      list.append(b);
    });
    area.append(list);
    state.round.timeoutHandler = () => lock(null, true);
  }

  function renderTrueFalse(q, area) {
    const list = h("div", { class: "choices tf", role: "group", "aria-label": t("challenge.choicesLabel") });
    const buttons = [];
    [true, false].forEach((val) => {
      const b = h(
        "button",
        {
          type: "button",
          class: "choice tf-btn " + (val ? "tf-true" : "tf-false"),
          onclick: () => {
            if (state.round.answered) return;
            buttons.forEach((x) => (x.disabled = true));
            const res = Game.checkAnswer(q, val);
            buttons.forEach((x) => {
              const xv = x.dataset.value === "true";
              if (xv === q.correctAnswer) {
                x.classList.add("correct");
                x.querySelector(".choice-mark").textContent = "✓";
                x.append(h("span", { class: "sr-only", text: " " + t("challenge.srCorrect") }));
              } else if (x === b) {
                x.classList.add("wrong");
                x.querySelector(".choice-mark").textContent = "✗";
                x.append(h("span", { class: "sr-only", text: " " + t("challenge.srWrong") }));
              }
            });
            settle(q, { correct: res.correct, userAnswer: answerLabel(q, val), correctAnswer: answerLabel(q, q.correctAnswer) });
          },
          "data-value": String(val),
        },
        h("span", { class: "choice-text", text: t(val ? "challenge.true" : "challenge.false") }),
        h("span", { class: "choice-mark", "aria-hidden": "true" })
      );
      buttons.push(b);
      list.append(b);
    });
    area.append(list);
  }

  function renderFill(q, area) {
    const msg = h("p", { class: "error", role: "alert", hidden: true });
    const input = h("input", {
      id: "fill-input",
      type: "text",
      class: "fill-input",
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false",
      maxlength: "80",
      placeholder: t("challenge.fillPlaceholder"),
      "aria-label": t("challenge.fillLabel"),
    });
    const check = h("button", { type: "submit", class: "btn btn-primary", text: t("challenge.check") });
    const skip = h("button", { type: "button", class: "btn btn-ghost", text: t("challenge.dontKnow") });
    function finish(value, res) {
      input.disabled = check.disabled = skip.disabled = true;
      settle(q, {
        correct: !!res.correct,
        nearMiss: !!res.nearMiss,
        userAnswer: value || t("challenge.noAnswer"),
        correctAnswer: q.correctAnswer,
      });
    }
    const form = h(
      "form",
      {
        class: "fill-form",
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          if (state.round.answered) return;
          const value = input.value;
          const res = Game.checkAnswer(q, value, { typoTolerance: cfg.fillTypoTolerance });
          if (res.empty) {
            msg.textContent = t("challenge.fillEmpty");
            msg.hidden = false;
            input.focus();
            return;
          }
          finish(value.trim(), res);
        },
      },
      input,
      msg,
      h("div", { class: "actions wrap" }, check, skip)
    );
    skip.addEventListener("click", () => !state.round.answered && finish("", { correct: false }));
    area.append(form);
  }

  function renderMatch(q, area) {
    const total = q.pairs.length;
    let selLeft = null;
    let selRight = null;
    let mistakes = 0;
    const matched = {}; // left text -> pair number
    const live = h("p", { class: "match-live", role: "status", "aria-live": "polite" });
    const mistakeEl = h("p", { class: "match-mistakes", text: tn("challenge.matchMistakes", 0) });

    function paint(btn, pairNo) {
      btn.disabled = true;
      btn.classList.add("matched", "pair-" + ((pairNo - 1) % 6));
      btn.setAttribute("aria-pressed", "false");
      btn.append(h("span", { class: "pair-badge", text: String(pairNo), "aria-hidden": "true" }), h("span", { class: "sr-only", text: " " + t("challenge.matchPairNumber", { n: pairNo }) }));
    }
    function clearSelection() {
      [selLeft, selRight].forEach((b) => {
        if (!b) return;
        b.setAttribute("aria-pressed", "false");
        b.classList.remove("selected");
      });
      selLeft = selRight = null;
    }
    function attempt() {
      const left = selLeft.dataset.value;
      const right = selRight.dataset.value;
      if (Game.checkMatchPair(q, left, right)) {
        const no = Object.keys(matched).length + 1;
        matched[left] = no;
        paint(selLeft, no);
        paint(selRight, no);
        clearSelection();
        live.textContent = t("challenge.matchYes");
        if (no === total) finishBoard();
      } else {
        mistakes += 1;
        mistakeEl.textContent = tn("challenge.matchMistakes", mistakes);
        live.textContent = t("challenge.matchNo");
        const a = selLeft;
        const b = selRight;
        a.classList.add("shake");
        b.classList.add("shake");
        clearSelection();
        setTimeout(() => {
          a.classList.remove("shake");
          b.classList.remove("shake");
        }, 450);
      }
    }
    function pick(side, btn) {
      if (state.round.answered || btn.disabled) return;
      const current = side === "left" ? selLeft : selRight;
      if (current === btn) {
        btn.setAttribute("aria-pressed", "false");
        btn.classList.remove("selected");
        if (side === "left") selLeft = null;
        else selRight = null;
        return;
      }
      if (current) {
        current.setAttribute("aria-pressed", "false");
        current.classList.remove("selected");
      }
      btn.setAttribute("aria-pressed", "true");
      btn.classList.add("selected");
      if (side === "left") selLeft = btn;
      else selRight = btn;
      if (selLeft && selRight) attempt();
    }
    function finishBoard() {
      const ok = Game.matchBoardCorrect(mistakes);
      settle(q, {
        correct: ok,
        userAnswer: ok ? t("challenge.matchSummaryClean") : t("challenge.matchSummaryMistakes", { mistakes }),
        correctAnswer: q.pairs.map((p) => p.left + " → " + p.right).join("; "),
      });
    }
    function column(side, items, label) {
      return h(
        "div",
        { class: "match-col" },
        h("p", { class: "match-col-title", text: label }),
        h(
          "ul",
          { class: "match-list" },
          items.map((text) => {
            const btn = h("button", { type: "button", class: "match-item", "data-value": text, "aria-pressed": "false", onclick: () => pick(side, btn) }, h("span", { class: "match-text", text }));
            return h("li", null, btn);
          })
        )
      );
    }
    area.append(
      h("p", { class: "help", text: t("challenge.matchHint") }),
      h("div", { class: "match-board" }, column("left", q.leftColumn, t("challenge.matchLeft")), column("right", q.rightColumn, t("challenge.matchRight"))),
      mistakeEl,
      live
    );
  }

  const RENDERERS = {
    mcq: renderChoices,
    rapid_fire: renderChoices,
    terminology: renderChoices,
    brain_teaser: renderChoices,
    identify_image: renderChoices,
    true_false: renderTrueFalse,
    fill_blank: renderFill,
    match_pairs: renderMatch,
  };

  // ------------------------------------------------------------------ results
  function finishRound() {
    stopTimer();
    const r = state.round;
    const sum = Game.summarizeRound(r.results, cfg);
    r.summary = sum;

    $("#results-kind").textContent = r.label;
    $("#score-percent").textContent = sum.percentage + "%";
    $("#score-fraction").textContent = sum.correct + " / " + sum.total;
    $("#results-message").textContent = t("msg." + Game.motivationKey(sum.percentage));

    const stats = $("#results-stats");
    stats.replaceChildren();
    const addStat = (label, value) => stats.append(h("div", { class: "stat" }, h("dt", { text: label }), h("dd", { text: value })));
    addStat(t("results.correct"), String(sum.correct));
    addStat(t("results.incorrect"), String(sum.incorrect));
    if (cfg.showTimeTaken) addStat(t("results.time"), Game.formatDuration(r.activeMs));
    addStat(t("results.points"), String(sum.points));

    const list = $("#review-list");
    list.replaceChildren();
    r.results.forEach((res, i) => {
      const status = res.correct ? "results.statusCorrect" : res.timedOut ? "results.statusTimeout" : "results.statusWrong";
      const icon = res.correct ? "✅" : res.timedOut ? "⏰" : "❌";
      const d = h(
        "details",
        { class: "review-item " + (res.correct ? "ok" : "bad"), open: !res.correct },
        h(
          "summary",
          null,
          h("span", { "aria-hidden": "true", text: icon + " " }),
          h("span", { class: "sr-only", text: t(status) + ": " }),
          h("span", { text: i + 1 + ". " + res.question })
        ),
        h("p", null, h("strong", { text: t("results.yourAnswer") + ": " }), h("span", { text: String(res.userAnswer) })),
        h("p", null, h("strong", { text: t("results.correctAnswer") + ": " }), h("span", { text: String(res.correctAnswer) })),
        h("p", null, h("strong", { text: t("results.explanation") + ": " }), h("span", { text: res.explanation }))
      );
      list.append(d);
    });

    showScreen("results");
    if (sum.percentage >= 70) celebrate();
    reportUsage(sum, r);
  }

  function reportUsage(sum, round) {
    const u = cfg.usageReporting;
    if (!u || !u.enabled || !u.endpointUrl) return;
    try {
      fetch(u.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Game.buildUsagePayload(sum, round)),
        keepalive: true,
        credentials: "omit",
      }).catch(() => {});
    } catch (e) {
      /* reporting is best-effort and must never disturb the student */
    }
  }

  // ------------------------------------------------------------ celebrations
  function celebrate() {
    if (state.reduceMotion) return;
    const layer = $("#confetti");
    const colors = ["#7c3aed", "#22d3ee", "#2dd4bf", "#fb923c", "#fde047", "#db2777"];
    layer.replaceChildren();
    for (let i = 0; i < 32; i++) {
      const piece = h("i", { class: "confetti-piece" });
      piece.style.left = Math.round(Math.random() * 100) + "%";
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.6).toFixed(2) + "s";
      piece.style.animationDuration = (1.8 + Math.random() * 1.4).toFixed(2) + "s";
      layer.append(piece);
    }
    setTimeout(() => layer.replaceChildren(), 3600);
  }

  // --------------------------------------------------------------- navigation
  function goHome() {
    stopTimer();
    state.round = null;
    state.session = null; // the student's name is forgotten when they go Home
    $("#setup-form").reset();
    $("#timer-toggle").checked = !!(cfg.rapidFire && cfg.rapidFire.timerEnabled);
    Object.keys(fieldErrors).forEach((f) => setFieldError(f, null));
    showScreen("welcome");
  }

  function needSession(next) {
    if (state.session) return next();
    showScreen("setup");
  }

  function bindEvents() {
    $("#btn-start").addEventListener("click", async () => {
      showScreen("setup");
      ensureBank();
    });
    $("#btn-daily").addEventListener("click", startDaily);
    $("#btn-setup-back").addEventListener("click", () => showScreen("welcome"));
    $("#setup-form").addEventListener("submit", onSetupSubmit);
    $("#student-name").addEventListener("input", () => setFieldError("name", null));
    $("#department").addEventListener("change", () => setFieldError("department", null));
    $("#difficulty-options").addEventListener("change", () => setFieldError("difficulty", null));

    $("#btn-spin").addEventListener("click", handleSpin);
    $("#btn-change-setup").addEventListener("click", () => showScreen("setup"));
    $("#btn-next").addEventListener("click", onNext);

    $("#btn-spin-again").addEventListener("click", () => needSession(() => enterWheelScreen()));
    $("#btn-another").addEventListener("click", () => needSession(() => enterWheelScreen({ openChooser: true })));
    $("#btn-home").addEventListener("click", goHome);

    $("#btn-error-retry").addEventListener("click", async () => {
      const ok = await ensureBank();
      if (ok) showScreen(state.session ? "wheel" : "welcome");
    });
    $("#btn-error-home").addEventListener("click", goHome);

    $("#brand-home").addEventListener("click", () => {
      if (state.screen === "welcome") return;
      if (state.screen === "challenge" && state.round && state.round.results.length < state.round.questions.length) {
        if (!window.confirm(t("confirm.leave"))) return;
      }
      goHome();
    });

    $("#btn-motion").addEventListener("click", () => {
      state.reduceMotion = !state.reduceMotion;
      applyMotion();
    });
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener("change", (e) => {
        state.reduceMotion = e.matches;
        applyMotion();
      });
    }
  }

  // --------------------------------------------------------------------- init
  function init() {
    I18N.setLanguage(cfg.language);
    I18N.apply();
    state.reduceMotion = !!motionQuery.matches;
    applyMotion();
    buildSetupForm();
    buildMainWheel();
    buildManualList();
    bindEvents();
    showScreen("welcome");
    ensureBank();
    loadDaily();
    window.__QuizVerse = { state, version: "0.1.0" }; // read-only handle used by automated tests
  }

  init();
})();
