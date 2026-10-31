/*
 * BMDC QuizVerse — integration & game configuration.
 *
 * This file is public (it is downloaded by every student's browser).
 * NEVER put passwords, API keys, tokens or webhook secrets here.
 * Anything that needs a secret belongs inside n8n credentials, not in the browser.
 */
window.QUIZVERSE_CONFIG = {
  // Public address where the app is hosted. Fill this in after deployment;
  // it is only used for display/QR instructions, nothing breaks while it is empty.
  publicAppUrl: "",

  language: "en", // add "ur" in js/strings.js later (the layout already supports RTL)

  // ---- Round settings -------------------------------------------------------
  questionsPerRound: 5,
  // Per-challenge overrides. A Match the Pairs "question" is a whole board of pairs,
  // so a round uses fewer boards.
  questionsPerRoundByType: { match_pairs: 2 },

  // ---- Points (per correct answer) -----------------------------------------
  points: { Easy: 10, Medium: 20, Hard: 30 },
  useQuestionPoints: false, // true = use each question's own "points" field instead

  // ---- Rapid Fire timer -----------------------------------------------------
  rapidFire: {
    timerEnabled: true, // default for the "use timer" checkbox on the setup form
    allowStudentToggle: true, // show the checkbox so students can switch it off
    secondsPerQuestion: 15,
  },

  showTimeTaken: true,
  fillTypoTolerance: true, // accept one-letter typos in longer Fill in the Blanks answers

  // ---- Which questions may be played ---------------------------------------
  // "approved" = reviewed by faculty. "sample" = demonstration content shipped with
  // the prototype. For a real launch set this to ["approved"] ONLY.
  allowedApprovalStatuses: ["approved", "sample"],

  // ---- Question bank source -------------------------------------------------
  questionSource: {
    localUrl: "data/questions.json", // always used as the fallback
    remoteUrl: "", // optional: HTTPS URL of a published, approved question bank (JSON)
    remoteTimeoutMs: 4000,
  },

  // ---- Optional daily challenge published by n8n Workflow A ----------------
  // Leave empty to hide the Daily Challenge button.
  dailyChallenge: {
    url: "", // HTTPS URL returning { date, title, questions: [...] }
    timeoutMs: 4000,
  },

  // ---- Optional anonymous aggregate reporting (OFF by default) -------------
  // Only anonymous counts are ever sent (no names). Keep disabled until
  // management has approved it and an endpoint exists.
  usageReporting: {
    enabled: false,
    endpointUrl: "",
  },

  wheel: {
    spinDurationMs: 4800,
  },
};
