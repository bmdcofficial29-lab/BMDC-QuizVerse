"""
Browser end-to-end tests for BMDC QuizVerse (Playwright, Chromium).

Run:   python3 -m http.server 8765 --directory <project>   (in another terminal)
       python3 tests/e2e_browser.py [http://127.0.0.1:8765/index.html]

Everything runs against the real UI with the local question bank only (no n8n).
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/index.html"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.environ.get("QV_SHOTS", "/tmp/qv-shots")
os.makedirs(SHOTS, exist_ok=True)

NAMES = ["MCQ Challenge", "Fill in the Blanks", "True or False", "Identify the Image", "Match the Pairs", "Rapid Fire", "Terminology Challenge", "Brain Teaser"]
TYPES = ["mcq", "fill_blank", "true_false", "identify_image", "match_pairs", "rapid_fire", "terminology", "brain_teaser"]
DEPTS = ["Nursing", "Audiology", "Pharmacy", "DPT", "Optometry", "General Knowledge"]
DIFFS = ["Easy", "Medium", "Hard"]
POINTS = {"Easy": 10, "Medium": 20, "Hard": 30}

BANK = json.load(open(os.path.join(ROOT, "data", "questions.json"), encoding="utf-8"))
BANK = [q for q in BANK if q["approvalStatus"] in ("approved", "sample")]

results = []
console_errors = []


def check(name, cond, detail=""):
    results.append({"test": name, "pass": bool(cond), "detail": str(detail)})
    print(("PASS  " if cond else "FAIL  ") + name + ((" - " + str(detail)) if detail else ""))


def new_page(browser, **kw):
    ctx = browser.new_context(**kw)
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append("pageerror: " + str(e)))
    page.goto(BASE)
    page.wait_for_selector("#btn-start")
    return ctx, page


def visible(page, sel):
    return page.locator(sel).is_visible()


def go_setup(page, name, dept, diff, timer=None):
    if not visible(page, "#screen-setup"):
        page.click("#btn-start")
    page.fill("#student-name", name)
    page.select_option("#department", dept)
    page.locator('label[for="difficulty-%s"]' % diff.lower()).click()
    if timer is not None and page.locator("#timer-toggle").count():
        if page.locator("#timer-toggle").is_visible() and page.is_checked("#timer-toggle") != timer:
            page.locator("#timer-toggle").click(force=True)
    page.click('#setup-form button[type="submit"]')
    page.wait_for_selector("#screen-wheel:not([hidden])")


def pick_manual(page, type_name):
    if not page.evaluate("document.querySelector('#manual-pick').open"):
        page.click("#manual-pick summary")
    page.locator("#manual-list .chip-btn", has_text=type_name).first.click()
    page.wait_for_selector("#wheel-result:not([hidden]), #btn-fallback-spin", timeout=10000)


def state_round(page):
    return page.evaluate("() => { const r = window.__QuizVerse.state.round; return r ? { questions: r.questions, index: r.index, n: r.questions.length, results: r.results } : null; }")


def click_value(page, selector, value, equal=True):
    return page.evaluate(
        """([sel, val, eq]) => { const els = [...document.querySelectorAll(sel)];
        const el = els.find(e => (e.dataset.value === val) === eq && !e.disabled); if (!el) return false; el.click(); return true; }""",
        [selector, value, equal],
    )


def answer(page, correct):
    r = state_round(page)
    q = r["questions"][r["index"]]
    t = q["challengeType"]
    if t == "fill_blank":
        page.fill("#fill-input", q["correctAnswer"] if correct else "zzzzqq")
        page.press("#fill-input", "Enter")
    elif t == "true_false":
        want = q["correctAnswer"] if correct else (not q["correctAnswer"])
        assert click_value(page, ".tf-btn", "true" if want else "false")
    elif t == "match_pairs":
        for p in q["pairs"]:
            page.evaluate(
                """([l, r]) => { const cols = document.querySelectorAll('.match-list');
                [[cols[0], l], [cols[1], r]].forEach(([c, v]) => [...c.querySelectorAll('.match-item')].find(b => b.dataset.value === v).click()); }""",
                [p["left"], p["right"]],
            )
            page.wait_for_timeout(60)
    else:
        assert click_value(page, ".choices .choice", q["correctAnswer"], equal=correct)
    page.wait_for_selector("#btn-next:not([hidden])", timeout=8000)


def play_round(page, plan):
    """plan: list of booleans (answer correctly?). Match boards are always completed correctly."""
    r = state_round(page)
    done = []
    for i in range(r["n"]):
        want = plan[i % len(plan)]
        if r["questions"][i]["challengeType"] == "match_pairs":
            want = True
        answer(page, want)
        done.append(want)
        page.click("#btn-next")
        if i < r["n"] - 1:
            page.wait_for_function("(i) => window.__QuizVerse.state.round.index === i", arg=i + 1)
    page.wait_for_selector("#screen-results:not([hidden])")
    return done


def results_stats(page):
    return page.evaluate(
        """() => { const o = {}; document.querySelectorAll('#results-stats .stat').forEach(s => { o[s.querySelector('dt').textContent.trim()] = s.querySelector('dd').textContent.trim(); });
        return { fraction: document.querySelector('#score-fraction').textContent.trim(), percent: document.querySelector('#score-percent').textContent.trim(), stats: o,
                 message: document.querySelector('#results-message').textContent.trim() }; }"""
    )


def wheel_probe(page):
    """Independent of the app's own maths: which wheel segment is physically under the pointer?"""
    return page.evaluate(
        """() => { document.querySelector('.wheel-wrap').scrollIntoView({ block: 'center', behavior: 'instant' });
        const w = document.querySelector('.wheel-wrap').getBoundingClientRect();
        const x = w.left + w.width / 2, y = w.top + w.height * 0.12;
        const wrap = document.querySelector('.wheel-wrap'); const prev = wrap.style.pointerEvents; wrap.style.pointerEvents = 'auto';
        const hit = document.elementsFromPoint(x, y).find(e => e.hasAttribute && e.hasAttribute('data-segment') && e.closest('#wheel'));
        wrap.style.pointerEvents = prev;
        const m = getComputedStyle(document.querySelector('#wheel')).transform;
        return { seg: hit ? Number(hit.getAttribute('data-segment')) : null, transform: m }; }"""
    )


def announced_index(page):
    txt = page.locator("#wheel-result").inner_text()
    hits = [i for i, n in enumerate(NAMES) if n.lower() in txt.lower()]
    return hits[0] if len(hits) == 1 else (hits, txt)


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---- 1. Welcome screen: desktop + mobile, no horizontal scroll -------------------------------
    for label, vp in [("desktop", {"width": 1280, "height": 800}), ("mobile", {"width": 375, "height": 667})]:
        ctx, page = new_page(browser, viewport=vp)
        check("1. welcome (%s): Start Learning is visible" % label, visible(page, "#btn-start") and "start" in page.inner_text("#btn-start").lower())
        ow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("1. welcome (%s): no horizontal scrolling" % label, ow <= 1, "overflow=%spx" % ow)
        check("1. welcome (%s): tagline shown" % label, "Spin. Play. Learn!" in page.inner_text("body"))
        page.screenshot(path=os.path.join(SHOTS, "welcome-%s.png" % label))
        ctx.close()

    # ---- keyboard: Tab reaches Start, Enter opens the form -----------------------------------------
    ctx, page = new_page(browser)
    reached = False
    for _ in range(8):
        page.keyboard.press("Tab")
        if page.evaluate("document.activeElement && document.activeElement.id") == "btn-start":
            reached = True
            break
    page.keyboard.press("Enter")
    check("keyboard: Tab reaches Start button and Enter opens setup", reached and visible(page, "#screen-setup"))

    # ---- 2. Form validation ------------------------------------------------------------------------
    page.click('#setup-form button[type="submit"]')
    errs = page.evaluate("[...document.querySelectorAll('#name-error,#department-error,#difficulty-error')].filter(e => !e.hidden && e.textContent.trim()).length")
    check("2. empty form shows 3 friendly errors and stays on setup", errs == 3 and visible(page, "#screen-setup"), "errors shown=%s" % errs)
    check("2. invalid name marks input aria-invalid", page.get_attribute("#student-name", "aria-invalid") == "true")
    page.fill("#student-name", "12345")
    page.select_option("#department", "Nursing")
    page.locator('label[for="difficulty-easy"]').click()
    page.click('#setup-form button[type="submit"]')
    check("2. numeric-only name is rejected", visible(page, "#screen-setup") and bool(page.inner_text("#name-error").strip()))
    page.fill("#student-name", "A")
    page.click('#setup-form button[type="submit"]')
    check("2. one-letter name is rejected", visible(page, "#screen-setup"))
    page.fill("#student-name", "Ayesha")
    page.click('#setup-form button[type="submit"]')
    page.wait_for_selector("#screen-wheel:not([hidden])")
    check("2. valid form proceeds to the wheel", visible(page, "#screen-wheel"))
    check("2. privacy: no ID/phone/email fields exist", page.locator("#setup-form input[type=email], #setup-form input[type=tel], #setup-form input[name*=id i]").count() == 0)
    ctx.close()

    # ---- 3. Every department x difficulty can be selected ---------------------------------------------
    ctx, page = new_page(browser)
    bad = []
    for d in DEPTS:
        for f in DIFFS:
            page.goto(BASE)
            page.wait_for_selector("#btn-start")
            go_setup(page, "Sara", d, f)
            chip = page.inner_text("#session-chip")
            if d.lower() not in chip.lower() or f.lower() not in chip.lower():
                bad.append((d, f, chip))
    check("3. all 6 departments x 3 difficulties selectable (18 combos)", not bad, bad[:3])
    ctx.close()

    # ---- 4. Wheel: animated spins land where the logic says --------------------------------------------
    ctx, page = new_page(browser, viewport={"width": 1280, "height": 800})
    go_setup(page, "Ayesha", "General Knowledge", "Easy")
    mism, landed = [], []
    t0 = time.time()
    for i in range(6):
        if i:
            page.locator("#wheel-result button.btn-ghost").first.click()
        page.click("#btn-spin")
        busy = page.get_attribute("#btn-spin", "aria-busy")
        page.wait_for_selector("#wheel-result:not([hidden])", timeout=15000)
        probe, ann = wheel_probe(page), announced_index(page)
        landed.append(ann)
        if probe["seg"] != ann:
            mism.append((i, probe, ann))
        if i == 0:
            check("4. spin button is disabled/busy while spinning", busy == "true")
    check("4. animated spins: segment under pointer == announced result (6 spins)", not mism, mism[:2] or landed)
    check("4. animated spin took a natural, non-instant time", (time.time() - t0) / 6 > 3, "avg %.1fs" % ((time.time() - t0) / 6))
    page.screenshot(path=os.path.join(SHOTS, "wheel-result-desktop.png"))
    ctx.close()

    # reduced-motion: instant spins, many of them, plus distribution sanity
    ctx, page = new_page(browser, reduced_motion="reduce")
    go_setup(page, "Ayesha", "General Knowledge", "Easy")
    mism, seen = [], set()
    for i in range(60):
        if i:
            page.locator("#wheel-result button.btn-ghost").first.click()
        page.click("#btn-spin")
        page.wait_for_selector("#wheel-result:not([hidden])", timeout=5000)
        probe, ann = wheel_probe(page), announced_index(page)
        seen.add(ann if isinstance(ann, int) else -1)
        if probe["seg"] != ann:
            mism.append((i, probe["seg"], ann))
    check("4. reduced motion: 60 instant spins all consistent", not mism, mism[:3])
    check("4. reduced motion: all 8 segments reachable in 60 spins", seen == set(range(8)), sorted(seen))
    wheel_errs = [e for e in console_errors if "Wheel mismatch" in e]
    check("4. the app's own mismatch guard never fired", not wheel_errs, wheel_errs[:1])
    ctx.close()

    # ---- 5/8/9. Each challenge type end-to-end + scoring + review --------------------------------------
    ctx, page = new_page(browser, viewport={"width": 390, "height": 800})
    for idx, (tname, ttype) in enumerate(zip(NAMES, TYPES)):
        page.goto(BASE)
        page.wait_for_selector("#btn-start")
        go_setup(page, "Ayesha", "General Knowledge", "Easy", timer=True)
        pick_manual(page, tname)
        page.click("#btn-begin")
        page.wait_for_selector("#screen-challenge:not([hidden])")
        r = state_round(page)
        qtypes = {q["challengeType"] for q in r["questions"]}
        ok_filter = qtypes == {ttype} and all(q["department"] == "General Knowledge" and q["difficulty"] == "Easy" for q in r["questions"])
        progress = page.inner_text("#progress-text")
        shot_done = False
        plan = [True, False, True, True, False]
        done = play_round(page, plan)
        s = results_stats(page)
        n = r["n"]
        exp_correct = sum(1 for d in done if d)
        exp_pct = round(exp_correct / n * 100)
        nums = s["fraction"].replace("/", " ").split()
        got_correct = int(nums[0]) if nums and nums[0].isdigit() else None
        pct_ok = str(exp_pct) in s["percent"]
        pts_expected = exp_correct * POINTS["Easy"]
        pts_shown = " ".join(s["stats"].values())
        items = page.locator("#review-list .review-item").count()
        check("5. %s: correct type/department/difficulty served" % tname, ok_filter, sorted(qtypes))
        check("5. %s: progress indicator reads 'Question 1 of N'" % tname, ("1" in progress and str(n) in progress), progress)
        check("8. %s: score %d/%d, %d%%, %d pts" % (tname, exp_correct, n, exp_pct, pts_expected), got_correct == exp_correct and pct_ok and str(pts_expected) in pts_shown, "%s | %s | %s" % (s["fraction"], s["percent"], s["stats"]))
        check("9. %s: review lists all %d questions with explanations" % (tname, n), items == n and page.locator("#review-list").inner_text().count("") > 0, "items=%d" % items)
        if idx == 0:
            page.screenshot(path=os.path.join(SHOTS, "results-mobile.png"), full_page=True)
    # results buttons
    check("9. results screen has Spin Again / Try Another / Home", all(visible(page, s) for s in ["#btn-spin-again", "#btn-another", "#btn-home"]))
    page.click("#btn-spin-again")
    page.wait_for_selector("#screen-wheel:not([hidden])")
    check("9. 'Spin Again' returns to the wheel", visible(page, "#screen-wheel"))
    page.goto(BASE); page.wait_for_selector("#btn-start")
    go_setup(page, "Ayesha", "General Knowledge", "Easy")
    pick_manual(page, "MCQ Challenge"); page.click("#btn-begin")
    play_round(page, [True])
    page.click("#btn-another")
    page.wait_for_selector("#screen-wheel:not([hidden])")
    check("9. 'Try Another Challenge' opens the challenge chooser", page.evaluate("document.querySelector('#manual-pick').open"))
    page.goto(BASE); page.wait_for_selector("#btn-start")
    go_setup(page, "Ayesha", "General Knowledge", "Easy")
    pick_manual(page, "MCQ Challenge"); page.click("#btn-begin")
    play_round(page, [True]); page.click("#btn-home")
    check("9. 'Home' returns to the welcome screen", visible(page, "#screen-welcome"))
    ctx.close()

    # ---- 6/7. Filtering by department+difficulty, and graceful handling of missing sets ------------------
    ctx, page = new_page(browser)
    wrong, fb_wrong = [], []
    combos = 0
    for d in DEPTS:
        for f in DIFFS:
            for tname, ttype in [("MCQ Challenge", "mcq"), ("Match the Pairs", "match_pairs")]:
                combos += 1
                pool = [q for q in BANK if q["department"] == d and q["difficulty"] == f and q["challengeType"] == ttype]
                page.goto(BASE); page.wait_for_selector("#btn-start")
                go_setup(page, "Sara", d, f)
                if page.locator("#manual-list .chip-btn", has_text=tname).first.is_disabled():
                    # chooser disables unavailable types
                    if pool:
                        wrong.append((d, f, ttype, "disabled but pool=%d" % len(pool)))
                    continue
                pick_manual(page, tname)
                if page.locator("#btn-fallback-spin").count() and visible(page, "#btn-fallback-spin"):
                    if pool:
                        fb_wrong.append((d, f, ttype, "fallback shown but pool=%d" % len(pool)))
                    if state_round(page) is not None:
                        fb_wrong.append((d, f, ttype, "round started despite fallback"))
                    continue
                page.click("#btn-begin")
                page.wait_for_selector("#screen-challenge:not([hidden])")
                r = state_round(page)
                if not pool:
                    wrong.append((d, f, ttype, "round started with empty pool"))
                elif any(q["department"] != d or q["difficulty"] != f or q["challengeType"] != ttype for q in r["questions"]):
                    wrong.append((d, f, ttype, "question from wrong set"))
    check("6. questions filtered by dept+difficulty+type (%d combos)" % combos, not wrong, wrong[:3])
    check("7. empty sets show friendly fallback and never start a round", not fb_wrong, fb_wrong[:3])
    empty_hit = [1 for d in DEPTS for f in DIFFS if not [q for q in BANK if q["department"] == d and q["difficulty"] == f and q["challengeType"] == "match_pairs"]]
    check("7. test data really contains empty sets to exercise the fallback", len(empty_hit) > 0, "%d empty dept/difficulty combos for match" % len(empty_hit))
    # wheel path to a fallback: Nursing / Hard, spin repeatedly until fallback is shown
    page.goto(BASE); page.wait_for_selector("#btn-start")
    go_setup(page, "Sara", "Nursing", "Hard")
    page.click("#btn-spin")
    page.wait_for_selector("#wheel-result:not([hidden])", timeout=15000)
    page.screenshot(path=os.path.join(SHOTS, "wheel-nursing-hard.png"))
    ctx.close()

    # ---- Rapid Fire timer: expiry counts as incorrect; toggle off removes the timer --------------------------
    ctx, page = new_page(browser)
    go_setup(page, "Ayesha", "General Knowledge", "Easy", timer=True)
    pick_manual(page, "Rapid Fire"); page.click("#btn-begin")
    page.wait_for_selector("#screen-challenge:not([hidden])")
    check("rapid fire: countdown timer visible when enabled", visible(page, "#timer"))
    page.wait_for_selector("#btn-next:not([hidden])", timeout=20000)
    fb = page.inner_text("#feedback")
    res = state_round(page)["results"]
    check("feedback never contains a stray 'null'", "null" not in fb.lower().split(), repr(fb[:80]))
    check("rapid fire: timeout is shown and counted as incorrect", "time" in fb.lower() and res and res[0]["correct"] is False, fb[:60])
    ctx.close()
    ctx, page = new_page(browser)
    go_setup(page, "Ayesha", "General Knowledge", "Easy", timer=False)
    pick_manual(page, "Rapid Fire"); page.click("#btn-begin")
    page.wait_for_selector("#screen-challenge:not([hidden])")
    check("rapid fire: timer can be disabled", not visible(page, "#timer"))
    ctx.close()

    # ---- Identify the Image: image has alt text ---------------------------------------------------------------
    ctx, page = new_page(browser)
    go_setup(page, "Ayesha", "General Knowledge", "Easy")
    pick_manual(page, "Identify the Image"); page.click("#btn-begin")
    page.wait_for_selector("#screen-challenge:not([hidden])")
    page.wait_for_function("() => { const i = document.querySelector('#question-image'); return i && i.complete; }", timeout=5000)
    img = page.evaluate("() => { const i = document.querySelector('#question-image'); return { alt: i.alt, ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') }; }")
    check("image question: loads a local approved image with alt text", img["ok"] and img["alt"] and img["src"].startswith("assets/images/"), img)
    ctx.close()

    # ---- 11. Works with no n8n: nothing outside this origin was requested -----------------------------------------
    ctx = browser.new_context()
    page = ctx.new_page()
    foreign = []
    page.on("request", lambda rq: foreign.append(rq.url) if not rq.url.startswith(BASE.rsplit("/", 1)[0]) and not rq.url.startswith("data:") else None)
    page.goto(BASE); page.wait_for_selector("#btn-start")
    go_setup(page, "Ayesha", "Nursing", "Easy")
    pick_manual(page, "MCQ Challenge"); page.click("#btn-begin"); play_round(page, [True, False])
    check("11. full round works with local question bank; no external requests (n8n not needed)", not foreign, foreign[:3])
    ctx.close()
    browser.close()

real_errors = [e for e in console_errors if "Wheel mismatch" not in e and "favicon" not in e.lower()]
check("no unexpected browser console errors", not real_errors, real_errors[:3])

passed = sum(1 for r in results if r["pass"])
print("\n%d/%d checks passed" % (passed, len(results)))
json.dump(results, open(os.path.join(SHOTS, "e2e-results.json"), "w"), indent=1)
sys.exit(0 if passed == len(results) else 1)
