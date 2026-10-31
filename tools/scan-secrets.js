#!/usr/bin/env node
/*
 * Scans the files that are published to students (the static web app) for anything that looks like a secret.
 * Usage:  node tools/scan-secrets.js            (exit code 1 if something suspicious is found)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLISHED = ["index.html", "css", "js", "data", "assets"]; // everything a student's browser downloads

const RULES = [
  { name: "API key-like token (sk-…, key-…)", re: /\b(sk|pk|key)[-_][A-Za-z0-9]{16,}\b/ },
  { name: "Anthropic / OpenAI key", re: /\b(sk-ant-|sk-proj-)[A-Za-z0-9_-]{10,}/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9._-]{16,}/i },
  { name: "Authorization header", re: /authorization["']?\s*[:=]/i },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Assigned secret/password/token/apiKey", re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s]{6,}["']/i },
  { name: "n8n webhook URL (may embed a secret path)", re: /https?:\/\/[^\s"']*\/webhook(-test)?\/[^\s"']+/i },
  { name: "URL with embedded credentials", re: /https?:\/\/[^\s/@"']+:[^\s/@"']+@/ },
  { name: "Email address", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];

function walk(p, out) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return out;
  const st = fs.statSync(full);
  if (st.isDirectory()) fs.readdirSync(full).forEach((f) => walk(path.join(p, f), out));
  else if (/\.(html|css|js|json|svg|txt|md)$/i.test(p)) out.push(p);
  return out;
}

function scan() {
  const findings = [];
  const files = PUBLISHED.reduce((acc, p) => walk(p, acc), []);
  files.forEach((file) => {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      RULES.forEach((rule) => {
        if (rule.re.test(line)) findings.push({ file, line: i + 1, rule: rule.name, text: line.trim().slice(0, 120) });
      });
    });
  });
  return { files, findings };
}

if (require.main === module) {
  const { files, findings } = scan();
  console.log(`Scanned ${files.length} published files.`);
  if (findings.length) {
    findings.forEach((f) => console.log(`  ✗ ${f.file}:${f.line}  ${f.rule}\n      ${f.text}`));
    console.log(`\n${findings.length} potential secret(s) found.`);
    process.exit(1);
  }
  console.log("✓ No secrets, tokens, credentials or webhook URLs found in frontend files.");
}
module.exports = { scan };
