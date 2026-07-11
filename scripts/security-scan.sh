#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$REPO_ROOT/index.html"
BACKEND="$REPO_ROOT/Code.gs"
FINDINGS=""
COUNT=0

add_finding() {
  local severity="$1" file="$2" rule="$3" detail="$4"
  COUNT=$((COUNT + 1))
  FINDINGS="${FINDINGS}### ${COUNT}. [${severity}] ${rule}\n- **File:** \`${file}\`\n- **Detail:** ${detail}\n\n"
}

echo "=== SMOS Security Scan ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M UTC')"
echo ""

# ──────────────────────────────────────
# 1. Hardcoded secrets / credentials
# ──────────────────────────────────────
echo "[1/8] Checking for hardcoded secrets..."

# API keys, passwords, tokens in JS (not inside variable names)
if grep -Pn '(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*["\x27][A-Za-z0-9_\-]{20,}' "$FRONTEND" 2>/dev/null | grep -v 'GOOGLE_CLIENT_ID\|BACKEND_URL'; then
  add_finding "CRITICAL" "index.html" "Hardcoded secret" "Potential API key or secret found in frontend code"
fi

if grep -Pn 'openById\s*\(\s*"[A-Za-z0-9_-]{30,}"' "$BACKEND" 2>/dev/null; then
  add_finding "HIGH" "Code.gs" "Hardcoded spreadsheet ID" "Sheet ID should come from PropertiesService, not hardcoded"
fi

# ──────────────────────────────────────
# 2. XSS: innerHTML / unescaped data
# ──────────────────────────────────────
echo "[2/8] Checking for XSS vulnerabilities..."

if grep -Pn '\.innerHTML\s*=' "$FRONTEND" 2>/dev/null | grep -v 'escHtml\|textContent\|sanitize'; then
  add_finding "HIGH" "index.html" "innerHTML usage" "Direct innerHTML assignment found — verify all data is escaped"
fi

# Backend: sheet data in HTML without escHtml_
if grep -Pn "html\s*\+=" "$BACKEND" 2>/dev/null | grep -P "\+\s*(r\.|n\b)" | grep -v 'escHtml_'; then
  add_finding "HIGH" "Code.gs" "Unescaped email HTML" "Sheet data inserted into email HTML without escHtml_()"
fi

# ──────────────────────────────────────
# 3. eval / Function constructor
# ──────────────────────────────────────
echo "[3/8] Checking for dangerous JS patterns..."

if grep -Pn '\beval\s*\(' "$FRONTEND" "$BACKEND" 2>/dev/null; then
  add_finding "CRITICAL" "multiple" "eval() usage" "eval() allows arbitrary code execution"
fi

if grep -Pn '\bnew\s+Function\s*\(' "$FRONTEND" "$BACKEND" 2>/dev/null; then
  add_finding "HIGH" "multiple" "Function constructor" "new Function() is equivalent to eval()"
fi

# ──────────────────────────────────────
# 4. Auth bypass / missing checks
# ──────────────────────────────────────
echo "[4/8] Checking authentication..."

if ! grep -q 'verifyToken_' "$BACKEND" 2>/dev/null; then
  add_finding "CRITICAL" "Code.gs" "No auth in backend" "doGet must verify tokens before returning data"
fi

if grep -Pn 'function\s+doGet' "$BACKEND" 2>/dev/null | head -1 | grep -v 'verifyToken_' > /dev/null; then
  # Check if verifyToken_ is called inside doGet
  if ! sed -n '/function doGet/,/^}/p' "$BACKEND" 2>/dev/null | grep -q 'verifyToken_'; then
    add_finding "CRITICAL" "Code.gs" "doGet without auth" "doGet does not call verifyToken_"
  fi
fi

# ──────────────────────────────────────
# 5. Email security
# ──────────────────────────────────────
echo "[5/8] Checking email security..."

if ! grep -q 'validateEmail_' "$BACKEND" 2>/dev/null; then
  add_finding "HIGH" "Code.gs" "No email validation" "Email recipients must be validated before sending"
fi

if ! grep -q 'ALLOWED_DOMAINS' "$BACKEND" 2>/dev/null; then
  add_finding "HIGH" "Code.gs" "No domain restriction" "Email sending has no domain allowlist"
fi

if ! grep -q 'MAX_RECIPIENTS' "$BACKEND" 2>/dev/null; then
  add_finding "MEDIUM" "Code.gs" "No send limit" "No cap on number of email recipients"
fi

# ──────────────────────────────────────
# 6. External resource integrity
# ──────────────────────────────────────
echo "[6/8] Checking external resources..."

# CDN without integrity hash
if grep -Pn '<script[^>]+src=' "$FRONTEND" 2>/dev/null | grep -v 'integrity='; then
  add_finding "MEDIUM" "index.html" "CDN without SRI" "External scripts should use subresource integrity (integrity= attribute)"
fi

if grep -Pn '<link[^>]+href=.*cdn' "$FRONTEND" 2>/dev/null | grep -v 'integrity='; then
  add_finding "LOW" "index.html" "CDN CSS without SRI" "External stylesheets from CDN should use integrity attribute"
fi

# ──────────────────────────────────────
# 7. Sensitive data exposure
# ──────────────────────────────────────
echo "[7/8] Checking data exposure..."

if grep -Pn '_debug' "$BACKEND" 2>/dev/null; then
  add_finding "MEDIUM" "Code.gs" "Debug data in response" "_debug field found — should not be in production responses"
fi

if grep -Pn 'console\.\(log\|debug\).*token\|password\|secret\|key' "$FRONTEND" 2>/dev/null; then
  add_finding "MEDIUM" "index.html" "Sensitive data logged" "Tokens or secrets may be logged to browser console"
fi

# ──────────────────────────────────────
# 8. SHEET_ID protection
# ──────────────────────────────────────
echo "[8/8] Checking configuration protection..."

if grep -Pn 'var\s+SHEET_ID\s*=' "$BACKEND" 2>/dev/null; then
  add_finding "HIGH" "Code.gs" "SHEET_ID as global var" "SHEET_ID should be in PropertiesService, not a global variable"
fi

# ──────────────────────────────────────
# Results
# ──────────────────────────────────────
echo ""
echo "=== Scan Complete ==="
echo "Findings: $COUNT"
echo ""

if [ "$COUNT" -gt 0 ]; then
  # Write report for GitHub Actions
  REPORT_FILE="$REPO_ROOT/scripts/last-scan-report.md"
  {
    echo "# SMOS Security Scan Report"
    echo ""
    echo "**Date:** $(date -u '+%Y-%m-%d %H:%M UTC')"
    echo "**Findings:** $COUNT"
    echo ""
    echo "---"
    echo ""
    echo -e "$FINDINGS"
  } > "$REPORT_FILE"
  echo "Report written to $REPORT_FILE"
  exit 1
else
  echo "No issues found."
  exit 0
fi
