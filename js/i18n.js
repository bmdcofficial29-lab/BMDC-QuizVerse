/*! BMDC QuizVerse — tiny translation helper. Strings live in js/strings.js. */
(function (root) {
  "use strict";
  const dict = root.QV_STRINGS || { en: {} };
  let lang = "en";

  function t(key, vars) {
    const table = dict[lang] || dict.en;
    let s = table[key];
    if (s == null) s = dict.en[key];
    if (s == null) {
      if (root.console) console.warn("Missing string:", key);
      return key;
    }
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  }

  /** Count-aware lookup: uses "<key>.one" when count is 1, otherwise "<key>.other". */
  function tn(key, count, vars) {
    return t(key + (count === 1 ? ".one" : ".other"), Object.assign({ count: count }, vars || {}));
  }

  function apply(scope) {
    const rootEl = scope || document;
    rootEl.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
    ["placeholder", "aria-label", "title"].forEach((attr) => {
      rootEl.querySelectorAll("[data-i18n-" + attr + "]").forEach((n) => n.setAttribute(attr, t(n.getAttribute("data-i18n-" + attr))));
    });
  }

  function setLanguage(code) {
    lang = dict[code] ? code : "en";
    document.documentElement.lang = lang;
    document.documentElement.dir = t("meta.dir");
  }

  root.QuizI18n = { t, tn, apply, setLanguage };
})(window);
