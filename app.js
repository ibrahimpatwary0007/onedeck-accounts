"use strict";
/* OneDeck — accounts app (data Google Sheet e, server Apps Script) */

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const tk = n => { n = Math.round(num(n)); if (!n) return "–"; return (n < 0 ? "−" : "") + "৳" + nf.format(Math.abs(n)); };
const pad = n => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fdate = s => { if (!s || !/^\d{4}-\d\d-\d\d/.test(s)) return esc(s || ""); const [y, m, d] = s.slice(0, 10).split("-"); return `${d} ${MONTHS[+m - 1]} ${y}`; };
const pct = x => (x === "" || x == null || !isFinite(x)) ? "" : (x * 100).toFixed(1) + "%";
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { } } };

const GROUPS_OUT = ["Direct Cost", "Operating Expense", "Owner Drawings"];
const INV_TYPES = ["Fund Received", "Capital Return", "Profit Paid", "Previous Debt"];
const PSEUDO = { "Investment": { type: "in", inv: "Fund Received" }, "Investment Return": { type: "out", inv: "Capital Return" } };
const ROUTES = [["entry", "Notun entry"], ["dashboard", "Dashboard"], ["ledger", "Daily Ledger"], ["projects", "Projects"], ["clients", "Clients"], ["vendors", "Vendors"], ["investors", "Investors"], ["monthly", "Monthly"], ["more", "Settings"]];
const EMPTY = { ledger: [], inv: [], projects: [], clients: [], vendors: [], bills: [], investors: [], accounts: [], setup: { categories: [], accounts: [], statuses: [] }, sheetUrl: "" };

const S = {
  user: store.get("aa-user") || "", token: store.get("aa-token") || "", pin: store.get("aa-pin") || "",
  d: EMPTY, loaded: false, syncing: false, syncErr: "", lastSync: 0,
  f: { period: store.get("aa-period") || "month", from: "", to: "", year: new Date().getFullYear(), lq: "", lacc: "", lmonth: "" }
};
try { const c = JSON.parse(store.get("aa-cache") || "null"); if (c && c.ledger) { S.d = c; S.loaded = true; } } catch { }

/* ---------- server ---------- */
async function api(action, payload = {}) {
  if (window.MOCK_API) return window.MOCK_API(action, payload);
  if (!window.API_URL) throw new Error("config.js e API_URL bosano hoyni.");
  const call = async () => {
    const res = await fetch(window.API_URL, { method: "POST", body: JSON.stringify({ action, idToken: S.token, pin: S.pin, ...payload }) });
    let j; try { j = await res.json(); } catch { throw new Error("Server theke uttor ashe nai. Internet check korun."); }
    if (!j.ok) { const e = new Error(j.error || "Kichu ekta gondogol hoyeche."); e.code = (j.error || "").split(":")[0]; throw e; }
    return j.data;
  };
  try { return await call(); }
  catch (e) {
    if (e.code === "LOGIN_EXPIRED" || e.code === "LOGIN_REQUIRED") { if (await silentLogin()) return call(); logout("Login er meyad shesh — abar Google diye login korun."); throw new Error("Abar login korun."); }
    if (e.code === "BAD_PIN" || e.code === "PIN_REQUIRED") { S.pin = ""; store.set("aa-pin", null); S.user = ""; store.set("aa-user", null); loginErr = e.code === "BAD_PIN" ? "PIN thik na. Abar din." : ""; render(); throw new Error(loginErr || "PIN din."); }
    if (e.code === "NO_PIN") { logout("Ei account er PIN ekhono set kora hoyni. Owner ke bolun Users tab er PIN column e PIN boshate."); throw new Error("PIN nei."); }
    if (e.code === "NO_ACCESS") { logout(`${e.message.split(":")[1] || "Ei account"} er access nei. Owner ke bolun Users tab e apnar Gmail add korte.`); throw new Error("Access nei."); }
    throw e;
  }
}
/* ---------- Google login ---------- */
let gisReady = false, silentWait = null;
function gisInit() {
  if (gisReady || !window.google?.accounts?.id || !window.CLIENT_ID) return;
  google.accounts.id.initialize({ client_id: window.CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true });
  gisReady = true; if (!S.user) render();
}
window.addEventListener("load", () => { const t = setInterval(() => { if (window.google?.accounts?.id) { clearInterval(t); gisInit(); } }, 200); setTimeout(() => clearInterval(t), 15000); });
function onCredential(resp) {
  S.token = resp.credential; store.set("aa-token", S.token);
  if (silentWait) { const w = silentWait; silentWait = null; w(true); return; }
  loginErr = ""; render(); setTimeout(() => $("#lg-pin")?.focus(), 0);
}
function silentLogin() {
  if (!gisReady) return Promise.resolve(false);
  return new Promise(ok => {
    silentWait = ok;
    google.accounts.id.prompt(n => { if ((n.isNotDisplayed && n.isNotDisplayed()) || (n.isSkippedMoment && n.isSkippedMoment())) { if (silentWait) { silentWait = null; ok(false); } } });
    setTimeout(() => { if (silentWait) { silentWait = null; ok(false); } }, 20000);
  });
}
let loadSeq = 0;
async function refresh(silent) {
  if (!S.user) return;
  const my = ++loadSeq; S.syncing = true; S.syncErr = ""; drawSync();
  try {
    const d = await api("load");
    if (my !== loadSeq) return;
    S.d = { ...EMPTY, ...d }; S.loaded = true; S.lastSync = Date.now();
    store.set("aa-cache", JSON.stringify(S.d));
  } catch (e) {
    S.syncErr = e.message;
    if (!S.user) return;
  } finally { if (my === loadSeq) { S.syncing = false; drawSync(); } }
  if (F || (route() === "entry" && document.activeElement && document.activeElement.closest("#quick"))) { updateRecent(); return; }
  if (!silent || !Q.cal && !Q.catOpen) render();
}
function drawSync() {
  const el = $("#sync"); if (!el || !S.user) return; el.hidden = false;
  el.className = "sync" + (S.syncing ? " busy" : S.syncErr ? " err" : "");
  el.lastChild.textContent = S.syncing ? "Sync…" : S.syncErr ? "Offline" : "Synced";
  el.title = S.syncErr || (S.lastSync ? "Shesh sync " + new Date(S.lastSync).toLocaleTimeString() : "");
}
function logout(msg) { S.user = S.token = S.pin = ""; loginErr = msg || ""; store.set("aa-user", null); store.set("aa-token", null); store.set("aa-pin", null); store.set("aa-cache", null); S.d = EMPTY; S.loaded = false; if (gisReady && !msg) google.accounts.id.disableAutoSelect(); render(); }

/* ---------- derived ---------- */
const cats = () => S.d.setup.categories || [];
const catOf = name => cats().find(c => c.name === name);
const grp = row => catOf(row.category)?.group || (num(row.in) ? "Other Income" : "Operating Expense");
function periodRange() {
  const f = S.f, t = today(), y = +t.slice(0, 4), m = +t.slice(5, 7);
  if (f.period === "month") return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-31`];
  if (f.period === "last") { const d = new Date(y, m - 2, 1); return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-31`]; }
  if (f.period === "year") return [`${y}-01-01`, `${y}-12-31`];
  if (f.period === "custom") return [f.from || "0000-01-01", f.to || "9999-12-31"];
  return ["0000-01-01", "9999-12-31"];
}
function sums(from, to) {
  const r = { rev: 0, oth: 0, dc: 0, opex: 0, draw: 0, fund: 0, payout: 0, cin: 0, cout: 0, sample: 0 };
  const inP = d => d >= from && d <= to;
  for (const e of S.d.ledger) {
    if (!inP(e.date || "")) continue; const g = grp(e); if (g === "Transfer") continue;
    const i = num(e.in), o = num(e.out); r.cin += i; r.cout += o;
    if (g === "Revenue") r.rev += i; else r.oth += i;
    if (g === "Direct Cost") r.dc += o; else if (g === "Owner Drawings") r.draw += o; else r.opex += o;
    if (e.category === "Sample Development") r.sample += o;
  }
  for (const x of S.d.inv) {
    if (!inP(x.date || "")) continue; const a = num(x.amount);
    if (x.type === "Fund Received") { r.fund += a; r.cin += a; } else if (x.type === "Capital Return" || x.type === "Profit Paid") { r.payout += a; r.cout += a; }
  }
  r.gross = r.rev - r.dc; r.net = r.rev + r.oth - r.dc - r.opex; r.flow = r.cin - r.cout; return r;
}
const sortDesc = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.r || 0) - (a.r || 0);

/* ---------- shell ---------- */
const route = () => { const h = location.hash.slice(1); return ROUTES.some(r => r[0] === h) ? h : "entry"; };
let menuOpen = false;
function renderMenu() {
  const wrap = $("#menu-wrap"); wrap.hidden = !S.user; if (!S.user) return;
  const r = route(); $("#menu-label").textContent = ROUTES.find(x => x[0] === r)[1];
  const m = $("#menu"); m.innerHTML = ROUTES.map(([k, l], i) => `${i === 1 ? "<hr>" : ""}<a href="#${k}" ${k === r ? 'aria-current="page"' : ""}>${l}</a>`).join("");
  m.hidden = !menuOpen; $("#menu-btn").setAttribute("aria-expanded", String(menuOpen));
}
function render() {
  renderMenu(); drawSync();
  if (!S.user) { $("#main").innerHTML = vLogin(); return; }
  if (!S.loaded) { $("#main").innerHTML = `<div class="empty">${S.syncErr ? esc(S.syncErr) + ` <button class="link" data-act="retry">Abar chesta korun</button>` : "Data load hocche…"}</div>`; return; }
  const r = route();
  $("#main").innerHTML = ({ entry: vEntry, dashboard: vDash, ledger: vLedger, projects: vProjects, clients: vClients, vendors: vVendors, investors: vInvestors, monthly: vMonthly, more: vMore }[r])();
}
const addBtn = (kind, label, primary = true) => `<button class="${primary ? "primary" : ""}" data-act="new" data-kind="${kind}">+ ${label}</button>`;
const files = row => (row.files || []).length ? `<span class="clip" title="${row.files.length} file">${CLIP}${row.files.length}</span>` : "";
const CLIP = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/></svg>`;
const CHEV = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
const CAL_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;

/* ---------- login ---------- */
let loginErr = "", loginBusy = false;
function vLogin() {
  setTimeout(() => { const el = $("#gbtn"); if (el && gisReady && !el.childElementCount) google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "signin_with", shape: "pill", width: 280 }); }, 0);
  const email = tokenEmail();
  if (S.token && email) return `<section class="panel login"><h2>PIN din</h2><p class="note">Google account: <strong>${esc(email)}</strong></p>
  <label class="f"><span>PIN</span><input id="lg-pin" type="password" inputmode="numeric" autocomplete="current-password"></label>
  ${loginErr ? `<p class="err-msg" role="alert">${esc(loginErr)}</p>` : ""}
  <button class="primary big" data-act="pin-go" ${loginBusy ? "disabled" : ""}>${loginBusy ? "Checking…" : "Login"}</button>
  <button class="link" data-act="switch-acc">Onno Google account diye login</button></section>`;
  return `<section class="panel login"><h2>Login</h2><p class="note">Prothome Gmail diye login, tarpor PIN. Shudhu je account gula ke owner access diyeche, tara i dhukte parbe.</p>
  <div id="gbtn" style="min-height:44px">${gisReady ? "" : `<span class="note">Google login load hocche…</span>`}</div>
  ${loginBusy ? `<p class="note">Checking…</p>` : ""}
  ${loginErr ? `<p class="err-msg" role="alert">${esc(loginErr)}</p>` : ""}
  ${window.API_URL || window.MOCK_API ? "" : `<p class="err-msg">config.js e API_URL bosano hoyni.</p>`}</section>`;
}
function tokenEmail() { try { return JSON.parse(atob(S.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch { return ""; } }
async function doLogin() {
  const p = $("#lg-pin")?.value.trim(); if (!p) { loginErr = "PIN din."; return render(); }
  S.pin = p; loginBusy = true; loginErr = ""; render();
  try { const r = await api("login"); S.user = r.name; store.set("aa-user", S.user); store.set("aa-pin", S.pin); loginBusy = false; render(); refresh(); }
  catch (e) { loginBusy = false; if (!loginErr) loginErr = e.message; render(); }
}

/* ---------- quick entry ---------- */
const Q = { date: today(), category: "", desc: "", amount: "", notes: "", account: store.get("aa-acc") || "", pid: "", vendor: "", investor: "", party: "", more: false, err: "", busy: false, cal: null, catOpen: false, files: [], uploading: 0 };
function vEntry() { return `<section class="panel quick" id="quick">${quickInner()}</section><section class="quick" id="recent" style="display:grid;gap:10px">${recentHtml()}</section>`; }
const accList = () => S.d.setup.accounts || [];
const opts = (list, cur, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : "") + list.map(v => Array.isArray(v) ? v : [v, v]).map(([v, l]) => `<option value="${esc(v)}" ${String(cur ?? "") === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("");
const projList = () => [...S.d.projects].sort((a, b) => String(b.pid).localeCompare(String(a.pid))).map(p => [p.pid, `${p.pid} · ${p.client || ""}`]);
function catPopHtml() {
  if (!Q.catOpen) return "";
  const all = cats().filter(c => c.group !== "Transfer");
  const item = (n, deep) => `<button type="button" role="option" class="cp-i ${deep ? "deep" : ""}" data-act="cat-pick" data-v="${esc(n)}" aria-selected="${n === Q.category}">${esc(n)}</button>`;
  const outGroups = [...new Set([...GROUPS_OUT, ...all.filter(c => c.type === "out").map(c => c.group)])];
  return `<div class="cal catpop" role="listbox" aria-label="Category">
    <div class="cp-h in">Money In <small>taka ashlo</small></div>${all.filter(c => c.type === "in" && !PSEUDO[c.name]).map(c => item(c.name)).join("")}${item("Investment")}
    <div class="cp-h out">Money Out <small>taka gelo</small></div><div class="cp-sh">Investor</div>${item("Investment Return", true)}
    ${outGroups.map(g => { const l = all.filter(c => c.type === "out" && c.group === g && !PSEUDO[c.name]); return l.length ? `<div class="cp-sh">${esc(g)}</div>${l.map(c => item(c.name, true)).join("")}` : ""; }).join("")}</div>`;
}
function calHtml() {
  const c = Q.cal; if (!c) return ""; const { y, m } = c, off = (new Date(y, m, 1).getDay() + 1) % 7, days = new Date(y, m + 1, 0).getDate(), t = today();
  let cells = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].map(d => `<span class="dow ${d === "Fri" ? "fri" : ""}">${d}</span>`).join("");
  for (let i = 0; i < off; i++) cells += "<span></span>";
  for (let d = 1; d <= days; d++) { const iso = `${y}-${pad(m + 1)}-${pad(d)}`; cells += `<button type="button" data-act="cal-day" data-d="${iso}" class="${iso === t ? "today" : ""}" aria-pressed="${iso === Q.date}" aria-label="${fdate(iso)}">${d}</button>`; }
  const cy = new Date().getFullYear(), ys = []; for (let v = cy - 10; v <= cy + 2; v++) ys.push(v); if (!ys.includes(y)) ys.push(y); ys.sort();
  return `<div class="cal" role="dialog" aria-label="Date bachun"><div class="cal-head"><button type="button" class="cal-nav" data-act="cal-prev" aria-label="Ager mash">‹</button>
  <select id="cal-m" aria-label="Month">${MONTHS.map((n, i) => `<option value="${i}" ${i === m ? "selected" : ""}>${n}</option>`).join("")}</select>
  <select id="cal-y" aria-label="Year">${ys.map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select>
  <button type="button" class="cal-nav" data-act="cal-next" aria-label="Porer mash">›</button></div>
  <div class="cal-grid">${cells}</div><div class="cal-foot"><button type="button" class="link" data-act="cal-today">Aj (today)</button><button type="button" class="link" data-act="cal-close">Close</button></div></div>`;
}
const chip = (f, key) => `<span class="chip"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name || "file")}</a><button type="button" data-act="rm-file" data-key="${key}" aria-label="${esc(f.name)} shorao">×</button></span>`;
function quickInner() {
  const ps = PSEUDO[Q.category], cat = ps ? { name: Q.category, type: ps.type } : catOf(Q.category), acc = Q.account || accList()[0] || "", vp = Q.category === "Vendor Payment";
  const more = Q.more || vp || ps ? `<div class="more-box"><label class="f"><span>${cat?.type === "in" ? "Received in" : "Account"}</span><select id="q-account">${opts(accList(), acc)}</select></label>
    <label class="f"><span>Project (optional)</span><select id="q-pid">${opts(projList(), Q.pid, "— none —")}</select></label>
    ${ps ? `<label class="f wide"><span>${ps.inv === "Fund Received" ? "Kon investor dilen" : "Kon investor ke ferot dilen"} *</span><select id="q-investor">${opts(S.d.investors.map(i => i.name), Q.investor, S.d.investors.length ? "Investor select korun…" : "Age Investors e investor add korun")}</select></label>`
      : vp ? `<label class="f wide"><span>Vendor *</span><select id="q-vendor">${opts(S.d.vendors.map(v => v.name), Q.vendor, S.d.vendors.length ? "Vendor select korun…" : "Age Vendors e vendor add korun")}</select></label>`
        : `<label class="f wide"><span>${cat?.type === "in" ? "Kar theke" : "Kake dilen"} (optional)</span><input id="q-party" value="${esc(Q.party)}"></label>`}</div>`
    : `<p class="note wide" style="margin:0">${cat?.type === "in" ? "Received in" : "Account"}: <strong>${esc(acc)}</strong> · <button type="button" class="link" data-act="q-more">Account, project ba party bodlan</button></p>`;
  return `<div class="head"><div><h2>Notun entry</h2><p>Taka ashle ba gele ekhane likhun. Investor er fund (Investment) ba ferot (Investment Return) o ekhane dite paren.</p></div>${cat ? `<span class="pill ${cat.type}">${cat.type === "in" ? "Money in" : "Money out"}</span>` : ""}</div>
  <form class="qform" id="qf" novalidate>
    <div class="datefield"><span>Date *</span><button type="button" class="datebox" id="q-date" data-act="cal" aria-expanded="${!!Q.cal}"><span>${fdate(Q.date) || "Date bachun"}</span>${CAL_ICON}</button>${calHtml()}</div>
    <div class="catfield"><span>Category *</span><div class="catrow"><button type="button" class="datebox" id="q-category" data-act="catopen" aria-haspopup="listbox" aria-expanded="${Q.catOpen}"><span style="${Q.category ? "" : "color:var(--muted)"}">${esc(Q.category) || "Category select korun…"}</span>${CHEV}</button><button type="button" class="plus" data-act="attach" data-target="q" aria-label="Supporting file add korun" title="Supporting file add korun">+</button></div>${catPopHtml()}</div>
    ${Q.files.length || Q.uploading ? `<div class="files wide">${Q.files.map((f, i) => chip(f, `q-${i}`)).join("")}${Q.uploading ? `<span class="chip">Uploading ${Q.uploading} file…</span>` : ""}</div>` : ""}
    <label class="f wide"><span>Description</span><input id="q-desc" value="${esc(Q.desc)}" placeholder="Jemon: ABC Pharma notebook er advance"></label>
    <label class="f wide"><span>Amount (৳) *</span><input id="q-amount" type="number" inputmode="decimal" min="0" step="any" value="${esc(Q.amount)}" placeholder="0"></label>
    <label class="f wide"><span>Notes</span><textarea id="q-notes">${esc(Q.notes)}</textarea></label>
    ${more}
  </form>
  ${Q.err ? `<p class="err-msg" role="alert">${esc(Q.err)}</p>` : ""}
  <button class="primary big" data-act="q-save" ${Q.busy ? "disabled" : ""}>${Q.busy ? "Saving…" : "Save entry"}</button>`;
}
function renderQuick() { const el = $("#quick"); if (el) el.innerHTML = quickInner(); }
function recentHtml() {
  const inv = S.d.inv.map(x => ({ ...x, _inv: 1, category: `${x.type} · ${x.investor}`, in: x.type === "Fund Received" ? x.amount : "", out: x.type === "Capital Return" || x.type === "Profit Paid" ? x.amount : "" }));
  const rows = [...S.d.ledger, ...inv].sort(sortDesc).slice(0, 6);
  return `<div class="head"><h3>Shesh entry gula</h3><a class="go" href="#ledger">Sob entry dekhun →</a></div>
  <div class="tbl"><table><tbody>${rows.map(e => { const o = num(e.out), i = num(e.in); return `<tr class="click" data-act="edit" data-kind="${e._inv ? "inv" : "ledger"}" data-id="${esc(e.id)}"><td>${fdate(e.date)}</td><td>${esc(e.category)}${files(e)}${e.desc ? `<span class="sub">${esc(e.desc)}</span>` : ""}</td>
  <td class="num ${i ? "pos" : o ? "neg" : ""}">${o ? "−" + tk(o) : tk(i || e.amount)}</td></tr>`; }).join("") || `<tr><td class="empty">Ekhono kono entry nei — upore prothom entry ta din.</td></tr>`}</tbody></table></div>`;
}
function updateRecent() { const el = $("#recent"); if (el) el.innerHTML = recentHtml(); }
function readQuick() { ["desc", "amount", "notes", "party"].forEach(k => { const el = $("#q-" + k); if (el) Q[k] = el.value; }); }
const qErr = m => { Q.err = m; renderQuick(); };
async function saveQuick() {
  readQuick(); const ps = PSEUDO[Q.category], cat = ps ? { name: Q.category, type: ps.type } : catOf(Q.category), amt = num(Q.amount);
  if (Q.uploading) return qErr("File upload shesh howa porjonto opekkha korun.");
  if (!Q.date) return qErr("Date bachun."); if (!cat) return qErr("Category select korun."); if (!(amt > 0)) return qErr("Amount 0 er beshi din.");
  if (ps && !Q.investor) return qErr("Investor select korun.");
  const vp = cat.name === "Vendor Payment"; if (vp && !Q.vendor) return qErr("Kon vendor ke dilen, sheta select korun.");
  const acc = Q.account || accList()[0]; if (!acc) return qErr("Sheet er Setup tab e ekta account add korun.");
  Q.busy = true; Q.err = ""; renderQuick();
  try {
    if (ps) await api("save", { table: "inv", values: { date: Q.date, investor: Q.investor, type: ps.inv, amount: amt, account: acc, pid: Q.pid, desc: Q.desc.trim(), notes: Q.notes.trim(), files: Q.files } });
    else await api("save", { table: "ledger", values: { date: Q.date, category: cat.name, pid: Q.pid, party: vp ? Q.vendor : Q.party.trim(), desc: Q.desc.trim(), account: acc, in: cat.type === "in" ? amt : "", out: cat.type === "out" ? amt : "", notes: Q.notes.trim(), files: Q.files } });
    Object.assign(Q, { category: "", desc: "", amount: "", notes: "", pid: "", vendor: "", investor: "", party: "", files: [], more: false, busy: false });
    renderQuick(); toast("Entry saved"); refresh(true);
  } catch (e) { Q.busy = false; qErr(e.message); }
}

/* ---------- files ---------- */
const OK_TYPES = { "image/jpeg": 1, "image/png": 1, "image/webp": 1, "application/pdf": 1 };
let attachTarget = "q";
function pickFiles(target) {
  attachTarget = target; let inp = $("#file-pick");
  if (!inp) { inp = document.createElement("input"); inp.type = "file"; inp.id = "file-pick"; inp.multiple = true; inp.accept = "image/*,application/pdf"; inp.hidden = true; document.body.append(inp);
    inp.addEventListener("change", () => { const fl = [...inp.files]; inp.value = ""; uploadFiles(fl, attachTarget); }); }
  inp.click();
}
const toB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(blob); });
async function shrink(file) {   // phone er boro photo choto kore pathai (1600px, JPEG)
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return { blob: file, type: file.type, name: file.name };
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
    return blob ? { blob, type: "image/jpeg", name: file.name.replace(/\.\w+$/, "") + ".jpg" } : { blob: file, type: file.type, name: file.name };
  } catch { return { blob: file, type: file.type, name: file.name }; }
}
async function uploadFiles(fl, target) {
  const st = target === "q" ? Q : F; if (!st) return; const redraw = () => target === "q" ? renderQuick() : drawForm();
  if (target !== "q") readForm();
  for (const file of fl) {
    if (!OK_TYPES[file.type] && !/^image\//.test(file.type)) { toast("Shudhu photo ba PDF add kora jay"); continue; }
    st.uploading = (st.uploading || 0) + 1; redraw();
    try {
      const s = await shrink(file);
      if (!OK_TYPES[s.type]) throw new Error("Ei photo format cholbe na — JPG/PNG din.");
      if (s.blob.size > 12 * 1024 * 1024) throw new Error(`${file.name} 12 MB er beshi.`);
      const r = await api("upload", { name: s.name, mime: s.type, data: await toB64(s.blob) });
      if (target === "q") Q.files.push(r); else if (F) F.v.files = [...(F.v.files || []), r];
    } catch (e) { toast(e.message || "Upload hoyni"); }
    finally { st.uploading--; if (target !== "q" && !F) return; redraw(); }
  }
}

/* ---------- views ---------- */
const line = (l, v, cls = "") => `<div class="line ${cls}"><span>${l}</span><span class="num ${v < 0 ? "neg" : ""}">${tk(v)}</span></div>`;
function vDash() {
  const [from, to] = periodRange(), r = sums(from, to), f = S.f, d = S.d;
  const cash = d.accounts.reduce((s, a) => s + num(a.balance), 0);
  const recv = d.projects.filter(p => !["Lost", "Cancelled"].includes(p.status) && num(p.due) > 0).reduce((s, p) => s + num(p.due), 0);
  const pay = d.vendors.filter(v => num(v.due) > 0).reduce((s, v) => s + num(v.due), 0);
  const owe = d.investors.reduce((s, i) => s + num(i.outstanding), 0);
  const pitch = d.projects.filter(p => p.status === "Pitching"), lostS = d.projects.filter(p => p.status === "Lost").reduce((s, p) => s + num(p.sample), 0);
  const label = { month: "This month", last: "Last month", year: "This year", all: "All time", custom: "Custom range" }[f.period];
  return `<div class="head"><div><h2>Dashboard</h2><p>${label}. Balance, due ar deni shob shomoyer hishab.</p></div>
  <div class="row"><select id="f-period" aria-label="Period" style="width:auto">${opts([["month", "This month"], ["last", "Last month"], ["year", "This year"], ["all", "All time"], ["custom", "Custom"]], f.period)}</select>
  ${f.period === "custom" ? `<input type="date" id="f-from" value="${esc(f.from)}" aria-label="From" style="width:auto"><input type="date" id="f-to" value="${esc(f.to)}" aria-label="To" style="width:auto">` : ""}</div></div>
  <div class="kpis">
    <div class="kpi hero"><span class="l">Net profit</span><span class="v ${r.net < 0 ? "neg" : ""}">${tk(r.net)}</span><span class="s">Revenue ${tk(r.rev)} − cost ${tk(r.dc + r.opex)}</span></div>
    <div class="kpi"><span class="l">Cash &amp; bank now</span><span class="v ${cash < 0 ? "neg" : ""}">${tk(cash)}</span><span class="s">${d.accounts.length} account</span></div>
    <div class="kpi"><span class="l">Client theke pabo</span><span class="v">${tk(recv)}</span><span class="s">Active project er due</span></div>
    <div class="kpi"><span class="l">Vendor ke dibo</span><span class="v ${pay > 0 ? "neg" : ""}">${tk(pay)}</span><span class="s">Bill − payment</span></div>
    <div class="kpi"><span class="l">Investor deni</span><span class="v">${tk(owe)}</span><span class="s">Purono + notun − ferot</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><h3>Profit &amp; loss</h3><div class="lines">${line("Client receipts (revenue)", r.rev)}${line("Other income", r.oth)}${line("Direct cost (vendor, delivery, sample…)", -r.dc)}${line("Gross profit", r.gross, "total")}${line("Operating expense", -r.opex)}${line("Net profit", r.net, "total")}</div>
      <p class="note">Cash basis: je taka hate esheche ar gechhe shudhu shetai.</p></section>
    <section class="panel"><h3>Accounts</h3><div class="lines">${d.accounts.map(a => `<div class="line"><span>${esc(a.name)}<span class="note"> opening ${tk(a.opening)}</span></span><span class="num ${a.balance < 0 ? "neg" : ""}">${tk(a.balance)}</span></div>`).join("")}<div class="line total"><span>Total</span><span class="num">${tk(cash)}</span></div></div>
      <p class="note">Opening balance Google Sheet er Setup tab e bodlan.</p></section>
    <section class="panel"><h3>Funds in this period</h3><div class="lines">${line("Investor fund received", r.fund)}${line("Investor payout (return + profit)", -r.payout)}${line("Owner drawings", -r.draw)}${line("Net cash flow", r.flow, "total")}</div></section>
    <section class="panel"><h3>Sample cost</h3><div class="lines">${line(`Pitching e atka (${pitch.length} pitch)`, pitch.reduce((s, p) => s + num(p.sample), 0))}${line("Lost pitch e loss", -lostS)}${line("Ei period e sample khoroch", -r.sample)}</div></section>
  </div>
  <section class="panel chart"><div class="head"><h3>Money in vs out, ${S.f.year}</h3><div class="legend"><span><i style="background:var(--in)"></i>In</span><span><i style="background:var(--out)"></i>Out</span></div></div>${chart()}</section>`;
}
function chart() {
  const y = S.f.year, data = MONTHS.map((m, i) => { const s = sums(`${y}-${pad(i + 1)}-01`, `${y}-${pad(i + 1)}-31`); return { m, i: s.cin, o: s.cout }; });
  const max = Math.max(1, ...data.map(d => Math.max(d.i, d.o)));
  const W = 720, H = 220, L = 56, B = 24, T = 10, cw = (W - L - 8) / 12, bw = Math.min(16, cw / 3);
  let g = [0, .5, 1].map(t => { const yy = H - B - t * (H - B - T); return `<line x1="${L}" x2="${W - 4}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${t ? "৳" + nf.format(Math.round(max * t / 1000)) + "k" : "0"}</text>`; }).join("");
  g += data.map((d, k) => { const x = L + k * cw + cw / 2, hi = d.i / max * (H - B - T), ho = d.o / max * (H - B - T);
    return `<rect x="${x - bw - 1}" y="${H - B - hi}" width="${bw}" height="${hi}" rx="2" fill="var(--in)"><title>${d.m} in ${tk(d.i)}</title></rect><rect x="${x + 1}" y="${H - B - ho}" width="${bw}" height="${ho}" rx="2" fill="var(--out)"><title>${d.m} out ${tk(d.o)}</title></rect><text x="${x}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${d.m}</text>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly money in and out">${g}</svg>`;
}
function vLedger() {
  const f = S.f, q = f.lq.trim().toLowerCase();
  let rows = S.d.ledger.filter(e => (!f.lacc || e.account === f.lacc) && (!f.lmonth || (e.date || "").startsWith(f.lmonth)));
  if (q) rows = rows.filter(e => [e.category, e.party, e.desc, e.voucher, e.pid, e.notes].join(" ").toLowerCase().includes(q));
  rows.sort(sortDesc);
  const months = [...new Set(S.d.ledger.map(e => (e.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  const tin = rows.reduce((s, e) => s + num(e.in), 0), tout = rows.reduce((s, e) => s + num(e.out), 0);
  return `<div class="head"><div><h2>Daily Ledger</h2><p>Sob taka asha-jawa. Row e tap korle edit ba delete.</p></div><div class="row"><button data-act="new" data-kind="transfer">⇄ Account transfer</button><a class="btn primary" href="#entry" style="text-decoration:none">+ Notun entry</a></div></div>
  <div class="filters"><input id="lq" placeholder="Search category, party, project…" value="${esc(f.lq)}" aria-label="Search">
  <select id="lmonth" aria-label="Month"><option value="">All months</option>${months.map(m => `<option ${f.lmonth === m ? "selected" : ""} value="${m}">${MONTHS[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join("")}</select>
  <select id="lacc" aria-label="Account">${opts(accList(), f.lacc, "All accounts")}</select></div>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Details</th><th>Project</th><th>Account</th><th class="num">In</th><th class="num">Out</th><th>By</th></tr></thead><tbody>
  ${rows.map(e => `<tr class="click" data-act="edit" data-kind="ledger" data-id="${esc(e.id)}"><td>${fdate(e.date)}${e.voucher ? `<span class="sub">${esc(e.voucher)}</span>` : ""}</td>
    <td>${grp(e) === "Transfer" ? `<span class="pill tr">${esc(e.category)}</span>` : esc(e.category)}${files(e)}${e.party || e.desc || e.notes ? `<span class="sub">${esc([e.party, e.desc, e.notes].filter(Boolean).join(" · "))}</span>` : ""}</td>
    <td>${esc(e.pid)}</td><td>${esc(e.account)}</td><td class="num pos">${num(e.in) ? tk(e.in) : ""}</td><td class="num neg">${num(e.out) ? tk(e.out) : ""}</td><td><span class="by">${esc(String(e.by || "").split(" · ")[0])}</span></td></tr>`).join("") || `<tr><td colspan="7" class="empty">${S.d.ledger.length ? "Ei filter e kono entry nei." : "Ekhono kono entry nei. “Notun entry” te giye prothom entry din."}</td></tr>`}
  </tbody>${rows.length ? `<tfoot><tr><td colspan="4">${rows.length} entry</td><td class="num">${tk(tin)}</td><td class="num">${tk(tout)}</td><td></td></tr></tfoot>` : ""}</table></div>`;
}
function vProjects() {
  const ps = [...S.d.projects].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || "") || String(b.pid).localeCompare(String(a.pid)));
  const t = k => ps.reduce((s, p) => s + num(p[k]), 0);
  return `<div class="head"><div><h2>Projects &amp; pitches</h2><p>Sample shuru holei Project khulun, status “Pitching”. Order pele “Ongoing”, na pele “Lost”.</p></div>${addBtn("project", "New project")}</div>
  <div class="tbl"><table><thead><tr><th>ID</th><th>Client</th><th>Status</th><th class="num">Order</th><th class="num">Received</th><th class="num">Due</th><th class="num">Vendor bills</th><th class="num">Sample</th><th class="num">Other cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>
  ${ps.map(p => `<tr class="click" data-act="edit" data-kind="project" data-id="${esc(p.id)}"><td><strong>${esc(p.pid)}</strong>${p.orderDate ? `<span class="sub">${fdate(p.orderDate)}</span>` : ""}</td>
    <td>${esc(p.client || "—")}${p.details ? `<span class="sub">${esc(p.details)}</span>` : ""}</td><td><span class="pill ${esc(p.status)}">${esc(p.status || "—")}</span></td>
    <td class="num">${tk(p.value)}</td><td class="num">${tk(p.received)}</td><td class="num ${num(p.due) > 0 ? "neg" : ""}">${tk(p.due)}</td><td class="num">${tk(p.bills)}</td><td class="num">${tk(p.sample)}</td><td class="num">${tk(p.other)}</td>
    <td class="num ${num(p.profit) < 0 ? "neg" : ""}">${tk(p.profit)}</td><td class="num">${pct(p.margin)}</td></tr>`).join("") || `<tr><td colspan="11" class="empty">Kono project nei. “New project” chapun.</td></tr>`}
  </tbody>${ps.length ? `<tfoot><tr><td colspan="3">${ps.length} project</td>${["value", "received", "due", "bills", "sample", "other", "profit"].map(k => `<td class="num">${tk(t(k))}</td>`).join("")}<td></td></tr></tfoot>` : ""}</table></div>`;
}
function vClients() {
  const cs = [...S.d.clients].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return `<div class="head"><div><h2>Clients</h2><p>Order, received ar due Projects theke nije hishab hoy.</p></div>${addBtn("client", "New client")}</div>
  <div class="tbl"><table><thead><tr><th>Client</th><th>Contact</th><th>Phone / email</th><th class="num">Projects</th><th class="num">Order value</th><th class="num">Received</th><th class="num">Due</th></tr></thead><tbody>
  ${cs.map(c => `<tr class="click" data-act="edit" data-kind="client" data-id="${esc(c.id)}"><td><strong>${esc(c.name)}</strong>${c.industry ? `<span class="sub">${esc(c.industry)}</span>` : ""}</td>
    <td>${esc(c.contact)}${c.designation ? `<span class="sub">${esc(c.designation)}</span>` : ""}</td><td>${esc(c.phone)}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ""}</td>
    <td class="num">${num(c.count)}</td><td class="num">${tk(c.value)}</td><td class="num">${tk(c.received)}</td><td class="num ${num(c.due) > 0 ? "neg" : ""}">${tk(c.due)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Kono client nei.</td></tr>`}
  </tbody></table></div>`;
}
function vVendors() {
  const vs = [...S.d.vendors].sort((a, b) => String(a.name).localeCompare(String(b.name))), bills = [...S.d.bills].sort(sortDesc);
  return `<div class="head"><div><h2>Vendors</h2><p>Bill pele “Add bill”. Payment ta “Notun entry” te “Vendor Payment” category te din.</p></div><div class="row">${addBtn("bill", "Add bill")}${addBtn("vendor", "New vendor", false)}</div></div>
  <div class="tbl"><table><thead><tr><th>Vendor</th><th>Contact</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Due</th></tr></thead><tbody>
  ${vs.map(v => `<tr class="click" data-act="edit" data-kind="vendor" data-id="${esc(v.id)}"><td><strong>${esc(v.name)}</strong>${v.service ? `<span class="sub">${esc(v.service)}</span>` : ""}</td><td>${esc(v.contact)}${v.phone ? `<span class="sub">${esc(v.phone)}</span>` : ""}</td>
    <td class="num">${tk(v.billed)}</td><td class="num">${tk(v.paid)}</td><td class="num ${num(v.due) > 0 ? "neg" : ""}">${tk(v.due)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Kono vendor nei.</td></tr>`}
  </tbody></table></div><h3>Vendor bills</h3>
  <div class="tbl"><table><thead><tr><th>Bill date</th><th>Vendor</th><th>Project</th><th>Bill no.</th><th class="num">Amount</th><th>Due date</th></tr></thead><tbody>
  ${bills.map(b => `<tr class="click" data-act="edit" data-kind="bill" data-id="${esc(b.id)}"><td>${fdate(b.date)}</td><td>${esc(b.vendor)}${files(b)}${b.desc ? `<span class="sub">${esc(b.desc)}</span>` : ""}</td><td>${esc(b.pid)}</td><td>${esc(b.billNo)}</td><td class="num">${tk(b.amount)}</td><td>${fdate(b.dueDate)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Kono bill nei.</td></tr>`}
  </tbody></table></div>`;
}
function vInvestors() {
  const is = [...S.d.investors].sort((a, b) => String(a.name).localeCompare(String(b.name))), es = [...S.d.inv].sort(sortDesc);
  const t = k => is.reduce((s, i) => s + num(i[k]), 0);
  return `<div class="head"><div><h2>Investors</h2><p>“Previous Debt” cash e kichu bodlay na; ferot dile tokhon balance kome.</p></div><div class="row">${addBtn("inv", "Investor entry")}${addBtn("investor", "New investor", false)}</div></div>
  <div class="tbl"><table><thead><tr><th>Investor</th><th class="num">Previous debt</th><th class="num">Fund received</th><th class="num">Capital returned</th><th class="num">Outstanding</th><th class="num">Profit paid</th></tr></thead><tbody>
  ${is.map(i => `<tr class="click" data-act="edit" data-kind="investor" data-id="${esc(i.id)}"><td><strong>${esc(i.name)}</strong>${i.terms ? `<span class="sub">${esc(i.terms)}</span>` : ""}</td>
    <td class="num">${tk(i.prev)}</td><td class="num">${tk(i.fund)}</td><td class="num">${tk(i.ret)}</td><td class="num"><strong>${tk(i.outstanding)}</strong></td><td class="num">${tk(i.profit)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Kono investor nei.</td></tr>`}
  </tbody>${is.length ? `<tfoot><tr><td>Total</td>${["prev", "fund", "ret", "outstanding", "profit"].map(k => `<td class="num">${tk(t(k))}</td>`).join("")}</tr></tfoot>` : ""}</table></div>
  <h3>Investor entries</h3>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Investor</th><th>Type</th><th>Account</th><th class="num">Amount</th><th>By</th></tr></thead><tbody>
  ${es.map(x => `<tr class="click" data-act="edit" data-kind="inv" data-id="${esc(x.id)}"><td>${fdate(x.date)}</td><td>${esc(x.investor)}${files(x)}${x.desc || x.notes ? `<span class="sub">${esc([x.desc, x.notes].filter(Boolean).join(" · "))}</span>` : ""}</td>
    <td><span class="pill ${x.type === "Fund Received" ? "in" : x.type === "Previous Debt" ? "tr" : "out"}">${esc(x.type)}</span></td><td>${esc(x.account)}</td><td class="num">${tk(x.amount)}</td><td><span class="by">${esc(String(x.by || "").split(" · ")[0])}</span></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Kono entry nei.</td></tr>`}
  </tbody></table></div>`;
}
function vMonthly() {
  const y = S.f.year, rows = MONTHS.map((m, i) => ({ m, ...sums(`${y}-${pad(i + 1)}-01`, `${y}-${pad(i + 1)}-31`) }));
  const tot = k => rows.reduce((s, r) => s + r[k], 0);
  const cols = [["fund", "Investor fund"], ["rev", "Client receipts"], ["oth", "Other income"], ["dc", "Direct cost"], ["opex", "Operating exp."], ["gross", "Gross profit"], ["net", "Net profit"], ["payout", "Investor payout"], ["cin", "Money in"], ["cout", "Money out"], ["flow", "Net cash flow"]];
  const years = [...new Set([new Date().getFullYear(), ...S.d.ledger.map(e => +(e.date || "").slice(0, 4)), ...S.d.inv.map(e => +(e.date || "").slice(0, 4))].filter(Boolean))].sort();
  return `<div class="head"><div><h2>Monthly summary</h2><p>Prottek mash er hishab. Account transfer dhora hoyni.</p></div><select id="f-year" aria-label="Year" style="width:auto">${years.map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select></div>
  <div class="tbl"><table><thead><tr><th>Month</th>${cols.map(c => `<th class="num">${c[1]}</th>`).join("")}</tr></thead><tbody>
  ${rows.map(r => `<tr><td><strong>${r.m}</strong></td>${cols.map(([k]) => `<td class="num ${r[k] < 0 ? "neg" : ""}">${tk(r[k])}</td>`).join("")}</tr>`).join("")}
  </tbody><tfoot><tr><td>${y}</td>${cols.map(([k]) => `<td class="num">${tk(tot(k))}</td>`).join("")}</tr></tfoot></table></div>`;
}
function vMore() {
  return `<div class="head"><div><h2>Settings</h2><p>Login kora ache: <strong>${esc(S.user)}</strong></p></div></div>
  <section class="panel"><h3>Google Sheet</h3><p class="note">Sob data ei sheet e thake. Category, account, opening balance ar user (Naam/PIN) sheet er Setup ar Users tab e bodlan.</p>
  <div class="row">${S.d.sheetUrl ? `<a class="btn" href="${esc(S.d.sheetUrl)}" target="_blank" rel="noopener" style="text-decoration:none">Sheet kholun</a>` : ""}<button data-act="retry">Ekhon sync korun</button><button data-act="csv">Ledger CSV download</button></div></section>
  <section class="panel"><h3>Logout</h3><p class="note">Ei phone theke ber hoye jaben. Data sheet e thik thakbe. Notun kauke access dite sheet er Users tab e tar Gmail add korun.</p><div><button class="danger" data-act="logout">Logout</button></div></section>`;
}

/* ---------- forms (modal) ---------- */
const catGroups = () => {
  const all = cats(), groups = [...new Set(all.map(c => c.group))];
  return [["Money in", all.filter(c => c.type === "in" && c.group !== "Transfer").map(c => c.name)], ...groups.filter(g => g !== "Transfer" && all.some(c => c.group === g && c.type === "out")).map(g => [g, all.filter(c => c.group === g && c.type === "out").map(c => c.name)]), ["Transfer", all.filter(c => c.group === "Transfer").map(c => c.name)]].filter(x => x[1].length);
};
const SCHEMA = {
  ledger: { table: "ledger", title: "Ledger entry", files: 1, fields: v => {
    const vp = v.category === "Vendor Payment";
    return [{ k: "date", t: "date", l: "Date", req: 1 }, { k: "category", t: "select", l: "Category", og: catGroups(), req: 1, re: 1 }, { k: "amount", t: "money", l: "Amount (৳)", req: 1 },
      { k: "account", t: "select", l: "Account", o: accList(), req: 1 }, { k: "pid", t: "select", l: "Project", o: projList(), blank: "— none —" },
      vp ? { k: "party", t: "select", l: "Vendor", o: S.d.vendors.map(x => x.name), req: 1 } : { k: "party", t: "text", l: "Party" },
      { k: "voucher", t: "text", l: "Voucher no." }, { k: "desc", t: "text", l: "Description", wide: 1 }, { k: "notes", t: "area", l: "Notes", wide: 1 }]; } },
  inv: { table: "inv", title: "Investor entry", files: 1, fields: v => [{ k: "type", t: "select", l: "Entry type", o: INV_TYPES, req: 1, re: 1 }, { k: "investor", t: "select", l: "Investor", o: S.d.investors.map(i => i.name), req: 1 },
    { k: "date", t: "date", l: "Date", req: 1 }, { k: "amount", t: "money", l: "Amount (৳)", req: 1 },
    ...(v.type === "Previous Debt" ? [] : [{ k: "account", t: "select", l: v.type === "Fund Received" ? "Received in" : "Paid from", o: accList(), req: 1 }]),
    { k: "pid", t: "select", l: "Project", o: projList(), blank: "— none —" }, { k: "desc", t: "text", l: "Description", wide: 1 }, { k: "notes", t: "text", l: "Notes", wide: 1 }] },
  project: { table: "projects", title: "Project", fields: () => [{ k: "pid", t: "text", l: "Project ID", req: 1 }, { k: "client", t: "select", l: "Client", o: S.d.clients.map(c => c.name), req: 1 },
    { k: "details", t: "text", l: "Project / item details", wide: 1 }, { k: "orderDate", t: "date", l: "Order date" }, { k: "value", t: "money", l: "Order value (৳)" },
    { k: "status", t: "select", l: "Status", o: S.d.setup.statuses.length ? S.d.setup.statuses : ["Pitching", "Ongoing", "Delivered", "Closed", "Lost", "Cancelled"], req: 1 },
    { k: "fundedBy", t: "select", l: "Funded by", o: S.d.investors.map(i => i.name), blank: "—" }, { k: "notes", t: "area", l: "Notes", wide: 1 }] },
  client: { table: "clients", title: "Client", fields: () => [{ k: "name", t: "text", l: "Client / company name", req: 1, wide: 1 }, { k: "industry", t: "text", l: "Industry" }, { k: "contact", t: "text", l: "Contact person" },
    { k: "designation", t: "text", l: "Designation" }, { k: "phone", t: "tel", l: "Phone" }, { k: "email", t: "email", l: "Email", wide: 1 }, { k: "address", t: "area", l: "Address", wide: 1 }, { k: "notes", t: "area", l: "Notes", wide: 1 }] },
  vendor: { table: "vendors", title: "Vendor", fields: () => [{ k: "name", t: "text", l: "Vendor name", req: 1, wide: 1 }, { k: "service", t: "text", l: "Service type" }, { k: "contact", t: "text", l: "Contact person" }, { k: "phone", t: "tel", l: "Phone" }, { k: "notes", t: "area", l: "Notes", wide: 1 }] },
  bill: { table: "bills", title: "Vendor bill", files: 1, fields: () => [{ k: "vendor", t: "select", l: "Vendor", o: S.d.vendors.map(x => x.name), req: 1 }, { k: "pid", t: "select", l: "Project", o: projList(), blank: "— none —" },
    { k: "date", t: "date", l: "Bill date", req: 1 }, { k: "amount", t: "money", l: "Bill amount (৳)", req: 1 }, { k: "billNo", t: "text", l: "Bill / invoice no." }, { k: "dueDate", t: "date", l: "Due date" }, { k: "desc", t: "text", l: "Description", wide: 1 }, { k: "notes", t: "text", l: "Notes", wide: 1 }] },
  investor: { table: "investors", title: "Investor", fields: () => [{ k: "name", t: "text", l: "Investor name", req: 1, wide: 1 }, { k: "phone", t: "tel", l: "Phone" }, { k: "terms", t: "text", l: "Terms / profit share" }, { k: "notes", t: "area", l: "Notes", wide: 1 }] },
  transfer: { title: "Account transfer", fields: () => [{ k: "date", t: "date", l: "Date", req: 1 }, { k: "amount", t: "money", l: "Amount (৳)", req: 1 }, { k: "from", t: "select", l: "Kon account theke", o: accList(), req: 1 }, { k: "to", t: "select", l: "Kon account e", o: accList(), req: 1 }, { k: "desc", t: "text", l: "Description", wide: 1 }] }
};
const LIST = { ledger: "ledger", inv: "inv", project: "projects", client: "clients", vendor: "vendors", bill: "bills", investor: "investors" };
const NEW = { inv: () => ({ type: "Fund Received", date: today() }), bill: () => ({ date: today() }), transfer: () => ({ date: today() }), project: () => { let m = 0; S.d.projects.forEach(p => { const n = parseInt(String(p.pid).replace(/\D/g, ""), 10); if (n > m) m = n; }); return { pid: "P-" + String(m + 1).padStart(3, "0"), status: "Pitching" }; } };
let F = null;
function openForm(kind, id) {
  const rec = id ? S.d[LIST[kind]].find(r => String(r.id) === String(id)) : null;
  const v = rec ? { ...rec } : (NEW[kind]?.() || {});
  if (kind === "ledger" && rec) v.amount = num(rec.in) || num(rec.out) || "";
  F = { kind, id, v, err: "", armed: false, busy: false, uploading: 0 };
  drawForm();
}
function drawForm() {
  const sc = SCHEMA[F.kind], fs = sc.fields(F.v);
  const fh = f => {
    const v = F.v[f.k] ?? "", id = "fm-" + f.k; let inp;
    if (f.t === "select") inp = `<select id="${id}" data-k="${f.k}" ${f.re ? 'data-re="1"' : ""}>${f.og ? (v ? "" : `<option value="">Select…</option>`) + f.og.map(([g, l]) => `<optgroup label="${esc(g)}">${opts(l, v)}</optgroup>`).join("") : opts(f.o, v, f.blank ?? (v ? undefined : "Select…"))}</select>`;
    else if (f.t === "area") inp = `<textarea id="${id}" data-k="${f.k}">${esc(v)}</textarea>`;
    else inp = `<input id="${id}" data-k="${f.k}" type="${f.t === "money" ? "number" : f.t}" ${f.t === "money" ? 'inputmode="decimal" min="0" step="any"' : ""} value="${esc(v)}">`;
    return `<label class="f ${f.wide ? "wide" : ""}"><span>${f.l}${f.req ? " *" : ""}</span>${inp}</label>`;
  };
  $("#modal").innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${sc.title}">
    <div class="head"><h3>${F.id ? "Edit" : "New"} ${sc.title.toLowerCase()}</h3><button class="link" data-act="close">Close</button></div>
    <form class="form" id="fm" novalidate>${fs.map(fh).join("")}
    ${sc.files ? `<div class="f wide"><span>Supporting files</span><div class="files">${(F.v.files || []).map((f, i) => chip(f, `f-${i}`)).join("")}${F.uploading ? `<span class="chip">Uploading…</span>` : ""}<button type="button" class="link" data-act="attach" data-target="f">+ File add korun</button></div></div>` : ""}</form>
    ${F.v.by ? `<p class="note">Entry: ${esc(F.v.by)}</p>` : ""}
    ${F.err ? `<p class="err-msg" role="alert">${esc(F.err)}</p>` : ""}
    <div class="row" style="justify-content:space-between">${F.id ? `<button class="danger ${F.armed ? "armed" : ""}" data-act="del">${F.armed ? "Abar chapun — delete hobe" : "Delete"}</button>` : "<span></span>"}<button class="primary" data-act="save" ${F.busy ? "disabled" : ""}>${F.busy ? "Saving…" : "Save"}</button></div>
  </div></div>`;
}
function readForm() { document.querySelectorAll("#fm [data-k]").forEach(el => { F.v[el.dataset.k] = el.value; }); }
async function saveForm() {
  readForm(); const sc = SCHEMA[F.kind], fs = sc.fields(F.v), out = {};
  for (const f of fs) {
    let v = F.v[f.k]; if (typeof v === "string") v = v.trim();
    if (f.req && (v === "" || v == null)) { F.err = `“${f.l.replace(" (৳)", "")}” dorkar.`; return drawForm(); }
    if (f.t === "money" && v !== "" && v != null) { v = num(v); if (v < 0) { F.err = "Amount negative hote parbe na."; return drawForm(); } }
    out[f.k] = v ?? "";
  }
  if (F.uploading) { F.err = "File upload shesh howa porjonto opekkha korun."; return drawForm(); }
  if (["ledger", "inv", "bill", "transfer"].includes(F.kind) && !(out.amount > 0)) { F.err = "Amount 0 er beshi din."; return drawForm(); }
  if (F.kind === "transfer" && out.from === out.to) { F.err = "Duita alada account bachun."; return drawForm(); }
  const dupe = { project: ["projects", "pid"], client: ["clients", "name"], vendor: ["vendors", "name"], investor: ["investors", "name"] }[F.kind];
  if (dupe && S.d[dupe[0]].some(r => String(r[dupe[1]]).trim().toLowerCase() === String(out[dupe[1]]).toLowerCase() && String(r.id) !== String(F.id))) { F.err = `“${out[dupe[1]]}” already ache.`; return drawForm(); }
  if (F.kind === "ledger") { const c = catOf(out.category); out.in = c?.type === "in" ? out.amount : ""; out.out = c?.type === "out" ? out.amount : ""; delete out.amount; }
  if (F.kind === "inv" && out.type === "Previous Debt") out.account = "";
  if (sc.files) out.files = F.v.files || [];
  F.busy = true; F.err = ""; drawForm();
  try {
    if (F.kind === "transfer") await api("transfer", out); else await api("save", { table: sc.table, id: F.id || null, values: out });
    closeForm(); toast("Saved"); refresh(true);
  } catch (e) { if (!F) return; F.busy = false; F.err = e.message; drawForm(); }
}
async function delForm() {
  if (!F.armed) { readForm(); F.armed = true; return drawForm(); }
  const used = { client: () => S.d.projects.some(p => p.client === F.v.name), vendor: () => S.d.bills.some(b => b.vendor === F.v.name) || S.d.ledger.some(e => e.category === "Vendor Payment" && e.party === F.v.name), investor: () => S.d.inv.some(x => x.investor === F.v.name), project: () => S.d.ledger.some(e => e.pid === F.v.pid) || S.d.bills.some(b => b.pid === F.v.pid) }[F.kind];
  if (used && used()) { F.armed = false; F.err = "Eta onno entry te use hocche, tai delete kora jabe na."; return drawForm(); }
  F.busy = true; drawForm();
  try { await api("remove", { table: SCHEMA[F.kind].table, id: F.id }); closeForm(); toast("Deleted"); refresh(true); }
  catch (e) { F.busy = false; F.armed = false; F.err = e.message; drawForm(); }
}
function closeForm() { F = null; $("#modal").innerHTML = ""; render(); }

/* ---------- misc ---------- */
let tt; function toast(m) { clearTimeout(tt); let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.append(el); } el.textContent = m; tt = setTimeout(() => el.remove(), 2400); }
function csv() {
  const rows = [["Date", "Voucher", "Category", "Project", "Party", "Description", "Account", "Money in", "Money out", "Notes", "Entered by"]];
  [...S.d.ledger].sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(e => rows.push([e.date, e.voucher, e.category, e.pid, e.party, e.desc, e.account, e.in, e.out, e.notes, e.by]));
  const cell = v => { v = String(v ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const blob = new Blob(["﻿" + rows.map(r => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `onedeck-ledger-${today()}.csv`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- events ---------- */
document.addEventListener("click", e => {
  if (menuOpen && !e.target.closest(".menu-wrap")) { menuOpen = false; renderMenu(); }
  if (Q.cal && !e.target.closest(".datefield")) { Q.cal = null; readQuick(); renderQuick(); }
  if (Q.catOpen && !e.target.closest(".catfield")) { Q.catOpen = false; readQuick(); renderQuick(); }
  const b = e.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act;
  if (a === "scrim") { if (e.target === b) closeForm(); return; }
  e.preventDefault();
  if (a === "menu") { menuOpen = !menuOpen; renderMenu(); return; }
  if (a === "logout") return logout();
  if (a === "pin-go") return doLogin();
  if (a === "switch-acc") { S.token = ""; store.set("aa-token", null); if (gisReady) google.accounts.id.disableAutoSelect(); loginErr = ""; render(); return; }
  if (a === "retry") { refresh(); return; }
  if (a === "csv") return csv();
  if (a === "cal") { readQuick(); Q.catOpen = false; const y = +Q.date.slice(0, 4) || new Date().getFullYear(), m = (+Q.date.slice(5, 7) || new Date().getMonth() + 1) - 1; Q.cal = Q.cal ? null : { y, m }; renderQuick(); return; }
  if (a === "cal-prev" || a === "cal-next") { let { y, m } = Q.cal; m += a === "cal-next" ? 1 : -1; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } Q.cal = { y, m }; renderQuick(); return; }
  if (a === "cal-day" || a === "cal-today") { Q.date = a === "cal-today" ? today() : b.dataset.d; Q.cal = null; renderQuick(); $("#q-category")?.focus(); return; }
  if (a === "cal-close") { Q.cal = null; renderQuick(); return; }
  if (a === "catopen") { readQuick(); Q.cal = null; Q.catOpen = !Q.catOpen; renderQuick(); return; }
  if (a === "cat-pick") { Q.category = b.dataset.v; Q.catOpen = false; Q.err = ""; renderQuick(); $("#q-desc")?.focus(); return; }
  if (a === "attach") { if (b.dataset.target === "q") readQuick(); pickFiles(b.dataset.target); return; }
  if (a === "rm-file") { const [t, i] = b.dataset.key.split("-"); if (t === "q") { readQuick(); Q.files.splice(+i, 1); renderQuick(); } else if (F) { readForm(); F.v.files = (F.v.files || []).filter((_, j) => j !== +i); drawForm(); } return; }
  if (a === "q-more") { readQuick(); Q.more = true; renderQuick(); return; }
  if (a === "q-save") return saveQuick();
  if (a === "new") return openForm(b.dataset.kind);
  if (a === "edit") return openForm(b.dataset.kind, b.dataset.id);
  if (a === "close") return closeForm();
  if (a === "save") return saveForm();
  if (a === "del") return delForm();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if (F) closeForm(); if (menuOpen) { menuOpen = false; renderMenu(); } if (Q.cal || Q.catOpen) { Q.cal = null; Q.catOpen = false; readQuick(); renderQuick(); } }
  if (e.key === "Enter" && e.target.tagName === "INPUT") {
    if (e.target.closest("#qf")) { e.preventDefault(); saveQuick(); } else if (F && e.target.closest("#fm")) { e.preventDefault(); saveForm(); } else if (e.target.id === "lg-pin") { e.preventDefault(); doLogin(); }
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (F && t.closest("#fm") && t.dataset.re) { readForm(); drawForm(); return; }
  if (t.id === "cal-m" || t.id === "cal-y") { Q.cal = { y: +$("#cal-y").value, m: +$("#cal-m").value }; renderQuick(); return; }
  if (t.closest && t.closest("#qf")) { const k = t.id.replace(/^q-/, ""); if (k in Q) { Q[k] = t.value; if (k === "account") store.set("aa-acc", t.value); } return; }
  if (t.id === "f-period") { S.f.period = t.value; store.set("aa-period", t.value); render(); }
  else if (t.id === "f-from" || t.id === "f-to") { S.f[t.id.slice(2)] = t.value; render(); }
  else if (t.id === "f-year") { S.f.year = +t.value; render(); }
  else if (t.id === "lmonth" || t.id === "lacc") { S.f[t.id] = t.value; render(); }
});
let qt; document.addEventListener("input", e => {
  const t = e.target;
  if (t.closest && t.closest("#qf")) { const k = t.id.replace(/^q-/, ""); if (k in Q) Q[k] = t.value; }
  if (t.id === "lq") { S.f.lq = t.value; clearTimeout(qt); qt = setTimeout(() => { render(); const el = $("#lq"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 250); }
});
window.addEventListener("hashchange", () => { menuOpen = false; render(); window.scrollTo(0, 0); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - S.lastSync > 15000) refresh(true); });
setInterval(() => { if (document.visibilityState === "visible" && !F && !S.syncing) refresh(true); }, 45000);

render();
if (S.user) refresh();
