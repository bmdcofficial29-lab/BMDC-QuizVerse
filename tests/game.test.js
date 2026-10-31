// Run with:  node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const G = require("../js/game.js");

const bankRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/questions.json"), "utf8"));
const CFG = { points: { Easy: 10, Medium: 20, Hard: 30 }, questionsPerRound: 5, questionsPerRoundByType: { match_pairs: 2 } };
const ALLOWED = ["approved", "sample"];

// ------------------------------------------------------------------ wheel
test("wheel: the segment under the pointer always equals the segment the logic chose", () => {
  let checked = 0;
  for (let index = 0; index < G.SEGMENT_COUNT; index++) {
    for (let i = 0; i < 2500; i++) {
      const start = (Math.random() - 0.5) * 20000; // includes negative and huge rotations
      const jitter = (Math.random() - 0.5) * 2 * G.MAX_JITTER;
      const spins = 3 + Math.floor(Math.random() * 6);
      const target = G.rotationForSegment(index, start, { spins, jitter });
      assert.equal(G.segmentAtRotation(target), index, `index ${index} start ${start} jitter ${jitter}`);
      assert.ok(target >= start + spins * 360 - 1e-9, "wheel must always turn forward");
      checked++;
    }
  }
  assert.equal(checked, 20000);
});

test("wheel: extreme jitter is clamped so the pointer never lands on a border", () => {
  for (let index = 0; index < 8; index++) {
    for (const jitter of [-1000, -G.SEGMENT_ANGLE, 0, G.SEGMENT_ANGLE, 1000]) {
      const target = G.rotationForSegment(index, 123.4, { spins: 5, jitter });
      assert.equal(G.segmentAtRotation(target), index);
      const underPointer = (((360 - (target % 360)) % 360) + 360) % 360;
      const offset = underPointer - index * G.SEGMENT_ANGLE;
      assert.ok(offset > 3 && offset < G.SEGMENT_ANGLE - 3, `offset ${offset}`);
    }
  }
});

test("wheel: pickSegmentIndex stays in range and is roughly uniform", () => {
  assert.equal(G.pickSegmentIndex(() => 0), 0);
  assert.equal(G.pickSegmentIndex(() => 0.9999999), 7);
  assert.equal(G.pickSegmentIndex(() => 1), 7); // defensive clamp
  const counts = new Array(8).fill(0);
  const N = 80000;
  for (let i = 0; i < N; i++) counts[G.pickSegmentIndex()]++;
  counts.forEach((c) => assert.ok(Math.abs(c - N / 8) < N / 8 * 0.06, `uneven: ${counts}`));
});

test("wheel: there are exactly eight segments in the specified order", () => {
  assert.deepEqual(G.CHALLENGE_TYPES, ["mcq", "fill_blank", "true_false", "identify_image", "match_pairs", "rapid_fire", "terminology", "brain_teaser"]);
});

// -------------------------------------------------------------- name form
test("name validation", () => {
  ["Ayesha", "Ali Raza", "Muhammad-Bilal", "O'Neil", "عائشہ", "A.B"].forEach((n) => assert.ok(G.isValidName(n), n));
  ["", " ", "A", "12345", "Bob<script>", "x".repeat(31), "Name!", "😀😀"].forEach((n) => assert.ok(!G.isValidName(n), JSON.stringify(n)));
});

// ------------------------------------------------------------- question bank
test("shipped question bank: every question is valid, ids unique, nothing rejected", () => {
  const r = G.sanitizeBank(bankRaw);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.valid.length, bankRaw.length);
  assert.equal(new Set(bankRaw.map((q) => q.id)).size, bankRaw.length);
});

test("shipped question bank: all 8 challenge types and all 6 departments are represented; sample content is labelled", () => {
  G.CHALLENGE_TYPES.forEach((t) => assert.ok(bankRaw.some((q) => q.challengeType === t), "missing type " + t));
  G.DEPARTMENTS.forEach((d) => assert.ok(bankRaw.some((q) => q.department === d), "missing dept " + d));
  G.DIFFICULTIES.forEach((d) => assert.ok(bankRaw.some((q) => q.difficulty === d), "missing difficulty " + d));
  bankRaw.forEach((q) => {
    assert.equal(q.approvalStatus, "sample", q.id + " must be labelled sample until faculty review");
    assert.equal(q.reviewedBy, null);
    assert.equal(q.points, CFG.points[q.difficulty]);
  });
});

test("shipped question bank: referenced images exist on disk", () => {
  bankRaw.filter((q) => q.image).forEach((q) => assert.ok(fs.existsSync(path.join(__dirname, "..", q.image)), q.image));
});

test("shipped question bank: ids encode department, type and difficulty consistently", () => {
  const dept = { Nursing: "NUR", Audiology: "AUD", Pharmacy: "PHA", DPT: "DPT", Optometry: "OPT", "General Knowledge": "GEN" };
  bankRaw.forEach((q) => {
    assert.ok(q.id.startsWith(dept[q.department] + "-"), q.id);
    assert.ok(q.id.split("-")[2] === q.difficulty[0], q.id);
  });
});

test("validateQuestion rejects malformed questions", () => {
  const good = bankRaw.find((q) => q.challengeType === "mcq");
  const bad = (patch) => G.validateQuestion(Object.assign({}, good, patch));
  assert.deepEqual(G.validateQuestion(good), []);
  assert.ok(bad({ id: "x y" }).length);
  assert.ok(bad({ department: "Dentistry" }).length);
  assert.ok(bad({ difficulty: "Extreme" }).length);
  assert.ok(bad({ challengeType: "essay" }).length);
  assert.ok(bad({ question: "" }).length);
  assert.ok(bad({ explanation: "   " }).length);
  assert.ok(bad({ approvalStatus: "published" }).length);
  assert.ok(bad({ options: ["only one"] }).length);
  assert.ok(bad({ options: ["a", "a"], correctAnswer: "a" }).length);
  assert.ok(bad({ correctAnswer: "not an option" }).length);
  assert.ok(bad({ points: -5 }).length);
  assert.ok(G.validateQuestion(null).length);
  const img = bankRaw.find((q) => q.challengeType === "identify_image");
  assert.ok(G.validateQuestion(Object.assign({}, img, { image: "https://evil.example/x.png" })).length, "external images must be rejected");
  assert.ok(G.validateQuestion(Object.assign({}, img, { image: "../secret.png" })).length);
  assert.ok(G.validateQuestion(Object.assign({}, img, { imageAlt: "" })).length);
  const tfq = bankRaw.find((q) => q.challengeType === "true_false");
  assert.ok(G.validateQuestion(Object.assign({}, tfq, { correctAnswer: "true" })).length, "tf answer must be boolean");
  const mp = bankRaw.find((q) => q.challengeType === "match_pairs");
  assert.ok(G.validateQuestion(Object.assign({}, mp, { pairs: mp.pairs.slice(0, 2) })).length);
  assert.ok(G.validateQuestion(Object.assign({}, mp, { pairs: [mp.pairs[0], mp.pairs[0], mp.pairs[1]] })).length);
  const fb = bankRaw.find((q) => q.challengeType === "fill_blank");
  assert.ok(G.validateQuestion(Object.assign({}, fb, { correctAnswer: "" })).length);
});

test("sanitizeBank drops duplicates and malformed entries but never throws", () => {
  const q = bankRaw[0];
  const r = G.sanitizeBank([q, q, { id: "bad" }, null, 7]);
  assert.equal(r.valid.length, 1);
  assert.equal(r.rejected.length, 4);
  assert.deepEqual(G.sanitizeBank("nope"), { valid: [], rejected: [] });
});

// ------------------------------------------------------------------ filtering
test("filtering: results always match department, difficulty, type and approval status", () => {
  const valid = G.sanitizeBank(bankRaw).valid;
  let combos = 0;
  G.DEPARTMENTS.forEach((department) =>
    G.DIFFICULTIES.forEach((difficulty) =>
      G.CHALLENGE_TYPES.forEach((challengeType) => {
        const res = G.filterQuestions(valid, { department, difficulty, challengeType, allowedStatuses: ALLOWED });
        res.forEach((q) => {
          assert.equal(q.department, department);
          assert.equal(q.difficulty, difficulty);
          assert.equal(q.challengeType, challengeType);
        });
        combos++;
      })
    )
  );
  assert.equal(combos, 144);
});

test("filtering: only allowed approval statuses are playable", () => {
  const valid = G.sanitizeBank(bankRaw).valid;
  const f = { department: "Nursing", difficulty: "Easy", challengeType: "mcq" };
  assert.ok(G.filterQuestions(valid, Object.assign({}, f, { allowedStatuses: ALLOWED })).length > 0);
  assert.equal(G.filterQuestions(valid, Object.assign({}, f, { allowedStatuses: ["approved"] })).length, 0, "sample content must not play in approved-only mode");
  const drafts = valid.map((q) => Object.assign({}, q, { approvalStatus: "draft" }));
  assert.equal(G.filterQuestions(drafts, Object.assign({}, f, { allowedStatuses: ALLOWED })).length, 0, "drafts are never playable");
});

test("missing question sets: documented gaps return empty, and availableTypes lists only real alternatives", () => {
  const valid = G.sanitizeBank(bankRaw).valid;
  assert.equal(G.filterQuestions(valid, { department: "Audiology", difficulty: "Hard", challengeType: "rapid_fire", allowedStatuses: ALLOWED }).length, 0);
  const alt = G.availableTypes(valid, { department: "Nursing", difficulty: "Hard", allowedStatuses: ALLOWED });
  assert.deepEqual(Object.keys(alt), ["mcq"]);
  assert.deepEqual(G.availableTypes([], { department: "Nursing", difficulty: "Easy", allowedStatuses: ALLOWED }), {});
});

test("round selection: respects size, picks distinct questions, never invents any", () => {
  const valid = G.sanitizeBank(bankRaw).valid;
  const pool = G.filterQuestions(valid, { department: "General Knowledge", difficulty: "Easy", challengeType: "mcq", allowedStatuses: ALLOWED });
  const round = G.selectRound(pool, G.roundSize("mcq", CFG));
  assert.equal(round.length, 5);
  assert.equal(new Set(round.map((q) => q.id)).size, 5);
  round.forEach((q) => assert.ok(pool.includes(q)));
  assert.equal(G.selectRound(pool.slice(0, 2), 5).length, 2, "short pools give short rounds, not padding");
  assert.equal(G.selectRound([], 5).length, 0);
  assert.equal(G.roundSize("match_pairs", CFG), 2);
  assert.equal(G.roundSize("mcq", CFG), 5);
});

test("prepareQuestion shuffles options/columns on a copy and keeps the answer reachable", () => {
  const q = bankRaw.find((x) => x.challengeType === "mcq");
  const before = JSON.stringify(q);
  const p = G.prepareQuestion(q);
  assert.equal(JSON.stringify(q), before, "bank must not be mutated");
  assert.deepEqual(p.options.slice().sort(), q.options.slice().sort());
  assert.ok(p.options.includes(p.correctAnswer));
  const m = bankRaw.find((x) => x.challengeType === "match_pairs");
  const pm = G.prepareQuestion(m);
  assert.deepEqual(pm.leftColumn.slice().sort(), m.pairs.map((x) => x.left).sort());
  assert.deepEqual(pm.rightColumn.slice().sort(), m.pairs.map((x) => x.right).sort());
});

// ------------------------------------------------------------ answer checking
test("true/false and choice answers", () => {
  const tf = bankRaw.find((q) => q.challengeType === "true_false" && q.correctAnswer === true);
  assert.ok(G.checkAnswer(tf, true).correct);
  assert.ok(!G.checkAnswer(tf, false).correct);
  const mcq = bankRaw.find((q) => q.challengeType === "mcq");
  assert.ok(G.checkAnswer(mcq, mcq.correctAnswer).correct);
  mcq.options.filter((o) => o !== mcq.correctAnswer).forEach((o) => assert.ok(!G.checkAnswer(mcq, o).correct));
  assert.ok(!G.checkAnswer(mcq, null).correct);
});

test("fill in the blanks: sensible validation", () => {
  const q = { challengeType: "fill_blank", correctAnswer: "photosynthesis", acceptedAnswers: [] };
  assert.ok(G.checkFillAnswer(q, "photosynthesis").correct);
  assert.ok(G.checkFillAnswer(q, "  Photosynthesis  ").correct, "case and spaces ignored");
  assert.ok(G.checkFillAnswer(q, "PHOTOSYNTHESIS!").correct, "punctuation ignored");
  const typo = G.checkFillAnswer(q, "photosynthesys");
  assert.ok(typo.correct && typo.nearMiss, "one-letter typo accepted as near miss");
  assert.ok(!G.checkFillAnswer(q, "photosynthesys", { typoTolerance: false }).correct, "tolerance can be switched off");
  assert.ok(!G.checkFillAnswer(q, "respiration").correct);
  assert.ok(G.checkFillAnswer(q, "").empty);
  assert.ok(!G.checkFillAnswer(q, "").correct);

  const num = { correctAnswer: "60", acceptedAnswers: ["sixty"] };
  assert.ok(G.checkFillAnswer(num, "60").correct);
  assert.ok(G.checkFillAnswer(num, "Sixty").correct);
  assert.ok(!G.checkFillAnswer(num, "61").correct, "numbers must be exact");
  assert.ok(!G.checkFillAnswer(num, "6").correct);

  const short = { correctAnswer: "tibia" };
  assert.ok(!G.checkFillAnswer(short, "fibia").correct, "short words must be exact");
  const art = { correctAnswer: "the heart" };
  assert.ok(G.checkFillAnswer(art, "heart").correct, "leading article ignored");
  const tachy = { correctAnswer: "tachycardia" };
  assert.ok(!G.checkFillAnswer(tachy, "bradycardia").correct, "different terms are not typos");
  const urdu = { correctAnswer: "دل" };
  assert.ok(G.checkFillAnswer(urdu, " دل ").correct);
});

test("every fill-in-the-blank question in the bank accepts its own answer", () => {
  bankRaw.filter((q) => q.challengeType === "fill_blank").forEach((q) => {
    assert.ok(G.checkFillAnswer(q, q.correctAnswer).correct, q.id);
    (q.acceptedAnswers || []).forEach((a) => assert.ok(G.checkFillAnswer(q, a).correct, q.id + " " + a));
  });
});

test("match the pairs", () => {
  const m = bankRaw.find((q) => q.challengeType === "match_pairs");
  m.pairs.forEach((p) => assert.ok(G.checkMatchPair(m, p.left, p.right)));
  assert.ok(!G.checkMatchPair(m, m.pairs[0].left, m.pairs[1].right));
  assert.ok(G.matchBoardCorrect(0));
  assert.ok(!G.matchBoardCorrect(1));
  assert.throws(() => G.checkAnswer(m, []));
});

// -------------------------------------------------------------------- scoring
test("scoring: totals, percentage rounding and points per difficulty", () => {
  const r = (correct, difficulty) => ({ correct, difficulty });
  let s = G.summarizeRound([r(true, "Easy"), r(true, "Easy"), r(true, "Easy"), r(false, "Easy"), r(false, "Easy")], CFG);
  assert.deepEqual([s.total, s.correct, s.incorrect, s.percentage, s.points], [5, 3, 2, 60, 30]);
  s = G.summarizeRound([r(true, "Medium"), r(true, "Medium"), r(false, "Medium")], CFG);
  assert.deepEqual([s.percentage, s.points], [67, 40]);
  s = G.summarizeRound([r(true, "Hard"), r(true, "Hard")], CFG);
  assert.deepEqual([s.percentage, s.points], [100, 60]);
  s = G.summarizeRound([r(false, "Hard")], CFG);
  assert.deepEqual([s.percentage, s.points], [0, 0]);
  s = G.summarizeRound([], CFG);
  assert.deepEqual([s.total, s.percentage, s.points], [0, 0, 0], "empty round must not produce NaN");
  s = G.summarizeRound([{ correct: false, timedOut: true, difficulty: "Easy" }], CFG);
  assert.equal(s.timedOut, 1);
});

test("scoring: points are configurable, with optional per-question override", () => {
  const custom = { points: { Easy: 1, Medium: 2, Hard: 3 } };
  assert.equal(G.summarizeRound([{ correct: true, difficulty: "Hard" }], custom).points, 3);
  assert.equal(G.pointsFor("Easy", 99, custom), 1, "question points ignored by default");
  assert.equal(G.pointsFor("Easy", 99, { points: custom.points, useQuestionPoints: true }), 99);
  assert.equal(G.pointsFor("Easy", undefined, { points: custom.points, useQuestionPoints: true }), 1);
});

test("motivational messages and duration formatting", () => {
  assert.equal(G.motivationKey(100), "excellent");
  assert.equal(G.motivationKey(75), "great");
  assert.equal(G.motivationKey(50), "good");
  assert.equal(G.motivationKey(20), "keepGoing");
  assert.equal(G.motivationKey(0), "tryAgain");
  assert.equal(G.formatDuration(42000), "42s");
  assert.equal(G.formatDuration(65000), "1m 05s");
  assert.equal(G.formatDuration(-5), "0s");
});

test("privacy: usage payload never contains names or other identifiers", () => {
  const payload = G.buildUsagePayload({ total: 5, correct: 4, percentage: 80 }, { type: "mcq", department: "Nursing", difficulty: "Easy", name: "Ayesha" }, new Date("2026-10-29T10:11:12Z"));
  assert.deepEqual(Object.keys(payload).sort(), ["challengeType", "correct", "day", "department", "difficulty", "event", "percentage", "total"]);
  assert.equal(payload.day, "2026-10-29", "day precision only");
  assert.ok(!JSON.stringify(payload).includes("Ayesha"));
});
