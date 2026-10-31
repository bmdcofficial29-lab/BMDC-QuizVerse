// Static checks on the frontend files: secrets, strings, accessibility basics.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { scan } = require("../tools/scan-secrets.js");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("no API secrets, tokens, credentials or webhook URLs in any published frontend file", () => {
  const { files, findings } = scan();
  assert.ok(files.length >= 10);
  assert.deepEqual(findings, []);
});

test("config.js contains no secret-looking values and keeps usage reporting off by default", () => {
  global.window = {};
  eval(read("js/config.js"));
  const cfg = global.window.QUIZVERSE_CONFIG;
  assert.equal(cfg.usageReporting.enabled, false);
  assert.equal(cfg.usageReporting.endpointUrl, "");
  assert.equal(cfg.questionSource.remoteUrl, "");
  assert.deepEqual(cfg.points, { Easy: 10, Medium: 20, Hard: 30 });
  assert.equal(cfg.questionsPerRound, 5);
  assert.equal(cfg.rapidFire.timerEnabled, true);
  delete global.window;
});

test("every string key used in app.js, wheel and index.html exists in strings.js", () => {
  global.window = {};
  eval(read("js/strings.js"));
  const en = global.window.QV_STRINGS.en;
  const missing = new Set();
  const check = (k) => {
    if (k.endsWith(".")) return; // dynamic prefix such as t("dept." + name); the real keys are checked explicitly below
    if (!(k in en)) missing.add(k);
  };
  const app = read("js/app.js");
  for (const m of app.matchAll(/\bt\(\s*"([^"]+)"/g)) check(m[1]);
  for (const m of app.matchAll(/\btn\(\s*"([^"]+)"/g)) { check(m[1] + ".one"); check(m[1] + ".other"); }
  for (const m of app.matchAll(/"(err\.[A-Za-z]+|msg\.[A-Za-z]+|bank\.[A-Za-z]+)"/g)) check(m[1].startsWith("bank.ready") ? m[1] + ".one" : m[1]);
  const html = read("index.html");
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) check(m[1]);
  ["dept.", "diff."].forEach((p) => {
    const G = require("../js/game.js");
    (p === "dept." ? G.DEPARTMENTS : G.DIFFICULTIES).forEach((v) => check(p + v));
  });
  const G = require("../js/game.js");
  G.CHALLENGE_TYPES.forEach((t) => ["name", "l1", "l2", "desc"].forEach((s) => check(`type.${t}.${s}`)));
  ["excellent", "great", "good", "keepGoing", "tryAgain"].forEach((k) => check("msg." + k));
  assert.deepEqual([...missing], []);
  delete global.window;
});

test("index.html: language, viewport, CSP, landmarks and accessible form controls", () => {
  const html = read("index.html");
  assert.match(html, /<html lang="en"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /<main /);
  assert.match(html, /<header /);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<label for="student-name"/);
  assert.match(html, /<label for="department"/);
  assert.match(html, /role="alert"/);
  assert.ok(!/<script>[^<]/.test(html), "no inline scripts (CSP)");
  assert.ok(!/ style="/.test(html), "no inline styles (CSP)");
});

test("student name is never sent anywhere or stored", () => {
  const app = read("js/app.js");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(app), "no browser storage is used");
  assert.ok(!/session\.name/.test(app.split("buildUsagePayload")[1] || ""), "name not used in reporting payload");
  const net = [...app.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  net.forEach((call) => assert.ok(!/name/i.test(call.replace(/\bfilename\b/i, "")), "fetch call mentions name: " + call));
});

test("all CSS colour pairs used for body text meet WCAG AA contrast", () => {
  const lum = (hex) => {
    const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const pairs = [
    ["#f4f6ff", "#0b1030"], ["#c3cbf5", "#0b1030"], ["#c3cbf5", "#121a45"], ["#ffffff", "#7c3aed"], ["#ffffff", "#6d28d9"],
    ["#0b1030", "#fde047"], ["#03201c", "#2dd4bf"], ["#ffffff", "#1b2560"], ["#ffc2cb", "#0b1030"], ["#fde047", "#0b1030"],
    // wheel segment label colours
    ["#ffffff", "#7c3aed"], ["#06122e", "#22d3ee"], ["#241200", "#fb923c"], ["#03201c", "#2dd4bf"], ["#2a2200", "#fde047"],
    ["#ffffff", "#4f46e5"], ["#ffffff", "#db2777"], ["#03201c", "#14b8a6"],
  ];
  pairs.forEach(([fg, bg]) => assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`));
});
