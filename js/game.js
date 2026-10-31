/*! BMDC QuizVerse — game logic. Pure functions only: no DOM, no network.
 *  Loaded in the browser as window.QuizGame and in Node (tests) via require(). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QuizGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Order matters: index i is wheel segment i (clockwise from the top).
  const CHALLENGE_TYPES = [
    "mcq",
    "fill_blank",
    "true_false",
    "identify_image",
    "match_pairs",
    "rapid_fire",
    "terminology",
    "brain_teaser",
  ];
  const DEPARTMENTS = ["Nursing", "Audiology", "Pharmacy", "DPT", "Optometry", "General Knowledge"];
  const DIFFICULTIES = ["Easy", "Medium", "Hard"];
  const APPROVAL_STATUSES = ["draft", "sample", "approved"];
  const CHOICE_TYPES = ["mcq", "rapid_fire", "terminology", "brain_teaser", "identify_image"];

  const SEGMENT_COUNT = CHALLENGE_TYPES.length;
  const SEGMENT_ANGLE = 360 / SEGMENT_COUNT;
  const MAX_JITTER = SEGMENT_ANGLE * 0.4; // keeps the pointer clear of segment borders

  const IMAGE_PATH = /^assets\/images\/[A-Za-z0-9_\-./]+\.(svg|png|jpe?g|webp)$/;
  const ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
  const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,29}$/u;

  const mod = (n, m) => ((n % m) + m) % m;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // ---------------------------------------------------------------- the wheel
  function pickSegmentIndex(rng) {
    const r = (rng || Math.random)();
    return clamp(Math.floor(r * SEGMENT_COUNT), 0, SEGMENT_COUNT - 1);
  }

  /** Total rotation (degrees, clockwise) that leaves segment `index` under the top pointer. */
  function rotationForSegment(index, currentRotation, opts) {
    const o = opts || {};
    const spins = o.spins == null ? 5 : o.spins;
    const jitter = clamp(o.jitter || 0, -MAX_JITTER, MAX_JITTER);
    const centre = index * SEGMENT_ANGLE + SEGMENT_ANGLE / 2 + jitter;
    const wanted = mod(360 - centre, 360);
    const delta = mod(wanted - mod(currentRotation, 360), 360);
    return currentRotation + spins * 360 + delta;
  }

  /** Which segment is under the top pointer for a given wheel rotation. */
  function segmentAtRotation(rotation) {
    const underPointer = mod(360 - mod(rotation, 360), 360);
    return clamp(Math.floor(underPointer / SEGMENT_ANGLE), 0, SEGMENT_COUNT - 1);
  }

  // ----------------------------------------------------------- random helpers
  function shuffle(list, rng) {
    const r = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------------------------------------------------------- name validation
  function isValidName(name) {
    return typeof name === "string" && NAME_PATTERN.test(name.trim());
  }

  // -------------------------------------------------------- question bank
  function validateQuestion(q) {
    const errors = [];
    if (!q || typeof q !== "object") return ["not an object"];
    const str = (v) => typeof v === "string" && v.trim().length > 0;

    if (!str(q.id) || !ID_PATTERN.test(q.id)) errors.push("id missing or malformed");
    if (!DEPARTMENTS.includes(q.department)) errors.push("unknown department");
    if (!str(q.topic)) errors.push("topic missing");
    if (!DIFFICULTIES.includes(q.difficulty)) errors.push("unknown difficulty");
    if (!CHALLENGE_TYPES.includes(q.challengeType)) errors.push("unknown challengeType");
    if (!str(q.question) || q.question.length > 500) errors.push("question missing or too long");
    if (!str(q.explanation) || q.explanation.length > 600) errors.push("explanation missing or too long");
    if (!APPROVAL_STATUSES.includes(q.approvalStatus)) errors.push("approvalStatus must be draft, sample or approved");
    if (q.points != null && !(typeof q.points === "number" && q.points > 0)) errors.push("points must be a positive number");

    const type = q.challengeType;
    if (CHOICE_TYPES.includes(type)) {
      const opts = q.options;
      if (!Array.isArray(opts) || opts.length < 2 || opts.length > 6 || !opts.every(str)) {
        errors.push("options must be 2-6 non-empty strings");
      } else {
        if (new Set(opts).size !== opts.length) errors.push("options contain duplicates");
        if (!opts.includes(q.correctAnswer)) errors.push("correctAnswer must be one of the options");
      }
    }
    if (type === "identify_image") {
      if (!str(q.image) || !IMAGE_PATH.test(q.image)) errors.push("image must be a local file under assets/images/");
      if (!str(q.imageAlt)) errors.push("imageAlt (neutral description) required");
    }
    if (type === "true_false" && typeof q.correctAnswer !== "boolean") errors.push("correctAnswer must be true or false");
    if (type === "fill_blank") {
      if (!str(q.correctAnswer)) errors.push("correctAnswer missing");
      if (q.acceptedAnswers != null && !(Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.every(str))) {
        errors.push("acceptedAnswers must be an array of strings");
      }
    }
    if (type === "match_pairs") {
      const p = q.pairs;
      if (!Array.isArray(p) || p.length < 3 || p.length > 6 || !p.every((x) => x && str(x.left) && str(x.right))) {
        errors.push("pairs must be 3-6 objects with left and right");
      } else {
        if (new Set(p.map((x) => x.left)).size !== p.length) errors.push("duplicate left items");
        if (new Set(p.map((x) => x.right)).size !== p.length) errors.push("duplicate right items");
      }
    }
    return errors;
  }

  /** Keeps only valid questions with unique ids. Never throws. */
  function sanitizeBank(list) {
    const valid = [];
    const rejected = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((q, i) => {
      const errors = validateQuestion(q);
      if (!errors.length && seen.has(q.id)) errors.push("duplicate id");
      if (errors.length) rejected.push({ id: q && q.id ? q.id : "#" + i, errors });
      else {
        seen.add(q.id);
        valid.push(q);
      }
    });
    return { valid, rejected };
  }

  function filterQuestions(bank, f) {
    const allowed = f.allowedStatuses || ["approved"];
    return (bank || []).filter(
      (q) =>
        (!f.challengeType || q.challengeType === f.challengeType) &&
        (!f.department || q.department === f.department) &&
        (!f.difficulty || q.difficulty === f.difficulty) &&
        allowed.includes(q.approvalStatus)
    );
  }

  /** Challenge types that have at least one playable question for this department/difficulty. */
  function availableTypes(bank, f) {
    const counts = {};
    CHALLENGE_TYPES.forEach((type) => {
      const n = filterQuestions(bank, Object.assign({}, f, { challengeType: type })).length;
      if (n > 0) counts[type] = n;
    });
    return counts;
  }

  function roundSize(type, cfg) {
    const by = (cfg && cfg.questionsPerRoundByType) || {};
    return by[type] != null ? by[type] : (cfg && cfg.questionsPerRound) || 5;
  }

  function selectRound(pool, size, rng) {
    return shuffle(pool, rng).slice(0, Math.max(0, size));
  }

  /** Clone a question for display: shuffled options / columns. The bank itself is never mutated. */
  function prepareQuestion(q, rng) {
    const p = JSON.parse(JSON.stringify(q));
    if (Array.isArray(p.options)) p.options = shuffle(p.options, rng);
    if (p.challengeType === "match_pairs") {
      p.leftColumn = shuffle(p.pairs.map((x) => x.left), rng);
      p.rightColumn = shuffle(p.pairs.map((x) => x.right), rng);
    }
    return p;
  }

  // ---------------------------------------------------------- answer checking
  function normalizeText(s) {
    return String(s == null ? "" : s)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[-–—_]/g, " ")
      .replace(/[^\p{L}\p{N}\s']/gu, "")
      .replace(/'/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(the|a|an)\s+/, "");
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  function checkFillAnswer(q, input, opts) {
    const tolerance = !opts || opts.typoTolerance !== false;
    const user = normalizeText(input);
    if (!user) return { correct: false, empty: true };
    const candidates = [q.correctAnswer].concat(q.acceptedAnswers || []).map(normalizeText);
    if (candidates.includes(user)) return { correct: true, exact: true };
    if (tolerance) {
      for (const c of candidates) {
        if (/\d/.test(c) || /\d/.test(user) || c.length < 6) continue; // numbers and short words must be exact
        const allowed = c.length >= 12 ? 2 : 1;
        if (levenshtein(user, c) <= allowed) return { correct: true, exact: false, nearMiss: true };
      }
    }
    return { correct: false };
  }

  function checkMatchPair(q, left, right) {
    return q.pairs.some((p) => p.left === left && p.right === right);
  }

  /** Check one response. For match_pairs use checkMatchPair per attempt and matchBoardCorrect at the end. */
  function checkAnswer(q, response, opts) {
    switch (q.challengeType) {
      case "true_false":
        return { correct: response === q.correctAnswer };
      case "fill_blank":
        return checkFillAnswer(q, response, opts);
      case "match_pairs":
        throw new Error("use checkMatchPair / matchBoardCorrect for match_pairs");
      default:
        return { correct: response === q.correctAnswer };
    }
  }

  /** A board counts as correct only when it was completed with no wrong attempts. */
  function matchBoardCorrect(mistakes) {
    return mistakes === 0;
  }

  // ------------------------------------------------------------------ scoring
  function pointsFor(difficulty, questionPoints, cfg) {
    if (cfg && cfg.useQuestionPoints && typeof questionPoints === "number" && questionPoints > 0) return questionPoints;
    const table = (cfg && cfg.points) || { Easy: 10, Medium: 20, Hard: 30 };
    return table[difficulty] || 0;
  }

  function summarizeRound(results, cfg) {
    const total = results.length;
    const correct = results.filter((r) => r.correct).length;
    const points = results.reduce((sum, r) => sum + (r.correct ? pointsFor(r.difficulty, r.points, cfg) : 0), 0);
    return {
      total,
      correct,
      incorrect: total - correct,
      percentage: total === 0 ? 0 : Math.round((correct / total) * 100),
      points,
      timedOut: results.filter((r) => r.timedOut).length,
    };
  }

  function motivationKey(percentage) {
    if (percentage >= 90) return "excellent";
    if (percentage >= 70) return "great";
    if (percentage >= 50) return "good";
    if (percentage > 0) return "keepGoing";
    return "tryAgain";
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? m + "m " + String(s).padStart(2, "0") + "s" : s + "s";
  }

  /** Anonymous aggregate payload. Deliberately has no name field and only day-level time. */
  function buildUsagePayload(summary, round, now) {
    return {
      event: "round_completed",
      day: (now || new Date()).toISOString().slice(0, 10),
      challengeType: round.type,
      department: round.department || null,
      difficulty: round.difficulty || null,
      total: summary.total,
      correct: summary.correct,
      percentage: summary.percentage,
    };
  }

  return {
    CHALLENGE_TYPES,
    DEPARTMENTS,
    DIFFICULTIES,
    CHOICE_TYPES,
    SEGMENT_COUNT,
    SEGMENT_ANGLE,
    MAX_JITTER,
    pickSegmentIndex,
    rotationForSegment,
    segmentAtRotation,
    shuffle,
    isValidName,
    validateQuestion,
    sanitizeBank,
    filterQuestions,
    availableTypes,
    roundSize,
    selectRound,
    prepareQuestion,
    normalizeText,
    levenshtein,
    checkFillAnswer,
    checkMatchPair,
    checkAnswer,
    matchBoardCorrect,
    pointsFor,
    summarizeRound,
    motivationKey,
    formatDuration,
    buildUsagePayload,
  };
});
