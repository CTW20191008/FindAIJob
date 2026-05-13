const KEY = "findaijob_api_secret";

function hdr() {
  const k = localStorage.getItem(KEY) || document.getElementById("apiKey").value.trim();
  const h = { "Content-Type": "application/json" };
  if (k) {
    h["Authorization"] = "Bearer " + k;
    h["X-Api-Key"] = k;
  }
  return h;
}

document.getElementById("saveKey").onclick = () => {
  localStorage.setItem(KEY, document.getElementById("apiKey").value.trim());
  alert("已保存");
};

document.getElementById("apiKey").value = localStorage.getItem(KEY) || "";

// ── 简历上传 ──
(function () {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("resumeFile");
  const status = document.getElementById("uploadStatus");

  // Restore resume state on page load
  async function loadResumeInfo() {
    try {
      const k = localStorage.getItem(KEY) || "";
      const headers = {};
      if (k) { headers["Authorization"] = "Bearer " + k; headers["X-Api-Key"] = k; }
      const r = await fetch("/api/resume-info", { headers });
      if (!r.ok) return;
      const info = await r.json();
      if (info.exists) {
        const date = new Date(info.modified_at * 1000).toLocaleString("zh-CN");
        dropZone.querySelector(".drop-title").textContent = info.filename;
        setStatus(
          `✅ 已载入简历 <strong>${info.filename}</strong>，索引 <strong>${info.chunk_count}</strong> 片段 · ${date}`,
          "ok"
        );
      }
    } catch (_) {}
  }
  loadResumeInfo();

  function setStatus(html, type) {
    status.innerHTML = html;
    status.className = "upload-status " + (type || "");
    status.classList.remove("hidden");
  }

  async function uploadFile(file) {
    if (!file) return;
    const allowed = [".pdf", ".docx", ".doc"];
    if (!allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setStatus("仅支持 PDF / DOCX 格式", "err");
      return;
    }
    setStatus("⏳ 上传并建立索引中…", "loading");
    dropZone.classList.add("uploading");

    const fd = new FormData();
    fd.append("file", file);

    const k = localStorage.getItem(KEY) || document.getElementById("apiKey").value.trim();
    const headers = {};
    if (k) { headers["Authorization"] = "Bearer " + k; headers["X-Api-Key"] = k; }

    try {
      const r = await fetch("/api/upload-resume", { method: "POST", headers, body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j));
      setStatus(
        `✅ <strong>${file.name}</strong> 上传成功，已建立 <strong>${j.chunk_count}</strong> 个索引片段`,
        "ok"
      );
      dropZone.querySelector(".drop-title").textContent = file.name;
    } catch (e) {
      setStatus("❌ 上传失败：" + e.message, "err");
    } finally {
      dropZone.classList.remove("uploading");
    }
  }

  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => uploadFile(fileInput.files[0]);

  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); };
  dropZone.ondragleave = () => dropZone.classList.remove("drag-over");
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    uploadFile(e.dataTransfer.files[0]);
  };
})();

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    document.querySelectorAll(".pane").forEach((p) => p.classList.add("hidden"));
    document.getElementById("pan-" + btn.dataset.tab).classList.remove("hidden");
  };
});

async function post(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: hdr(),
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error(t || r.statusText);
  }
  if (!r.ok) throw new Error(JSON.stringify(j, null, 2));
  return j;
}

document.getElementById("btnAsk").onclick = async () => {
  const out = document.getElementById("outAsk");
  out.textContent = "…";
  try {
    const dtype = document.getElementById("dtype").value;
    const j = await post("/api/ask", {
      question: document.getElementById("q").value.trim(),
      doc_type: dtype || null,
      show_chunks: document.getElementById("showChunks").checked,
    });
    let s = j.answer || "";
    s += "\n\n—— 引用 ——\n" + JSON.stringify(j.citations, null, 2);
    if (j.chunks) s += "\n\n—— 检索片段 ——\n" + JSON.stringify(j.chunks, null, 2);
    out.textContent = s;
  } catch (e) {
    out.textContent = "错误：" + e.message;
  }
};

function renderJDAnalysis(j, container) {
  container.innerHTML = "";
  const a = j.analysis || {};

  // Score + summary header
  const score = typeof a.score === "number" ? a.score : null;
  const scoreColor = score === null ? "#8b97a8"
    : score >= 75 ? "#6ecf8e"
    : score >= 50 ? "#e8c76a"
    : "#e07070";

  const header = document.createElement("div");
  header.className = "jd-header";
  header.innerHTML = `
    <div class="jd-score" style="--sc:${scoreColor}">
      <span class="jd-score-num">${score !== null ? score : "—"}</span>
      <span class="jd-score-label">匹配度</span>
    </div>
    <p class="jd-summary">${a.summary || "分析完成"}</p>`;
  container.appendChild(header);

  // Section definitions
  const sections = [
    { key: "match_points", title: "✅ 匹配点",   cls: "jd-match",  empty: "暂无明确匹配点" },
    { key: "gaps",         title: "🔴 能力缺口",  cls: "jd-gap",    empty: "未发现明显缺口" },
    { key: "suggestions",  title: "💡 提升建议",  cls: "jd-sug",    empty: "暂无建议" },
    { key: "risks",        title: "⚠️ 风险提示",  cls: "jd-risk",   empty: "暂无风险" },
  ];

  const grid = document.createElement("div");
  grid.className = "jd-grid";

  sections.forEach(({ key, title, cls, empty }) => {
    const items = Array.isArray(a[key]) ? a[key] : [];
    const sec = document.createElement("section");
    sec.className = "jd-section " + cls;

    const h = document.createElement("h3");
    h.className = "jd-sec-title";
    h.textContent = title;
    sec.appendChild(h);

    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "jd-empty";
      p.textContent = empty;
      sec.appendChild(p);
    } else {
      const ul = document.createElement("ul");
      ul.className = "jd-list";
      items.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
    }
    grid.appendChild(sec);
  });

  container.appendChild(grid);

  if (j.citations?.length) {
    const cite = document.createElement("p");
    cite.className = "iv-cite";
    cite.textContent = `基于 ${j.citations.length} 个知识片段分析`;
    container.appendChild(cite);
  }

  // Download button
  const dlRow = document.createElement("div");
  dlRow.className = "jd-dl-row";
  const dlBtn = document.createElement("button");
  dlBtn.className = "btn-dl";
  dlBtn.textContent = "📥 下载分析报告";
  dlBtn.onclick = () => downloadJDReport(a);
  dlRow.appendChild(dlBtn);
  container.appendChild(dlRow);
}

function downloadJDReport(a) {
  const score = typeof a.score === "number" ? a.score + " / 100" : "—";
  const now = new Date().toLocaleString("zh-CN");

  function section(title, items) {
    if (!items?.length) return `### ${title}\n\n（无）\n\n`;
    return `### ${title}\n\n${items.map((s) => `- ${s}`).join("\n")}\n\n`;
  }

  const md = [
    `# JD 匹配分析报告`,
    ``,
    `> 生成时间：${now}`,
    ``,
    `## 综合评分：${score}`,
    ``,
    `> ${a.summary || ""}`,
    ``,
    section("✅ 匹配点", a.match_points),
    section("🔴 能力缺口", a.gaps),
    section("💡 提升建议", a.suggestions),
    section("⚠️ 风险提示", a.risks),
  ].join("\n");

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement("a");
  a2.href = url;
  a2.download = `JD分析报告_${new Date().toISOString().slice(0, 10)}.md`;
  a2.click();
  URL.revokeObjectURL(url);
}

// current entry id being re-matched
let _jdEntryId = null;

async function runJDMatch() {
  const out = document.getElementById("outJd");
  out.innerHTML = "<span style='color:var(--muted)'>分析中…</span>";
  try {
    const j = await post("/api/jd-match", {
      jd_text: document.getElementById("jd").value,
      company: document.getElementById("jdCompany").value.trim(),
      position: document.getElementById("jdPosition").value.trim(),
      entry_id: _jdEntryId || null,
    });
    _jdEntryId = j.entry_id || null;
    renderJDAnalysis(j, out);
    loadJDHistory();
  } catch (e) {
    out.textContent = "错误：" + e.message;
  }
}

document.getElementById("btnJd").onclick = runJDMatch;

// ── JD 历史 ──
async function loadJDHistory() {
  const list = document.getElementById("jdHistoryList");
  try {
    const items = await apiFetch("/api/jd-history");
    if (!items.length) {
      list.innerHTML = "<p class='jd-empty'>暂无历史记录</p>";
      return;
    }
    list.innerHTML = "";
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "jd-hist-row";
      row.dataset.id = item.id;

      const scoreColor = item.score === null ? "#8b97a8"
        : item.score >= 75 ? "#6ecf8e"
        : item.score >= 50 ? "#e8c76a" : "#e07070";

      const firstDate = item.first_matched_at
        ? new Date(item.first_matched_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "";
      const lastDate = item.last_matched_at && item.last_matched_at !== item.first_matched_at
        ? "· 更新 " + new Date(item.last_matched_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "";

      row.innerHTML = `
        <div class="jd-hist-main">
          <span class="jd-hist-score" style="color:${scoreColor}">${item.score ?? "—"}</span>
          <div class="jd-hist-info">
            <p class="jd-hist-title-text">${item.company || "未知公司"} · ${item.position || "未知岗位"}</p>
            <p class="jd-hist-meta">${firstDate} ${lastDate}</p>
            ${item.summary ? `<p class="jd-hist-summary">${item.summary}</p>` : ""}
          </div>
        </div>
        <div class="jd-hist-actions">
          <button class="btn-hist-load" data-id="${item.id}">载入</button>
          <button class="btn-hist-rematch" data-id="${item.id}">重新匹配</button>
          <button class="btn-hist-del" data-id="${item.id}">删除</button>
        </div>`;
      list.appendChild(row);
    });

    list.querySelectorAll(".btn-hist-load").forEach((btn) => {
      btn.onclick = async () => {
        const entry = await apiFetch(`/api/jd-history/${btn.dataset.id}`);
        document.getElementById("jd").value = entry.jd_text || "";
        document.getElementById("jdCompany").value = entry.company || "";
        document.getElementById("jdPosition").value = entry.position || "";
        _jdEntryId = entry.id;
        renderJDAnalysis({ analysis: entry.analysis, citations: [] }, document.getElementById("outJd"));
        document.getElementById("outJd").scrollIntoView({ behavior: "smooth" });
      };
    });

    list.querySelectorAll(".btn-hist-rematch").forEach((btn) => {
      btn.onclick = async () => {
        const entry = await apiFetch(`/api/jd-history/${btn.dataset.id}`);
        document.getElementById("jd").value = entry.jd_text || "";
        document.getElementById("jdCompany").value = entry.company || "";
        document.getElementById("jdPosition").value = entry.position || "";
        _jdEntryId = entry.id;
        await runJDMatch();
        document.getElementById("outJd").scrollIntoView({ behavior: "smooth" });
      };
    });

    list.querySelectorAll(".btn-hist-del").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("确认删除此记录？")) return;
        await apiFetch(`/api/jd-history/${btn.dataset.id}`, { method: "DELETE" });
        if (_jdEntryId === btn.dataset.id) _jdEntryId = null;
        loadJDHistory();
      };
    });
  } catch (e) {
    list.innerHTML = `<p class='jd-empty'>加载失败：${e.message}</p>`;
  }
}

async function apiFetch(path, opts = {}) {
  const k = localStorage.getItem(KEY) || document.getElementById("apiKey").value.trim();
  const headers = { ...opts.headers };
  if (k) { headers["Authorization"] = "Bearer " + k; headers["X-Api-Key"] = k; }
  const r = await fetch(path, { ...opts, headers });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(t || r.statusText); }
  if (!r.ok) throw new Error(j.detail || JSON.stringify(j));
  return j;
}

// Load history when JD tab is opened
document.querySelectorAll(".tabs button").forEach((btn) => {
  const origOnclick = btn.onclick;
  btn.addEventListener("click", () => {
    if (btn.dataset.tab === "jd") loadJDHistory();
  });
});

function renderInterviewQuestions(j, container) {
  container.innerHTML = "";
  const questions = j?.result?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    container.textContent = "未生成面试题，请检查知识库是否已建立索引。";
    return;
  }

  const list = document.createElement("ol");
  list.className = "iv-list";

  questions.forEach((q) => {
    const card = document.createElement("li");
    card.className = "iv-card";

    const qEl = document.createElement("p");
    qEl.className = "iv-q";
    qEl.textContent = q.question || "";
    card.appendChild(qEl);

    if (q.intent) {
      const meta = document.createElement("div");
      meta.className = "iv-meta";
      meta.innerHTML =
        `<span class="iv-label">考察点</span><span class="iv-val">${q.intent}</span>`;
      card.appendChild(meta);
    }

    if (q.hint) {
      const details = document.createElement("details");
      details.className = "iv-hint";
      const summary = document.createElement("summary");
      summary.textContent = "回答提示";
      const hintText = document.createElement("p");
      hintText.textContent = q.hint;
      details.appendChild(summary);
      details.appendChild(hintText);
      card.appendChild(details);
    }

    list.appendChild(card);
  });

  container.appendChild(list);

  if (j.citations?.length) {
    const cite = document.createElement("p");
    cite.className = "iv-cite";
    cite.textContent = `基于 ${j.citations.length} 个知识片段生成`;
    container.appendChild(cite);
  }
}

document.getElementById("btnIv").onclick = async () => {
  const out = document.getElementById("outIv");
  out.innerHTML = "<span style='color:var(--muted)'>生成中…</span>";
  try {
    const j = await post("/api/interview-questions", {
      focus: document.getElementById("focus").value.trim(),
      count: parseInt(document.getElementById("ivn").value, 10) || 8,
    });
    renderInterviewQuestions(j, out);
  } catch (e) {
    out.textContent = "错误：" + e.message;
  }
};

document.getElementById("btnIng").onclick = async () => {
  const out = document.getElementById("outAdm");
  out.textContent = "…";
  try {
    const j = await post("/api/admin/ingest", { reset: document.getElementById("ingReset").checked });
    out.textContent = JSON.stringify(j, null, 2);
  } catch (e) {
    out.textContent = "错误：" + e.message;
  }
};
