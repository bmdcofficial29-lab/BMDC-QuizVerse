# BMDC QuizVerse — "Spin. Play. Learn!"

A mobile-first, gamified quiz web app for BMDC students (Nursing, Audiology, Pharmacy, DPT, Optometry, General Knowledge).
Plain HTML/CSS/JavaScript, no build step, no server code, no paid services. Students open it by scanning a QR code.

> **Status: working prototype. NOT deployed yet.** No public URL exists, so no QR code has been generated.
> All 134 questions are **demo samples** (`approvalStatus: "sample"`), not official BMDC material. Faculty review is required before real use.
> The logo is a text placeholder pending BMDC management approval. Points are for fun, not an official achievement.

## Folder structure

```
index.html            page shell (all screens)
css/styles.css        design system (navy + purple/cyan/teal/orange/yellow)
js/config.js          ALL settings (public file - never put secrets here)
js/strings.js         English text (add an "ur" block for Urdu later)
js/i18n.js            translation helper
js/game.js            pure game logic: validation, filtering, scoring, wheel maths
js/wheel.js           SVG wheel drawing + rotation
js/app.js             screens and the 8 challenge types
data/questions.json   question bank
assets/images/        educational images (sun/thermometer/syringe/heart... demo set)
tests/                game.test.js, static.test.js (Node) + e2e_browser.py (Chromium)
tools/scan-secrets.js scans published files for keys/tokens/webhook URLs
```

## Run it locally

```bash
cd bmdc-quizverse
python3 -m http.server 8765      # then open http://127.0.0.1:8765/
```
(Opening `index.html` by double-click will not work: browsers block `fetch` of local JSON.)

## Settings (`js/config.js`)

| Setting | Meaning |
|---|---|
| `questionsPerRound` / `questionsPerRoundByType` | 5 per round; Match the Pairs uses 2 boards |
| `points` | 10 / 20 / 30 per correct answer (Easy / Medium / Hard) |
| `rapidFire.secondsPerQuestion`, `timerEnabled`, `allowStudentToggle` | Rapid Fire timer (15 s, can be switched off) |
| `allowedApprovalStatuses` | `["approved","sample"]` now. **Before launch set to `["approved"]`** |
| `questionSource.remoteUrl` | optional published question bank; falls back to `data/questions.json` |
| `dailyChallenge.url` | optional `daily.json` published by n8n Workflow A (button hidden when empty) |
| `publicAppUrl` | fill in after deployment |

## Question bank

Each question: `id, department, topic, difficulty, challengeType, question, options, correctAnswer, acceptedAnswers, pairs, image, imageAlt, explanation, points, language, approvalStatus, reviewedBy, reviewedOn`.
Challenge types: `mcq, fill_blank, true_false, identify_image, match_pairs, rapid_fire, terminology, brain_teaser`.
Statuses: `draft` → `sample` (demo only) → `approved` (needs `reviewedBy` + `reviewedOn`, i.e. a real faculty review).
Invalid questions are ignored (and logged to the browser console) instead of breaking the app.
Many department/difficulty/type combinations are intentionally empty; the app then shows a friendly "no questions yet" screen and never substitutes unrelated questions.

## Deploy for free (static hosting)

Any static host works: **GitHub Pages**, **Cloudflare Pages** or **Netlify**. Example with GitHub Pages:
1. Create a GitHub repository and upload the contents of this folder (not the folder itself).
2. Settings → Pages → Deploy from branch → `main` / root.
3. After a minute GitHub shows the real address, e.g. `https://<owner>.github.io/<repo>/`.
4. Put that address in `publicAppUrl`, then generate the QR code **from the real address** (e.g. any QR generator, or `pip install qrcode[pil]` then `qr "https://…" > quizverse-qr.png`).
5. Before announcing it: set `allowedApprovalStatuses` to `["approved"]` and load faculty-reviewed questions.

## n8n (instance: bmdcarena.app.n8n.cloud) — optional, the app does NOT need it

The game runs entirely from `data/questions.json`. n8n is only for publishing/validation/reporting. Since your n8n is n8n Cloud, no extra server is needed; check your n8n plan for execution limits and cost.
Student names are never sent to n8n. All three workflows are **saved but NOT published (inactive)**.

| Workflow | ID | What it does | Before you publish it |
|---|---|---|---|
| **A – Daily Challenge Publisher** | `Yt5oQIFDsh43diuB` | Daily 07:00: reads the question bank, picks a daily challenge from **approved** questions only, commits `data/daily.json` to GitHub (skips if today's is already there) | Edit node *Daily Challenge Settings* (bank URL, GitHub owner/repo). Create a **GitHub** credential in n8n (fine-grained token, Contents: read/write on that one repo) and select it on the two GitHub nodes. Set the n8n workflow timezone to Asia/Karachi if wanted. Then set `dailyChallenge.url` in `config.js` to the published `data/daily.json`. |
| **B – Question Bank Validation** | `m2zhGAHlcqHG8YdX` | Webhook `POST /webhook/quizverse/validate-questions`: validates every field, rejects malformed/duplicate IDs, downgrades any "approved" without `reviewedBy`/`reviewedOn` to draft. Publishes nothing. | **Create a Header Auth credential and select it on the webhook node.** The auth credential could not be attached automatically; do not activate until it is set, otherwise the endpoint is open. |
| **C – Aggregate Usage Reporting** (optional) | `7aHBB3olEq2U3ipH` | Weekly summary of anonymous counts. **Off by default** (`reportingApproved = false`). Any event with extra fields (name, ID, phone, email) is dropped, never summarised. | Only after management approves an anonymous, consented data source: set its URL and `reportingApproved = true`. Nothing in the app currently produces such data. |

## Tests

```bash
node --test tests/game.test.js
node --test tests/static.test.js
node tools/scan-secrets.js
python3 -m http.server 8765 &     # then:
python3 tests/e2e_browser.py      # needs: pip install playwright && playwright install chromium
```

### Results of the last run

| Check | Result |
|---|---|
| Game logic unit tests (24) | pass |
| Static file tests (6) | pass |
| Secret/token/webhook-URL scan of 17 published files | clean |
| Browser tests in Chromium (66 checks) | **66 / 66 pass**: welcome on mobile (375px) and desktop, no horizontal scroll, keyboard start, form validation, all 18 department × difficulty combos, all 8 challenge types played end-to-end with scoring and review, filtering (36 combos), empty-set fallback, Rapid Fire timeout and timer-off, image loading, works with no external requests |
| Wheel: 6 real animated spins + 60 reduced-motion spins | the segment physically under the pointer always matched the announced result; all 8 segments reachable; the app's own mismatch guard never fired |
| n8n A (2 runs), B (1 run), C (2 runs) | passed with sample data; **external calls (GitHub, question-bank URL, usage export) were simulated**, not made |

Bugs found and fixed during testing: (1) a literal "null" line appeared in every answer feedback; (2) the wheel's invisible rotated corners could sit on top of the Spin button and swallow taps.

### Still needs your manual check
- Real phones (iOS Safari / Android Chrome): touch feel, notch/safe areas, screen reader (TalkBack/VoiceOver).
- Colour contrast with an audit tool (designed for it, not measured).
- Workflow A against real GitHub; Workflow B's registry that remembers IDs across submissions only persists once the workflow is **published** (manual test runs do not keep it).
- Faculty review of every question; management approval of the logo.
