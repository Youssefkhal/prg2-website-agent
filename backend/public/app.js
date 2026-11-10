/* Atelier — web interface (vanilla JS, no build step) */
const $ = (s) => document.querySelector(s);
const MAIN = "atelier";
const AGENT_LABEL = { atelier: "Atelier (main agent)", copywriter: "Sub-agent · copywriter", "image-designer": "Sub-agent · art director (GPU)", "web-developer": "Sub-agent · web developer", "qa-reviewer": "Sub-agent · QA", "general-purpose": "Sub-agent · general purpose", "sub-agent": "Sub-agent" };

/* ------------------------------------------------------------------ backend */
/* The UI is served by Nest at the same origin, or by GitHub Pages with a separate backend. */
const GITHUB_PAGES = /\.github\.io$/i.test(location.hostname);
const queryApi = new URLSearchParams(location.search).get("api");
let apiBase = queryApi || localStorage.getItem("atelier.apiBase") || (GITHUB_PAGES ? "http://localhost:3000" : "");
const apiUrl = (p) => (apiBase ? apiBase.replace(/\/+$/, "") + p : p);

/* ---------------------------------------------------------------- projects */
const projects = JSON.parse(localStorage.getItem("atelier.projects") || "[]");
let threadId = localStorage.getItem("atelier.current");
function newProject() {
  threadId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  projects.unshift({ id: threadId, title: "New project", at: Date.now() });
  saveProjects();
}
function saveProjects() {
  localStorage.setItem("atelier.projects", JSON.stringify(projects.slice(0, 50)));
  localStorage.setItem("atelier.current", threadId);
  const sel = $("#project-select");
  sel.innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
  sel.value = threadId;
}
if (!threadId || !projects.find((p) => p.id === threadId)) newProject();
saveProjects();

/* ----------------------------------------------------------------- helpers */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function md(src) {
  const blocks = String(src).split(/```/);
  return blocks
    .map((b, i) => {
      if (i % 2) return `<pre><code>${esc(b.replace(/^\w*\n/, ""))}</code></pre>`;
      let h = esc(b)
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>");
      h = h.replace(/(<li>.*<\/li>\n?)+/g, (m) => `\n\n<ul>${m.replace(/\n/g, "")}</ul>\n\n`);
      return h
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p) => (/^<(h\d|ul|pre)/.test(p.trim()) ? p : `<p>${p.trim().replace(/\n/g, "<br>")}</p>`))
        .join("");
    })
    .join("");
}
const isSub = (agent) => agent !== MAIN;
const projectUrl = (p) => apiUrl(`/projects/${threadId}${p}`);

/* --------------------------------------------------------------- rendering */
const box = $("#messages");
let bubble = null; // { agent, el, text }
let pendingTools = {}; // agent -> [card]
let byIndex = {}; // `${agent}:${index}` -> card

function scroll() {
  box.scrollTop = box.scrollHeight;
}
function addUser(text, images) {
  box.querySelector(".welcome")?.remove();
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  if (images?.length) {
    const wrap = document.createElement("div");
    for (const img of images) wrap.insertAdjacentHTML("beforeend", `<img src="${img.dataUrl}" alt="">`);
    el.appendChild(wrap);
  }
  box.appendChild(el);
  scroll();
}
function addAssistant(agent, text = "") {
  const el = document.createElement("div");
  el.className = "msg assistant" + (isSub(agent) ? " sub" : "");
  el.innerHTML = `<div class="who">${esc(AGENT_LABEL[agent] || "Sub-agent · " + agent)}</div><div class="body"></div>`;
  box.appendChild(el);
  bubble = { agent, el, text };
  if (text) el.querySelector(".body").innerHTML = md(text);
  return bubble;
}
function onToken(agent, text) {
  if (!bubble || bubble.agent !== agent || bubble.el !== box.lastElementChild) addAssistant(agent);
  bubble.text += text;
  bubble.el.querySelector(".body").innerHTML = md(bubble.text);
  bubble.el.classList.add("typing");
  scroll();
}
function onToolCall(e) {
  const card = document.createElement("details");
  card.className = "tool" + (isSub(e.agent) ? " sub" : "");
  card.innerHTML = `<summary><b>${esc(e.name)}</b> <span class="meta">${isSub(e.agent) ? "· " + esc(e.agent) : ""}</span></summary><pre class="args"></pre>`;
  card._args = "";
  card._name = e.name;
  box.appendChild(card);
  (pendingTools[e.agent] ||= []).push(card);
  byIndex[`${e.agent}:${e.index}`] = card;
  bubble?.el.classList.remove("typing");
  scroll();
}
function onToolArgs(e) {
  const card = byIndex[`${e.agent}:${e.index}`];
  if (!card) return;
  card._args += e.delta;
  card.querySelector(".args").textContent = card._args.slice(0, 3000);
}
function onToolResult(e) {
  const list = pendingTools[e.agent] || [];
  const i = list.findIndex((c) => c._name === e.name);
  const card = i >= 0 ? list.splice(i, 1)[0] : null;
  let args = {};
  try {
    args = card ? JSON.parse(card._args || "{}") : {};
  } catch {}
  if (card) {
    card.classList.add("done");
    card.insertAdjacentHTML("beforeend", `<pre>${esc(e.content)}</pre>`);
    const summary = card.querySelector(".meta");
    if (e.name === "task" && args.subagent_type) summary.textContent = `→ ${args.subagent_type}`;
    if (e.name === "load_skill" && args.name) summary.textContent = `→ ${args.name}`;
    if (["write_file", "edit_file", "read_file"].includes(e.name) && (args.file_path || args.path)) summary.textContent += ` ${args.file_path || args.path}`;
    if (e.name === "generate_image") {
      const m = /Saved to (\S+?\.png)|wrote a placeholder .*? to (\S+?\.svg)/.exec(e.content);
      const p = m && (m[1] || m[2]);
      if (p) card.insertAdjacentHTML("beforeend", `<img class="gen" src="${projectUrl(p)}?t=${Date.now()}" alt="">`);
      card.open = true;
    }
  }
  if (e.name === "write_todos" && Array.isArray(args.todos)) renderTodos(args.todos);
  if (e.name === "task") activity(`<b>${esc(args.subagent_type || "sub-agent")}</b> finished: ${esc((args.description || "").slice(0, 120))}`);
  if (["write_file", "edit_file", "generate_image", "task", "delete"].includes(e.name)) refreshSoon();
  scroll();
}
function renderTodos(todos) {
  $("#todos").innerHTML = todos.map((t) => `<li class="${esc(t.status)}">${esc(t.content)}</li>`).join("") || `<li class="empty">—</li>`;
}
function activity(html) {
  $("#agents-activity").insertAdjacentHTML("afterbegin", `<li>${new Date().toLocaleTimeString()} — ${html}</li>`);
}

/* -------------------------------------------------------------- composer */
let attachments = [];
async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    attachments.push({ name: f.name.replace(/\.[^.]+$/, "") || "image", dataUrl: await downscale(f) });
  }
  renderAttachments();
}
function downscale(file, max = 1568) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      if (file.type === "image/svg+xml" || file.type === "image/gif") return resolve(r.result);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        if (k === 1 && file.size < 3e6) return resolve(r.result);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
function renderAttachments() {
  $("#attachments").innerHTML = attachments.map((a, i) => `<div class="thumb"><img src="${a.dataUrl}" alt="${esc(a.name)}"><button type="button" data-i="${i}">×</button></div>`).join("");
}
$("#attachments").addEventListener("click", (e) => {
  if (e.target.dataset.i) {
    attachments.splice(+e.target.dataset.i, 1);
    renderAttachments();
  }
});
$("#file-input").addEventListener("change", (e) => addFiles(e.target.files));
$("#input").addEventListener("paste", (e) => addFiles([...e.clipboardData.files]));
const composer = $("#composer");
composer.addEventListener("dragover", (e) => {
  e.preventDefault();
  composer.classList.add("drag");
});
composer.addEventListener("dragleave", () => composer.classList.remove("drag"));
composer.addEventListener("drop", (e) => {
  e.preventDefault();
  composer.classList.remove("drag");
  addFiles(e.dataTransfer.files);
});
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) composer.requestSubmit();
});
document.querySelectorAll(".example").forEach((b) => b.addEventListener("click", () => ($("#input").value = b.dataset.text)));

composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#input").value.trim();
  if (!text && !attachments.length) return;
  const images = attachments;
  attachments = [];
  renderAttachments();
  $("#input").value = "";
  addUser(text, images);
  const p = projects.find((x) => x.id === threadId);
  if (p && p.title === "New project" && text) {
    p.title = text.slice(0, 40);
    saveProjects();
  }
  $("#send").disabled = true;
  bubble = null;
  pendingTools = {};
  byIndex = {};
  try {
    const res = await fetch(apiUrl("/api/chat"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, message: text, images }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, k);
        buf = buf.slice(k + 2);
        for (const line of chunk.split("\n")) if (line.startsWith("data: ")) handle(JSON.parse(line.slice(6)));
      }
    }
  } catch (err) {
    const el = addAssistant(MAIN, "").el;
    el.classList.add("error");
    el.querySelector(".body").textContent = String(err.message || err);
  } finally {
    $("#send").disabled = false;
    document.querySelectorAll(".typing").forEach((x) => x.classList.remove("typing"));
    refresh();
  }
});

function handle(e) {
  switch (e.type) {
    case "token": return onToken(e.agent, e.text);
    case "tool_call": return onToolCall(e);
    case "tool_args": return onToolArgs(e);
    case "tool_result": return onToolResult(e);
    case "uploads": return activity(`images saved: ${e.files.map(esc).join(", ")}`);
    case "error": {
      const el = addAssistant(MAIN).el;
      el.classList.add("error");
      el.querySelector(".body").textContent = "Error: " + e.message;
      return;
    }
  }
}

/* ------------------------------------------------------- preview / files */
let refreshTimer;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 600);
}
async function refresh() {
  const files = await (await fetch(apiUrl(`/api/projects/${threadId}/files`))).json();
  $("#file-list").innerHTML = files.map((f) => `<li data-p="${esc(f.path)}">${esc(f.path)} <span>${(f.size / 1024).toFixed(1)} KB</span></li>`).join("") || `<li class="empty">No files</li>`;
  const pages = files.filter((f) => f.path.startsWith("/site/") && f.path.endsWith(".html")).map((f) => f.path);
  const sel = $("#page-select");
  const prev = sel.value;
  sel.innerHTML = pages.map((p) => `<option>${esc(p)}</option>`).join("");
  const has = pages.length > 0;
  $("#preview").style.display = has ? "block" : "none";
  $("#preview-empty").style.display = has ? "none" : "block";
  if (has) {
    sel.value = pages.includes(prev) ? prev : pages.includes("/site/index.html") ? "/site/index.html" : pages[0];
    loadPreview();
  }
}
function loadPreview() {
  const url = projectUrl($("#page-select").value);
  $("#preview").src = url + "?t=" + Date.now();
  $("#open-new").href = url;
}
$("#page-select").addEventListener("change", loadPreview);
$("#refresh").addEventListener("click", refresh);
$("#file-list").addEventListener("click", async (e) => {
  const p = e.target.closest("li")?.dataset.p;
  if (!p) return;
  const view = $("#file-view");
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(p)) {
    view.innerHTML = `<img src="${projectUrl(p)}" alt="">`;
    return;
  }
  const r = await (await fetch(apiUrl(`/api/projects/${threadId}/file?path=${encodeURIComponent(p)}`))).json();
  view.textContent = r.content;
});
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button, .tab").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("#tab-" + b.dataset.tab).classList.add("active");
  }),
);

/* ---------------------------------------------------------- skills / tools */
$("#skill-search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await (await fetch(apiUrl(`/api/skills?q=${encodeURIComponent($("#skill-q").value)}&k=12`))).json();
  $("#skill-results").innerHTML = r.items.map((s) => `<li><b>${esc(s.name)}</b> ${s.score != null ? `<span class="pill">${s.score}</span>` : ""}<small>${esc(s.description)}</small>${s.tools.length ? `<small>tools: ${esc(s.tools.join(", "))}</small>` : ""}</li>`).join("") || "<li>No results</li>";
});
$("#skill-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const list = (k) => String(f.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const res = await fetch(apiUrl("/api/skills"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.get("name"), description: f.get("description"), body: f.get("body"), tags: list("tags"), tools: list("tools") }) });
  const j = await res.json();
  alert(res.ok ? `Skill "${j.registered.name}" registered (${j.total} skills).` : j.message);
  if (res.ok) e.target.reset(), health();
});
async function loadTools() {
  const tools = await (await fetch(apiUrl("/api/tools"))).json();
  $("#tool-list").innerHTML = tools.map((t) => `<li><b>${esc(t.name)}</b> <span class="pill">${t.source}</span><small>${esc(t.description)}</small></li>`).join("");
}
$("#tool-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  let manifest;
  try {
    manifest = JSON.parse(new FormData(e.target).get("manifest"));
  } catch {
    return alert("Invalid JSON");
  }
  const res = await fetch(apiUrl("/api/tools"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manifest) });
  const j = await res.json();
  alert(res.ok ? `Tool "${j.registered.name}" registered.` : j.message);
  if (res.ok) loadTools();
});

/* ------------------------------------------------------------------ status */
async function health() {
  try {
    const h = await (await fetch(apiUrl("/api/health"))).json();
    const g = $("#gpu-pill");
    g.textContent = h.gpu.ok ? `Colab GPU: ${h.gpu.gpu || h.gpu.device}` : "Colab GPU: offline (placeholder images)";
    g.className = "pill " + (h.gpu.ok ? "ok" : "bad");
    g.title = JSON.stringify(h.gpu);
    const info = h.modelInfo || {};
    $("#model-pill").textContent = info.configured ? `${info.provider}:${info.model}` : "model: not configured";
    $("#model-pill").className = "pill " + (info.configured ? "ok" : "bad");
    $("#model-pill").title = info.configured ? "Click Model to change the provider or key" : "Click Model to paste an API key";
    $("#setup-banner").hidden = !!info.configured;
    $("#skills-pill").textContent = `${h.skills.count} skills · ${h.skills.semanticIndex ? "GPU semantic index" : "BM25"}`;
  } catch {
    $("#gpu-pill").textContent = "backend unreachable";
    $("#gpu-pill").className = "pill bad";
    $("#model-pill").textContent = "backend offline";
    $("#model-pill").className = "pill bad";
    $("#setup-banner").hidden = false;
  }
}

/* ---------------------------------------------------------- model settings */
const PROVIDER_DEFAULTS = { anthropic: "claude-sonnet-4-6", openai: "gpt-4.1", "google-genai": "gemini-2.5-flash" };
const settingsDialog = $("#settings-dialog");
const settingsStatus = (text, kind = "") => {
  const el = $("#settings-status");
  el.textContent = text;
  el.className = "settings-status" + (kind ? " " + kind : "");
};

function savedSettings() {
  try {
    return JSON.parse(localStorage.getItem("atelier.settings") || "{}");
  } catch {
    return {};
  }
}

function initSettingsForm() {
  const s = savedSettings();
  const provider = s.provider || "anthropic";
  $("#provider").value = provider;
  $("#model-name").value = s.model || PROVIDER_DEFAULTS[provider];
  $("#model-base-url").value = s.baseUrl || "";
  $("#backend-url").value = apiBase || location.origin;
  $("#base-url-row").hidden = provider !== "openai";
}

async function openSettings() {
  initSettingsForm();
  $("#api-key").value = "";
  settingsStatus("");
  settingsDialog.showModal();
  try {
    const r = await fetch(apiUrl("/api/settings"));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const s = await r.json();
    if (s.configured) {
      $("#provider").value = s.provider || $("#provider").value;
      $("#model-name").value = s.model || $("#model-name").value;
      $("#backend-url").value = apiBase || location.origin;
      $("#base-url-row").hidden = $("#provider").value !== "openai";
      settingsStatus(`Configured: ${s.provider}:${s.model}`, "ok");
    } else {
      settingsStatus("No model configured yet. Paste an API key below.");
    }
  } catch {
    settingsStatus("Backend unreachable. Check the Backend URL and start the NestJS server.", "err");
  }
}

$("#settings-btn").addEventListener("click", openSettings);
$("#setup-open").addEventListener("click", openSettings);
$("#settings-close").addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("close", () => {
  $("#api-key").value = "";
});
$("#provider").addEventListener("change", (e) => {
  const provider = e.target.value;
  $("#base-url-row").hidden = provider !== "openai";
  const current = $("#model-name").value.trim();
  const knownDefaults = Object.values(PROVIDER_DEFAULTS);
  if (!current || knownDefaults.includes(current)) $("#model-name").value = PROVIDER_DEFAULTS[provider];
});
$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const base = $("#backend-url").value.trim().replace(/\/+$/, "");
  if (base && !/^https?:\/\//i.test(base)) return settingsStatus("Backend URL must start with http:// or https://", "err");
  const payload = {
    provider: $("#provider").value,
    model: $("#model-name").value.trim(),
    apiKey: $("#api-key").value.trim(),
    baseUrl: $("#provider").value === "openai" ? $("#model-base-url").value.trim() || undefined : undefined,
  };
  if (!payload.model) return settingsStatus("Model name is required.", "err");
  if (!payload.apiKey) return settingsStatus("API key is required.", "err");
  settingsStatus("Applying…");
  try {
    const res = await fetch(apiUrl("/api/settings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message || `HTTP ${res.status}`);
    apiBase = base && base !== location.origin ? base : "";
    localStorage.setItem("atelier.apiBase", apiBase);
    localStorage.setItem("atelier.settings", JSON.stringify({ provider: payload.provider, model: payload.model, baseUrl: payload.baseUrl || "" }));
    $("#api-key").value = "";
    settingsStatus(`Using ${j.provider}:${j.model}`, "ok");
    await health();
    await loadTools();
    setTimeout(() => settingsDialog.close(), 700);
  } catch (err) {
    settingsStatus(String(err.message || err), "err");
  }
});
$("#settings-clear").addEventListener("click", async () => {
  settingsStatus("Clearing…");
  try {
    await fetch(apiUrl("/api/settings"), { method: "DELETE" });
    $("#api-key").value = "";
    settingsStatus("Key cleared. The backend will use the .env model on the next request.", "ok");
    await health();
  } catch (err) {
    settingsStatus(String(err.message || err), "err");
  }
});
async function loadHistory() {
  box.innerHTML = "";
  bubble = null;
  try {
    const hist = await (await fetch(apiUrl(`/api/projects/${threadId}/history`))).json();
    for (const m of hist) m.role === "user" ? addUser(m.text) : addAssistant(MAIN, m.text);
    if (!hist.length) box.innerHTML = `<div class="welcome"><h2>New project</h2><p>Describe the company and attach a logo / photos.</p></div>`;
  } catch {}
  $("#todos").innerHTML = `<li class="empty">No plan yet.</li>`;
  refresh();
}
$("#new-project").addEventListener("click", () => {
  newProject();
  loadHistory();
});
$("#project-select").addEventListener("change", (e) => {
  threadId = e.target.value;
  saveProjects();
  loadHistory();
});

initSettingsForm();
health();
loadTools();
setInterval(health, 30000);
if (projects.find((p) => p.id === threadId)?.title !== "New project") loadHistory();
else refresh();
