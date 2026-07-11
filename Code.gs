function getSheetId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  if (!id) {
    id = "18duKGwDXB0VsDJGQTPI2-HGoOaCPEHiL0g5sPV7U2hE";
    props.setProperty("SHEET_ID", id);
  }
  return id;
}

var ALLOWED_DOMAINS = ["sentbe.com"];
var GOOGLE_CLIENT_ID = "690250277277-otqse7oa1ro37uhut34ja9fp43dmkpge.apps.googleusercontent.com";

function verifyToken_(token) {
  if (!token) return null;
  try {
    var parts = token.split(".");
    if (parts.length !== 3) return null;
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
    if (!payload.email) return null;
    if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") return null;
    var now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    if (payload.aud && payload.aud !== GOOGLE_CLIENT_ID) return null;
    return { email: payload.email.toLowerCase(), domain: payload.email.toLowerCase().split("@")[1] || "" };
  } catch (e) {
    return null;
  }
}

function findInArray_(arr, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = arr.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function readEmailTab_() {
  try {
    var sheet = SpreadsheetApp.openById(getSheetId_()).getSheetByName("email");
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var cols = {
      email: Math.max(0, findInArray_(headers, ["email"])),
      name: findInArray_(headers, ["name"]),
      subscribe: findInArray_(headers, ["subscribe", "sub"]),
      team: findInArray_(headers, ["team", "type"]),
      role: findInArray_(headers, ["role"])
    };
    var rows = [];
    for (var r = 1; r < data.length; r++) {
      var em = String(data[r][cols.email]).trim().toLowerCase();
      if (!em || em.indexOf("@") < 0) continue;
      rows.push({
        email: em,
        name: cols.name >= 0 ? String(data[r][cols.name]).trim() : "",
        subscribe: cols.subscribe >= 0 ? String(data[r][cols.subscribe]).trim().toUpperCase() === "Y" : true,
        team: cols.team >= 0 ? String(data[r][cols.team]).trim().toLowerCase() : "ops",
        role: cols.role >= 0 ? String(data[r][cols.role]).trim().toLowerCase() || "viewer" : "viewer"
      });
    }
    return rows;
  } catch (e) { return []; }
}

function isAuthorized_(email) {
  var domain = email.split("@")[1] || "";
  for (var i = 0; i < ALLOWED_DOMAINS.length; i++) {
    if (domain === ALLOWED_DOMAINS[i]) return true;
  }
  var users = readEmailTab_();
  for (var j = 0; j < users.length; j++) {
    if (users[j].email === email) return true;
  }
  return false;
}

function escHtml_(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

var MAP = {
  KRW: {
    tab: "KRW",
    fields: {
      client: "Client",
      name: "Sub- Merchant Name",
      merchantId: "Merchant ID",
      requestDate: ["Initial inquiry date", "Request Date", "Inquiry Date"],
      ticket: "Ticket URL",
      status: "Onboarding Status",
      kybReason: "KYB Failed Reason",
      va: "VA",
      vaStatus: "VA Status",
      note: "Onboarding Note"
    }
  },
  VND: {
    tab: "VND",
    requiredCol: 1,
    fields: {
      merchantId: "Merchant ID",
      name: "Merchant Entity Name",
      fiMerchant: "FI Merchant",
      fiPartner: "FI Partner",
      requestDate: ["Date of Onboarding KYC", "Submission Request Date", "Request Date"],
      status: "Onboarding Status",
      va: "Assigned VA number",
      vaDate: "VA Issuance Date",
      kycDate: "Date of Onboarding KYC",
      jira: "Jira Link (for tracking)"
    }
  }
};

var VERSION = "2026-07-12-auth-v2";  // 배포 확인용 마커. 재배포하면 이 값이 응답에 실림.

function norm(s) {
  return String(s).toLowerCase().replace(/\(for tracking\)/g, "").replace(/[-\s]+/g, " ").trim();
}

// 헤더명 후보(문자열 또는 배열)를 받아 첫 번째로 일치하는 컬럼 index 반환
function findCol_(headers, spec) {
  var names = (typeof spec === "string") ? [spec] : spec;
  for (var i = 0; i < names.length; i++) {
    var j = headers.indexOf(norm(names[i]));
    if (j >= 0) return j;
  }
  return -1;
}

function readTab(cfg, dbg) {
  var sh = SpreadsheetApp.openById(getSheetId_()).getSheetByName(cfg.tab);
  if (!sh) { if (dbg) dbg.error = "tab not found: " + cfg.tab; return []; }
  var range = sh.getDataRange();
  var vals = range.getValues();
  if (vals.length < 2) return [];
  var formulas = range.getFormulas();

  var headers = vals[0].map(norm);
  var idx = {};
  for (var f in cfg.fields) {
    var i = findCol_(headers, cfg.fields[f]);
    if (i >= 0) idx[f] = i;
  }
  if (dbg) { dbg.rawHeaders = vals[0]; dbg.matched = Object.keys(idx); }

  var tz = Session.getScriptTimeZone();
  var out = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    if (cfg.requiredCol != null && !String(row[cfg.requiredCol]).trim()) continue;
    var o = { id: cfg.tab + "-" + r };
    var has = false;
    for (var key in idx) {
      var ci = idx[key];
      var raw = row[ci];
      var v;
      if (raw instanceof Date) {
        v = Utilities.formatDate(raw, tz, "yyyy-MM-dd");
      } else {
        v = (raw == null ? "" : String(raw)).trim();
        var formula = formulas[r][ci];
        if (formula) {
          var m = formula.match(/^=HYPERLINK\s*\(\s*"([^"]+)"/i);
          if (m) v = m[1];
        }
      }
      o[key] = v;
      if (v) has = true;
    }
    if (has && (o.name || o.merchantId)) out.push(o);
  }
  return out;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) || "";
  var user = verifyToken_(token);
  if (!user) return jsonOut_({ error: "forbidden", message: "Invalid or expired token" });
  if (!isAuthorized_(user.email)) return jsonOut_({ error: "forbidden", message: "Not authorized" });

  var userInfo = { email: user.email, role: "viewer" };
  var users = readEmailTab_();
  for (var i = 0; i < users.length; i++) {
    if (users[i].email === user.email) { userInfo.role = users[i].role; break; }
  }

  var data = { KRW: readTab(MAP.KRW, {}), VND: readTab(MAP.VND, {}) };
  data._version = VERSION;
  data._user = userInfo;
  return jsonOut_(data);
}

/* ---- 지라 링크 변환: 리치텍스트 → 실제 URL ---- */
function syncJiraLinks() {
  var sh = SpreadsheetApp.openById(getSheetId_()).getSheetByName("VND");
  var vals = sh.getDataRange().getValues();
  var headers = vals[0];
  var jiraCol = -1;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c]).toLowerCase().indexOf("jira") >= 0) { jiraCol = c; break; }
  }
  if (jiraCol < 0) { Logger.log("Jira column not found"); return; }
  var count = 0;
  for (var r = 1; r < vals.length; r++) {
    var val = String(vals[r][jiraCol]).trim();
    if (val && !/^https?:\/\//i.test(val)) {
      var rt = sh.getRange(r + 1, jiraCol + 1).getRichTextValue();
      if (rt) {
        var link = rt.getLinkUrl();
        if (link) {
          sh.getRange(r + 1, jiraCol + 1).setValue(link);
          count++;
        }
      }
    }
  }
  Logger.log("Updated " + count + " Jira links to plain URLs");
}

var MAX_RECIPIENTS = 30;

function validateEmail_(raw) {
  var e = String(raw).trim().toLowerCase();
  if (/[,;\s]/.test(e)) return null;
  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e)) return null;
  var domain = e.split("@")[1];
  for (var i = 0; i < ALLOWED_DOMAINS.length; i++) {
    if (domain === ALLOWED_DOMAINS[i]) return e;
  }
  return null;
}

/* ---- 주간 보고 이메일 자동 발송 ---- */
function sendWeeklyReport() {
  var users = readEmailTab_();
  if (!users.length) { Logger.log("email tab empty or not found"); return; }

  var byType = { ops: [], sales: [] };
  var skipped = [];
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    if (!u.subscribe) continue;
    var validated = validateEmail_(u.email);
    if (!validated) { skipped.push(u.email); continue; }
    if (u.team === "sales") byType.sales.push(validated);
    else byType.ops.push(validated);
  }
  if (skipped.length) Logger.log("Skipped invalid/external emails: " + skipped.join(", "));

  var totalRecipients = byType.ops.length + byType.sales.length;
  if (totalRecipients > MAX_RECIPIENTS) {
    Logger.log("ABORT: " + totalRecipients + " recipients exceeds limit of " + MAX_RECIPIENTS);
    return;
  }

  var types = ["ops", "sales"];
  var total = 0, failures = [];
  for (var t = 0; t < types.length; t++) {
    var list = byType[types[t]];
    if (!list.length) continue;
    var report = buildEmailReport_(types[t]);
    for (var j = 0; j < list.length; j++) {
      try {
        MailApp.sendEmail({ to: list[j], subject: report.subject, body: report.plain, htmlBody: report.html, name: "SMOS" });
        total++;
      } catch (e) {
        failures.push(list[j]);
        Logger.log("Failed: " + list[j] + " " + e);
      }
    }
  }
  var summary = "Weekly report sent to " + total + "/" + totalRecipients + " (ops:" + byType.ops.length + " sales:" + byType.sales.length + ")";
  if (failures.length) summary += " | FAILED: " + failures.join(", ");
  Logger.log(summary);
}

function buildEmailReport_(type) {
  var isOps = (type !== "sales");
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var day = now.getDay();
  var mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7) - 7);
  var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  var prevMon = new Date(mon); prevMon.setDate(mon.getDate() - 7);
  var prevSun = new Date(prevMon); prevSun.setDate(prevMon.getDate() + 6);
  var fmt = function(d) { return Utilities.formatDate(d, tz, "yyyy-MM-dd"); };
  var period = fmt(mon) + " ~ " + fmt(sun);
  var subject = "[SMOS] Weekly Onboarding " + (isOps ? "Report" : "Update") + " (" + period + ")";

  var corridors = [
    { key:"KRW", success:["Succeeded"], inprog:["KYC","Ops confirming"], statuses:[{v:"KYC",color:"#D99A0B"},{v:"Ops confirming",color:"#3176FD"},{v:"Succeeded",color:"#00C592"},{v:"Failed",color:"#E5533F"}], fail:["Failed"], gf:"client" },
    { key:"VND", success:["Approved"], inprog:["In progress"], statuses:[{v:"In progress",color:"#D99A0B"},{v:"Approved",color:"#00C592"},{v:"Rejected / Offboarded",color:"#E5533F"}], fail:["Rejected / Offboarded"], gf:"fiMerchant" }
  ];

  var plain = "";
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#F2F6FF;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;">';
  html += '<div style="max-width:640px;margin:0 auto;padding:24px 16px;">';
  html += '<div style="text-align:center;padding:20px 0 16px;">';
  html += '<span style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#3176FD;background:#E8EEFF;padding:5px 12px;border-radius:6px;">SMOS</span>';
  html += '<h1 style="font-size:20px;font-weight:700;color:#1A1D29;margin:12px 0 4px;">Weekly Onboarding ' + (isOps ? 'Report' : 'Update') + '</h1>';
  html += '<p style="font-size:13px;color:#8A95B5;margin:0;">' + period + '</p>';
  html += '</div>';

  corridors.forEach(function(c) {
    var rows = readTab(MAP[c.key], {});
    var start = fmt(mon), end = fmt(sun), prevStart = fmt(prevMon), prevEnd = fmt(prevSun);
    var weekRows = rows.filter(function(r) { return r.requestDate && r.requestDate >= start && r.requestDate <= end; });
    var prevWeekRows = rows.filter(function(r) { return r.requestDate && r.requestDate >= prevStart && r.requestDate <= prevEnd; });
    var totalAppr = rows.filter(function(r) { return c.success.indexOf(r.status) >= 0; }).length;
    var totalRate = rows.length ? Math.round(totalAppr / rows.length * 100) : 0;
    var weekAppr = weekRows.filter(function(r) { return c.success.indexOf(r.status) >= 0; }).length;
    var weekRate = weekRows.length ? Math.round(weekAppr / weekRows.length * 100) : 0;
    var weekDiff = weekRows.length - prevWeekRows.length;
    var diffStr = weekDiff > 0 ? "+" + weekDiff : String(weekDiff);
    var diffColor = weekDiff > 0 ? "#00C592" : weekDiff < 0 ? "#E5533F" : "#8A95B5";

    var statusMap = {};
    rows.forEach(function(r) { var s = r.status || "—"; statusMap[s] = (statusMap[s] || 0) + 1; });
    var weekStatusMap = {};
    weekRows.forEach(function(r) { var s = r.status || "—"; weekStatusMap[s] = (weekStatusMap[s] || 0) + 1; });

    var weekFailRows = weekRows.filter(function(r) { return c.fail.indexOf(r.status) >= 0; });
    var attnRows = rows.filter(function(r) { return c.fail.indexOf(r.status) >= 0; });

    if (isOps) {
      // ===== OPS REPORT (unchanged) =====
      var clientMap = {};
      rows.forEach(function(r) {
        var g = r[c.gf] || "(Unassigned)";
        if (!clientMap[g]) clientMap[g] = { t:0, a:0, w:0 };
        clientMap[g].t++; if (c.success.indexOf(r.status) >= 0) clientMap[g].a++;
      });
      weekRows.forEach(function(r) {
        var g = r[c.gf] || "(Unassigned)";
        if (!clientMap[g]) clientMap[g] = { t:0, a:0, w:0 };
        clientMap[g].w++;
      });

      plain += "━━ [" + c.key + "] ━━\nPeriod: " + period + "\n";
      plain += "Total " + rows.length + " / This week " + weekRows.length + " (" + diffStr + " vs prev week)\n";
      plain += "Approval: Total " + totalRate + "% (" + totalAppr + "/" + rows.length + ")";
      if (weekRows.length) plain += " / This week " + weekRate + "% (" + weekAppr + "/" + weekRows.length + ")";
      plain += "\n\nStatus: ";
      c.statuses.forEach(function(s) { plain += s.v + " " + (statusMap[s.v]||0) + "  "; });
      plain += "\n\nBy Client:\n";
      Object.keys(clientMap).sort(function(a,b){return clientMap[b].t-clientMap[a].t;}).forEach(function(n) {
        var o = clientMap[n], r = o.t ? Math.round(o.a/o.t*100) : 0;
        plain += "  " + n + ": " + o.t + " (Approved " + r + "%) This week +" + o.w + "\n";
      });
      if (attnRows.length) {
        plain += "\nAttention Needed:\n";
        attnRows.slice(0,10).forEach(function(r) { plain += "  - " + (r.name||"—") + " · " + r.status + "\n"; });
      }
      plain += "\n";

      html += '<div style="background:#fff;border:1px solid #D6E2F8;border-radius:14px;margin:16px 0;overflow:hidden;box-shadow:0 1px 3px rgba(18,38,102,.06);">';
      html += '<div style="background:#1A1D29;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
      html += '<span style="font-size:16px;font-weight:700;">' + c.key + ' Onboarding Status</span>';
      html += '<span style="font-size:12px;opacity:.7;">' + period + '</span></div>';
      html += '<div style="display:flex;padding:16px 12px 8px;">';
      html += '<div style="flex:1;text-align:center;padding:8px;"><div style="font-size:11px;color:#8A95B5;font-weight:600;">Total</div><div style="font-size:28px;font-weight:800;color:#1A1D29;">' + rows.length + '</div><div style="font-size:10px;color:#8A95B5;">cases</div></div>';
      html += '<div style="flex:1;text-align:center;padding:8px;border-left:1px solid #D6E2F8;"><div style="font-size:11px;color:#8A95B5;font-weight:600;">This Week</div><div style="font-size:28px;font-weight:800;color:#3176FD;">' + weekRows.length + '</div><div style="font-size:10px;color:' + diffColor + ';font-weight:700;">' + diffStr + ' vs prev</div></div>';
      html += '<div style="flex:1;text-align:center;padding:8px;border-left:1px solid #D6E2F8;"><div style="font-size:11px;color:#8A95B5;font-weight:600;">Approval</div><div style="font-size:28px;font-weight:800;color:#00C592;">' + totalRate + '%</div><div style="font-size:10px;color:#8A95B5;">' + totalAppr + '/' + rows.length + '</div></div>';
      html += '</div>';
      if (weekRows.length) {
        html += '<div style="padding:0 20px 12px;text-align:center;"><span style="font-size:11px;color:#8A95B5;">Weekly Approval: </span><span style="font-size:13px;font-weight:700;color:#00C592;">' + weekRate + '% (' + weekAppr + '/' + weekRows.length + ')</span></div>';
      }
      html += '<div style="padding:4px 20px 12px;"><div style="font-size:12px;font-weight:700;color:#3D5080;margin-bottom:8px;">Status Breakdown</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<tr style="border-bottom:1px solid #D6E2F8;"><th style="text-align:left;padding:6px 8px;color:#8A95B5;font-weight:600;">Status</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">Total</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">This Week</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">Ratio</th></tr>';
      c.statuses.forEach(function(s) {
        var n = statusMap[s.v] || 0, wn = weekStatusMap[s.v] || 0, pct = rows.length ? Math.round(n / rows.length * 100) : 0;
        html += '<tr style="border-bottom:1px solid #F2F6FF;"><td style="padding:7px 8px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + s.color + ';margin-right:6px;vertical-align:middle;"></span>' + escHtml_(s.v) + '</td>';
        html += '<td style="padding:7px 8px;text-align:right;font-weight:600;">' + n + '</td><td style="padding:7px 8px;text-align:right;font-weight:600;color:#3176FD;">' + (wn || '-') + '</td><td style="padding:7px 8px;text-align:right;color:#8A95B5;">' + pct + '%</td></tr>';
      });
      html += '</table></div>';
      var clientKeys = Object.keys(clientMap).sort(function(a,b){return clientMap[b].t - clientMap[a].t;});
      html += '<div style="padding:4px 20px 12px;"><div style="font-size:12px;font-weight:700;color:#3D5080;margin-bottom:8px;">By Client</div>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
      html += '<tr style="border-bottom:1px solid #D6E2F8;"><th style="text-align:left;padding:6px 8px;color:#8A95B5;font-weight:600;">Client</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">Total</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">Approved</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">Rate</th><th style="text-align:right;padding:6px 8px;color:#8A95B5;font-weight:600;">This Week</th></tr>';
      clientKeys.forEach(function(n) {
        var o = clientMap[n], r = o.t ? Math.round(o.a/o.t*100) : 0, barW = Math.max(r,2);
        html += '<tr style="border-bottom:1px solid #F2F6FF;"><td style="padding:7px 8px;font-weight:600;">' + escHtml_(n) + '</td><td style="padding:7px 8px;text-align:right;">' + o.t + '</td>';
        html += '<td style="padding:7px 8px;text-align:right;color:#00C592;font-weight:600;">' + o.a + '</td>';
        html += '<td style="padding:7px 8px;text-align:right;"><div style="display:inline-block;width:40px;height:6px;background:#F2F6FF;border-radius:3px;vertical-align:middle;margin-right:4px;"><div style="width:' + barW + '%;height:100%;background:#00C592;border-radius:3px;"></div></div><span style="font-weight:600;">' + r + '%</span></td>';
        html += '<td style="padding:7px 8px;text-align:right;color:#3176FD;font-weight:600;">' + (o.w || '-') + '</td></tr>';
      });
      html += '</table></div>';
      if (attnRows.length) {
        html += '<div style="padding:4px 20px 16px;"><div style="font-size:12px;font-weight:700;color:#E5533F;margin-bottom:8px;">Attention Needed (' + attnRows.length + ')</div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<tr style="border-bottom:1px solid #D6E2F8;"><th style="text-align:left;padding:5px 8px;color:#8A95B5;font-weight:600;">Merchant</th><th style="text-align:left;padding:5px 8px;color:#8A95B5;font-weight:600;">MID</th><th style="text-align:left;padding:5px 8px;color:#8A95B5;font-weight:600;">Status</th></tr>';
        attnRows.slice(0,15).forEach(function(r) {
          var reason = r.kybReason || "";
          html += '<tr style="border-bottom:1px solid #F2F6FF;"><td style="padding:6px 8px;">' + escHtml_(r.name||"—") + '</td><td style="padding:6px 8px;font-size:11px;color:#8A95B5;">' + escHtml_(r.merchantId||"-") + '</td>';
          html += '<td style="padding:6px 8px;"><span style="font-size:11px;font-weight:600;color:#E5533F;background:#FCEBEA;padding:2px 6px;border-radius:4px;">' + escHtml_(r.status) + '</span>';
          if (reason) html += ' <span style="font-size:10px;color:#8A95B5;">' + escHtml_(reason) + '</span>';
          html += '</td></tr>';
        });
        if (attnRows.length > 15) html += '<tr><td colspan="3" style="padding:6px 8px;color:#8A95B5;font-size:11px;">... +' + (attnRows.length-15) + ' more</td></tr>';
        html += '</table></div>';
      }
      html += '</div>';

    } else {
      // ===== SALES REPORT (client-card layout) =====
      var clientData = {};
      rows.forEach(function(r) {
        var g = r[c.gf] || "(Unassigned)";
        if (!clientData[g]) clientData[g] = { t:0, completed:0, inprog:0, rows:[] };
        clientData[g].t++;
        if (c.success.indexOf(r.status) >= 0) clientData[g].completed++;
        else if (c.inprog.indexOf(r.status) >= 0) clientData[g].inprog++;
        clientData[g].rows.push(r);
      });
      var weekFailByClient = {};
      weekFailRows.forEach(function(r) {
        var g = r[c.gf] || "(Unassigned)";
        if (!weekFailByClient[g]) weekFailByClient[g] = [];
        weekFailByClient[g].push(r);
      });
      var totalFollowUp = weekFailRows.length;

      plain += "━━ [" + c.key + "] ━━\nPeriod: " + period + "\n";
      plain += "Total " + rows.length + " merchants / This week " + weekRows.length + " new\n";
      if (totalFollowUp) plain += "Follow-up needed: " + totalFollowUp + "\n";
      plain += "\nBy Client:\n";
      Object.keys(clientData).sort(function(a,b){return clientData[b].t-clientData[a].t;}).forEach(function(n) {
        var o = clientData[n];
        var wf = weekFailByClient[n] || [];
        plain += "  " + n + " (" + o.t + "): " + o.completed + " completed, " + o.inprog + " in progress";
        if (wf.length) plain += ", " + wf.length + " need follow-up";
        plain += "\n";
        wf.forEach(function(r) { plain += "    - " + (r.name||"—") + " · " + r.status + "\n"; });
      });
      plain += "\n";

      html += '<div style="background:#fff;border:1px solid #D6E2F8;border-radius:14px;margin:16px 0;overflow:hidden;box-shadow:0 1px 3px rgba(18,38,102,.06);">';
      html += '<div style="background:#1A1D29;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;">';
      html += '<span style="font-size:16px;font-weight:700;">' + c.key + ' Onboarding Update</span>';
      html += '<span style="font-size:12px;opacity:.7;">' + period + '</span></div>';

      html += '<div style="display:flex;padding:16px 12px 12px;">';
      html += '<div style="flex:1;text-align:center;padding:8px;"><div style="font-size:11px;color:#8A95B5;font-weight:600;">Total</div><div style="font-size:28px;font-weight:800;color:#1A1D29;">' + rows.length + '</div><div style="font-size:10px;color:#8A95B5;">merchants</div></div>';
      html += '<div style="flex:1;text-align:center;padding:8px;border-left:1px solid #D6E2F8;"><div style="font-size:11px;color:#8A95B5;font-weight:600;">This Week</div><div style="font-size:28px;font-weight:800;color:#3176FD;">' + weekRows.length + '</div><div style="font-size:10px;color:#8A95B5;">new submissions</div></div>';
      html += '<div style="flex:1;text-align:center;padding:8px;border-left:1px solid #D6E2F8;"><div style="font-size:11px;color:#8A95B5;font-weight:600;">Follow-up</div><div style="font-size:28px;font-weight:800;color:' + (totalFollowUp ? '#E5533F' : '#00C592') + ';">' + totalFollowUp + '</div><div style="font-size:10px;color:#8A95B5;">this week</div></div>';
      html += '</div>';

      html += '<div style="padding:0 16px 16px;">';
      var cKeys = Object.keys(clientData).sort(function(a,b){return clientData[b].t - clientData[a].t;});
      cKeys.forEach(function(n) {
        var o = clientData[n];
        var wf = weekFailByClient[n] || [];
        var compPct = o.t ? Math.round(o.completed / o.t * 100) : 0;
        var ipPct = o.t ? Math.round(o.inprog / o.t * 100) : 0;
        var failPct = 100 - compPct - ipPct;
        if (failPct < 0) failPct = 0;

        html += '<div style="border:1px solid #D6E2F8;border-radius:10px;margin-bottom:10px;overflow:hidden;">';
        html += '<div style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;background:#F8FAFF;">';
        html += '<span style="font-weight:700;font-size:13px;color:#1A1D29;">' + escHtml_(n) + '</span>';
        html += '<span style="font-size:12px;color:#8A95B5;">' + o.t + ' merchants</span></div>';

        html += '<div style="padding:10px 14px;">';
        html += '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">';
        if (o.completed) html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#E6F9F3;color:#0F6E56;">&#10003; ' + o.completed + ' completed</span>';
        if (o.inprog) html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#E8EEFF;color:#3176FD;">&#9679; ' + o.inprog + ' in progress</span>';
        if (wf.length) html += '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#FCEBEA;color:#E5533F;">&#9888; ' + wf.length + ' follow-up</span>';
        html += '</div>';

        html += '<div style="height:5px;border-radius:3px;background:#F2F6FF;display:flex;overflow:hidden;gap:1px;">';
        if (compPct) html += '<div style="width:' + compPct + '%;background:#00C592;border-radius:3px 0 0 3px;"></div>';
        if (ipPct) html += '<div style="width:' + ipPct + '%;background:#3176FD;"></div>';
        if (failPct) html += '<div style="width:' + failPct + '%;background:#E5533F;border-radius:0 3px 3px 0;"></div>';
        html += '</div></div>';

        if (wf.length) {
          html += '<div style="border-top:1px solid #D6E2F8;padding:8px 14px;background:#FEF6F5;">';
          html += '<div style="font-size:11px;font-weight:700;color:#E5533F;margin-bottom:4px;">&#9888; Follow-up needed this week</div>';
          wf.forEach(function(r) {
            html += '<div style="font-size:12px;padding:2px 0;display:flex;justify-content:space-between;">';
            html += '<span style="color:#1A1D29;">' + escHtml_(r.name||"—") + '</span>';
            html += '<span style="font-size:11px;color:#E5533F;">' + escHtml_(r.status) + '</span></div>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
      html += '</div></div>';
    }
  });

  // Footer
  html += '<div style="text-align:center;padding:20px 0 8px;">';
  html += '<a href="https://sentbejack.github.io/smos/" style="display:inline-block;background:#3176FD;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 24px;border-radius:8px;">Open SMOS Dashboard</a>';
  html += '</div>';
  html += '<p style="text-align:center;font-size:11px;color:#8A95B5;padding:8px 0 16px;">This email was automatically sent by SMOS.</p>';
  html += '</div></body></html>';

  plain += "━━━━━━━━━━━━━━━━━━━━━━━━\nThis email was automatically sent by SMOS.\nhttps://sentbejack.github.io/smos/\n";
  return { subject: subject, plain: plain, html: html };
}

function createWeeklyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "sendWeeklyReport") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("sendWeeklyReport")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .nearMinute(0)
    .inTimezone("Asia/Seoul")
    .create();
  Logger.log("Weekly trigger created: Monday 09:00 KST");
}
