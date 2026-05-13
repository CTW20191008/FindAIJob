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

/** 简历下拉/列表/分析区展示名：优先用 Markdown 标题，避免出现文件名里的 uploaded。 */
function resumeDisplayName(filename, resumeList) {
  if (!filename) return "";
  const row = resumeList?.find((r) => r.filename === filename);
  if (row?.title?.trim()) {
    const t = row.title.trim();
    const m = t.match(/^简历[（(](.+)[）)]$/);
    if (m) {
      const inner = (m[1] || "").trim();
      if (inner && !/^uploaded$/i.test(inner)) return inner;
    }
    if (!/^uploaded$/i.test(t)) return t;
  }
  const stem = filename.replace(/^resume_facts_(?:\d{8}_\d{6}_)?/i, "").replace(/\.md$/i, "");
  if (!stem || /^uploaded$/i.test(stem)) return "简历";
  return stem;
}

// ── 简历上传（多份）──
(function () {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("resumeFile");
  const status = document.getElementById("uploadStatus");

  function setStatus(html, type) {
    status.innerHTML = html;
    status.className = "upload-status " + (type || "");
    status.classList.remove("hidden");
  }

  async function uploadFile(file) {
    if (!file) return;
    const allowed = [".pdf", ".docx", ".doc"];
    if (!allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setStatus("仅支持 PDF / DOCX 格式", "err"); return;
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
      setStatus(`✅ <strong>${file.name}</strong> 上传成功，已建立 <strong>${j.chunk_count}</strong> 个索引片段`, "ok");
      dropZone.querySelector(".drop-title").textContent = "拖拽简历到此处，或点击选择文件";
      fileInput.value = "";
      loadResumeList();
    } catch (e) {
      setStatus("❌ 上传失败：" + e.message, "err");
    } finally { dropZone.classList.remove("uploading"); }
  }

  dropZone.onclick = () => fileInput.click();
  fileInput.onchange = () => uploadFile(fileInput.files[0]);
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); };
  dropZone.ondragleave = () => dropZone.classList.remove("drag-over");
  dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove("drag-over"); uploadFile(e.dataTransfer.files[0]); };

  loadResumeList();
})();

async function loadResumeList() {
  const list = document.getElementById("resumeList");
  if (!list) return;
  try {
    const items = await apiFetch("/api/resumes");
    if (!items.length) { list.innerHTML = "<p class='jd-empty'>暂无简历，上传后显示在此处</p>"; return; }
    list.innerHTML = "";
    items.forEach(item => {
      const displayTitle = resumeDisplayName(item.filename, items);
      const date = new Date(item.modified_at * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const kb = (item.size / 1024).toFixed(1);
      const row = document.createElement("div");
      row.className = "note-row";
      row.innerHTML = `
        <div class="note-info">
          <p class="note-title-text">${displayTitle}</p>
          <p class="note-meta">${date} · ${kb} KB</p>
        </div>
        <div class="note-actions">
          <button class="btn-note-edit" data-fn="${item.filename}">编辑</button>
          <button class="btn-note-del" data-fn="${item.filename}">删除</button>
        </div>`;

      const editorRow = document.createElement("div");
      editorRow.className = "note-editor-row hidden";
      editorRow.innerHTML = `
        <input class="note-edit-title" placeholder="简历标题" />
        <textarea class="note-edit-content" rows="12" placeholder="正文"></textarea>
        <div class="note-edit-actions">
          <button class="btn-note-save-edit">保存并重建索引</button>
          <button class="btn-note-cancel-edit">取消</button>
          <span class="edit-inline-status"></span>
        </div>`;

      list.appendChild(row);
      list.appendChild(editorRow);

      row.querySelector(".btn-note-edit").onclick = async () => {
        const isOpen = !editorRow.classList.contains("hidden");
        if (isOpen) { editorRow.classList.add("hidden"); return; }
        editorRow.querySelector(".note-edit-title").value = "加载中…";
        editorRow.querySelector(".note-edit-content").value = "";
        editorRow.classList.remove("hidden");
        try {
          const note = await apiFetch(`/api/resumes/${encodeURIComponent(item.filename)}`);
          editorRow.querySelector(".note-edit-title").value = note.title || "";
          editorRow.querySelector(".note-edit-content").value = note.content || "";
        } catch (e) {
          editorRow.querySelector(".edit-inline-status").textContent = "加载失败：" + e.message;
        }
      };

      editorRow.querySelector(".btn-note-save-edit").onclick = async () => {
        const statusEl = editorRow.querySelector(".edit-inline-status");
        statusEl.textContent = "⏳ 保存中…";
        try {
          const r = await apiFetch(`/api/resumes/${encodeURIComponent(item.filename)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: editorRow.querySelector(".note-edit-title").value.trim(),
              content: editorRow.querySelector(".note-edit-content").value,
            }),
          });
          statusEl.textContent = `✅ 已保存，索引 ${r.chunk_count} 片段`;
          setTimeout(() => { editorRow.classList.add("hidden"); loadResumeList(); }, 1200);
        } catch (e) { statusEl.textContent = "❌ " + e.message; }
      };

      editorRow.querySelector(".btn-note-cancel-edit").onclick = () => editorRow.classList.add("hidden");

      row.querySelector(".btn-note-del").onclick = async () => {
        if (!confirm(`确认删除简历「${displayTitle}」？`)) return;
        try {
          await apiFetch(`/api/resumes/${encodeURIComponent(item.filename)}`, { method: "DELETE" });
          loadResumeList();
        } catch (e) { alert("删除失败：" + e.message); }
      };
    });
  } catch (e) { list.innerHTML = `<p class='jd-empty'>加载失败：${e.message}</p>`; }
}

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

function renderAnswer(j, container) {
  container.innerHTML = "";

  // Answer body — rendered as Markdown
  const body = document.createElement("div");
  body.className = "answer-body";
  const md = (typeof marked !== "undefined")
    ? marked.parse(j.answer || "（无回答）")
    : (j.answer || "（无回答）").replace(/\n/g, "<br>");
  body.innerHTML = md;
  container.appendChild(body);

  // Citations
  const cites = j.citations || [];
  if (cites.length) {
    const details = document.createElement("details");
    details.className = "answer-cites";
    const summary = document.createElement("summary");
    summary.textContent = `引用来源（${cites.length} 处）`;
    details.appendChild(summary);
    const list = document.createElement("ul");
    list.className = "cite-list";
    cites.forEach((c) => {
      const li = document.createElement("li");
      const typeLabel = { resume: "简历", study: "笔记", question_bank: "题库" }[c.doc_type] || c.doc_type;
      li.innerHTML =
        `<span class="cite-tag">${typeLabel}</span>` +
        `<span class="cite-path">${c.source_path}</span>` +
        (c.heading_path && c.heading_path !== "(root)"
          ? `<span class="cite-heading"> § ${c.heading_path}</span>` : "");
      list.appendChild(li);
    });
    details.appendChild(list);
    container.appendChild(details);
  }

  // Chunks (optional debug)
  if (j.chunks?.length) {
    const details = document.createElement("details");
    details.className = "answer-cites";
    const summary = document.createElement("summary");
    summary.textContent = `检索片段（${j.chunks.length} 条）`;
    details.appendChild(summary);
    j.chunks.forEach((c) => {
      const pre = document.createElement("pre");
      pre.className = "chunk-pre";
      pre.textContent = `[${c.doc_type}] ${c.source_path} § ${c.heading_path}\n${c.snippet}`;
      details.appendChild(pre);
    });
    container.appendChild(details);
  }
}

document.getElementById("btnAsk").onclick = async () => {
  const out = document.getElementById("outAsk");
  out.innerHTML = "<span style='color:var(--muted)'>思考中…</span>";
  try {
    const dtype = document.getElementById("dtype").value;
    const j = await post("/api/ask", {
      question: document.getElementById("q").value.trim(),
      doc_type: dtype || null,
      jd_entry_id: null,
      show_chunks: document.getElementById("showChunks").checked,
    });
    renderAnswer(j, out);
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

let _currentJdId = null;      // selected JD in catalog
let _currentAnalysisId = null; // selected analysis

// ── JD Catalog ──────────────────────────────────────────────────────────────

// ---- JD Edit Form ----
let _editingJdId = null;

function showJdForm(jd = null) {
  _editingJdId = jd?.id || null;
  document.getElementById("jdCompany").value = jd?.company || "";
  document.getElementById("jdPosition").value = jd?.position || "";
  document.getElementById("jdText").value = jd?.jd_text || "";
  document.getElementById("jdFormStatus").textContent = "";
  document.getElementById("jdEditForm").classList.remove("hidden");
}
function hideJdForm() {
  document.getElementById("jdEditForm").classList.add("hidden");
  _editingJdId = null;
}

document.getElementById("btnAddJD")?.addEventListener("click", () => showJdForm());
document.getElementById("btnCancelJD")?.addEventListener("click", hideJdForm);

document.getElementById("btnSaveJD")?.addEventListener("click", async () => {
  const company = document.getElementById("jdCompany").value.trim();
  const position = document.getElementById("jdPosition").value.trim();
  const jd_text = document.getElementById("jdText").value.trim();
  const st = document.getElementById("jdFormStatus");
  if (!company || !position || !jd_text) { st.textContent = "请填写公司、岗位和 JD 文本"; return; }
  st.textContent = "⏳ 保存中…";
  try {
    if (_editingJdId) {
      await apiFetch(`/api/jd-catalog/${_editingJdId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, position, jd_text }),
      });
    } else {
      const jd = await apiFetch("/api/jd-catalog", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, position, jd_text }),
      });
      _currentJdId = jd.id;
    }
    hideJdForm();
    await loadJDCatalog();
    if (_currentJdId) loadJDAnalyses(_currentJdId);
  } catch (e) { st.textContent = "❌ " + e.message; }
});

// ---- Catalog List ----
async function loadJDCatalog() {
  const list = document.getElementById("jdCatalogList");
  if (!list) return;
  try {
    const items = await apiFetch("/api/jd-catalog");
    if (!items.length) { list.innerHTML = "<p class='jd-empty'>暂无 JD，点击「＋ 添加 JD」开始</p>"; return; }
    list.innerHTML = "";
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "jd-cat-row" + (_currentJdId === item.id ? " active" : "");
      row.dataset.id = item.id;
      const date = new Date(item.updated_at || item.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit" });
      row.innerHTML = `
        <div class="jd-cat-info" data-id="${item.id}">
          <p class="jd-cat-title">${item.company} · ${item.position}</p>
          <p class="jd-cat-meta">${date} · ${item.analysis_count ?? 0} 次分析</p>
        </div>
        <div class="jd-cat-actions">
          <button class="btn-cat-edit" data-id="${item.id}" title="编辑 JD">✏️</button>
          <button class="btn-cat-del" data-id="${item.id}" title="删除 JD 及所有分析">🗑</button>
        </div>`;
      list.appendChild(row);

      row.querySelector(".jd-cat-info").onclick = () => {
        _currentJdId = item.id;
        document.querySelectorAll(".jd-cat-row").forEach(r => r.classList.toggle("active", r.dataset.id === item.id));
        loadJDAnalyses(item.id);
      };
      row.querySelector(".btn-cat-edit").onclick = async (e) => {
        e.stopPropagation();
        const jd = await apiFetch(`/api/jd-catalog/${item.id}`);
        showJdForm(jd);
      };
      row.querySelector(".btn-cat-del").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`删除「${item.company} · ${item.position}」及其所有分析记录？`)) return;
        await apiFetch(`/api/jd-catalog/${item.id}`, { method: "DELETE" });
        if (_currentJdId === item.id) { _currentJdId = null; resetAnalysisPane(); }
        loadJDCatalog();
        populateIVSelector();
      };
    });
  } catch (e) { list.innerHTML = `<p class='jd-empty'>加载失败：${e.message}</p>`; }
}

function resetAnalysisPane() {
  document.getElementById("jdAnalysisPane").innerHTML = "<p class='jd-empty'>← 从左侧选择一个 JD 开始分析</p>";
  document.getElementById("jdAnalysisPane").className = "jd-analysis-empty";
}

// ---- Analysis Panel ----
async function loadJDAnalyses(jd_id) {
  const pane = document.getElementById("jdAnalysisPane");
  pane.className = "";
  pane.innerHTML = "<span style='color:var(--muted)'>加载中…</span>";

  const jd = await apiFetch(`/api/jd-catalog/${jd_id}`);
  const analyses = await apiFetch(`/api/jd-catalog/${jd_id}/analyses`);
  const resumes = await apiFetch("/api/resumes");

  pane.innerHTML = "";

  // Header
  const hdr = document.createElement("div");
  hdr.className = "jd-analysis-header";
  hdr.innerHTML = `<h3 class="jd-analysis-title">${jd.company} · ${jd.position}</h3>`;
  pane.appendChild(hdr);

  // Match button
  const matchRow = document.createElement("div");
  matchRow.className = "jd-match-row";
  const resSel = document.createElement("select");
  resSel.className = "jd-res-sel";
    resSel.innerHTML = `<option value="">全部简历</option>` +
    resumes.map((r) => `<option value="${r.filename}">${resumeDisplayName(r.filename, resumes)}</option>`).join("");
  const matchBtn = document.createElement("button");
  matchBtn.textContent = "分析匹配度";
  matchBtn.className = "btn-match";
  const matchStatus = document.createElement("span");
  matchStatus.className = "edit-inline-status";
  matchRow.appendChild(resSel);
  matchRow.appendChild(matchBtn);
  matchRow.appendChild(matchStatus);
  pane.appendChild(matchRow);

  // Result area
  const resultArea = document.createElement("div");
  resultArea.id = "jdMatchResult";
  pane.appendChild(resultArea);

  matchBtn.onclick = async () => {
    matchStatus.textContent = "⏳ 分析中…";
    matchBtn.disabled = true;
    resultArea.innerHTML = "";
    try {
      const j = await post("/api/jd-match", {
        jd_id,
        resume_filename: resSel.value || null,
        analysis_id: _currentAnalysisId || null,
      });
      _currentAnalysisId = j.analysis_id;
      matchStatus.textContent = "";
      renderJDAnalysis(j, resultArea);
      loadJDCatalog();
      loadJDAnalyses(jd_id);
    } catch (e) { matchStatus.textContent = "❌ " + e.message; }
    finally { matchBtn.disabled = false; }
  };

  // Analysis history list
  if (analyses.length) {
    const secTitle = document.createElement("h4");
    secTitle.className = "jd-analyses-title";
    secTitle.textContent = `历史分析（${analyses.length} 次）`;
    pane.appendChild(secTitle);

    analyses.forEach(a => {
      const scoreColor = a.analysis?.score >= 75 ? "#6ecf8e" : a.analysis?.score >= 50 ? "#e8c76a" : "#e07070";
      const resumeLabel = a.resume_filename
        ? resumeDisplayName(a.resume_filename, resumes)
        : "全部简历";
      const matchDate = new Date(a.matched_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const qbBadge = a.has_question_bank ? `<span class="qb-badge">📚 题库</span>` : "";

      const aRow = document.createElement("div");
      aRow.className = "jd-anal-row";
      aRow.innerHTML = `
        <div class="jd-anal-info">
          <span class="jd-anal-score" style="color:${scoreColor}">${a.analysis?.score ?? "—"}</span>
          <div>
            <p class="jd-anal-label">📄 ${resumeLabel} ${qbBadge}</p>
            <p class="jd-cat-meta">${matchDate} · ${a.analysis?.summary || ""}</p>
          </div>
        </div>
        <div class="jd-hist-actions">
          <button class="btn-hist-load" data-id="${a.id}">查看</button>
          <button class="btn-hist-rematch" data-id="${a.id}" data-resume="${a.resume_filename || ''}">重新分析</button>
          <button class="btn-hist-qb ${a.has_question_bank ? 'has-qb' : ''}" data-id="${a.id}">
            ${a.has_question_bank ? '🔄 重新生成题库' : '📚 生成题库'}
          </button>
          <button class="btn-hist-del" data-id="${a.id}">删除</button>
        </div>`;
      pane.appendChild(aRow);

      aRow.querySelector(".btn-hist-load").onclick = () => {
        _currentAnalysisId = a.id;
        resSel.value = a.resume_filename || "";
        renderJDAnalysis({ analysis: a.analysis, citations: [] }, resultArea);
        resultArea.scrollIntoView({ behavior: "smooth" });
      };

      aRow.querySelector(".btn-hist-rematch").onclick = async () => {
        _currentAnalysisId = a.id;
        resSel.value = a.resume_filename || "";
        matchBtn.click();
      };

      aRow.querySelector(".btn-hist-qb").onclick = async (btn_e) => {
        const btn = btn_e.currentTarget;
        if (!confirm("生成题库约需 30 秒，确认？")) return;
        btn.disabled = true; btn.textContent = "⏳ 生成中…";
        try {
          const r = await apiFetch(`/api/jd-history/${a.id}/question-bank`, { method: "POST" });
          alert(`✅ 题库生成完成！共 ${r.question_count} 道题，${r.categories.join("、")}，已建立索引。`);
          loadJDAnalyses(jd_id);
          populateIVSelector();
        } catch (e) { alert("❌ " + e.message); btn.disabled = false; }
      };

      aRow.querySelector(".btn-hist-del").onclick = async () => {
        if (!confirm("删除此次分析记录？JD 本身保留。")) return;
        await apiFetch(`/api/jd-history/${a.id}`, { method: "DELETE" });
        if (_currentAnalysisId === a.id) { _currentAnalysisId = null; resultArea.innerHTML = ""; }
        loadJDCatalog();
        loadJDAnalyses(jd_id);
      };
    });
  }
}

// Cache analyses-with-QB for pill switching
let _jdItems = [];  // [{id, company, position, qb_categories}]

async function populateIVSelector() {
  const sel = document.getElementById("ivJdFilter");
  if (!sel) return;
  const current = sel.value;
  try {
    // Fetch all analyses that have question banks
    const catalog = await apiFetch("/api/jd-catalog");
    const withQB = [];
    for (const jd of catalog) {
      const analyses = await apiFetch(`/api/jd-catalog/${jd.id}/analyses`);
      for (const a of analyses) {
        if (a.has_question_bank) {
          withQB.push({ id: a.id, company: jd.company, position: jd.position, qb_categories: a.qb_categories || [] });
        }
      }
    }
    _jdItems = withQB;
    while (sel.options.length > 1) sel.remove(1);
    withQB.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.company} · ${item.position}`;
      sel.appendChild(opt);
    });
    if (current && [...sel.options].some((o) => o.value === current)) sel.value = current;
  } catch (_) {}
  updateFocusUI();
}

function updateFocusUI() {
  const sel = document.getElementById("ivJdFilter");
  const freeText = document.getElementById("focus");
  const pillsWrap = document.getElementById("focusPills");
  const pillList = document.getElementById("pillList");
  if (!sel) return;

  const selectedId = sel.value;
  const item = _jdItems.find((i) => i.id === selectedId);
  const categories = item?.qb_categories || [];

  if (selectedId && categories.length > 0) {
    freeText.classList.add("hidden");
    pillsWrap.classList.remove("hidden");
    pillList.innerHTML = "";
    categories.forEach((cat) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "focus-pill";
      pill.textContent = cat;
      pill.onclick = () => pill.classList.toggle("active");
      pillList.appendChild(pill);
    });
  } else {
    freeText.classList.remove("hidden");
    pillsWrap.classList.add("hidden");
  }
}

document.getElementById("ivJdFilter")?.addEventListener("change", updateFocusUI);

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

// ── 学习笔记 ──
(function () {
  const modeText = document.getElementById("modeText");
  const modeFile = document.getElementById("modeFile");
  const textArea = document.getElementById("noteTextArea");
  const fileArea = document.getElementById("noteFileArea");
  const status   = document.getElementById("noteStatus");
  const dropZone = document.getElementById("noteDropZone");
  const fileInput = document.getElementById("noteFile");

  function setNoteStatus(html, type) {
    status.innerHTML = html;
    status.className = "upload-status " + (type || "");
    status.classList.remove("hidden");
  }

  modeText?.addEventListener("click", () => {
    modeText.classList.add("mode-on"); modeFile.classList.remove("mode-on");
    textArea.classList.remove("hidden"); fileArea.classList.add("hidden");
  });
  modeFile?.addEventListener("click", () => {
    modeFile.classList.add("mode-on"); modeText.classList.remove("mode-on");
    fileArea.classList.remove("hidden"); textArea.classList.add("hidden");
  });

  // Save text note
  document.getElementById("btnSaveNote")?.addEventListener("click", async () => {
    const title = document.getElementById("noteTitle").value.trim();
    const content = document.getElementById("noteContent").value.trim();
    if (!title) { setNoteStatus("请填写笔记标题", "err"); return; }
    if (!content) { setNoteStatus("请填写笔记内容", "err"); return; }
    setNoteStatus("⏳ 保存中…", "loading");
    try {
      const r = await post("/api/notes", { title, content });
      setNoteStatus(`✅ 已保存「${title}」，索引 <strong>${r.chunk_count}</strong> 片段`, "ok");
      document.getElementById("noteTitle").value = "";
      document.getElementById("noteContent").value = "";
      loadNotesList();
    } catch (e) { setNoteStatus("❌ 保存失败：" + e.message, "err"); }
  });

  // Upload file note
  async function uploadNote(file) {
    if (!file) return;
    const allowed = [".pdf", ".docx", ".doc"];
    if (!allowed.some(ext => file.name.toLowerCase().endsWith(ext))) {
      setNoteStatus("仅支持 PDF / DOCX 格式", "err"); return;
    }
    const title = document.getElementById("noteTitleFile").value.trim() || "";
    setNoteStatus("⏳ 上传并建立索引中…", "loading");
    dropZone.classList.add("uploading");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    const k = localStorage.getItem(KEY) || document.getElementById("apiKey").value.trim();
    const headers = {};
    if (k) { headers["Authorization"] = "Bearer " + k; headers["X-Api-Key"] = k; }
    try {
      const r = await fetch("/api/notes/upload", { method: "POST", headers, body: fd });
      const j = await r.json();
      if (!r.ok) {
        const msg = Array.isArray(j.detail)
          ? j.detail.map(d => d.msg || JSON.stringify(d)).join("; ")
          : (j.detail || JSON.stringify(j));
        throw new Error(msg);
      }
      setNoteStatus(`✅ 已保存「${j.filename}」，索引 <strong>${j.chunk_count}</strong> 片段`, "ok");
      dropZone.querySelector(".drop-title").textContent = "拖拽文件到此处，或点击选择";
      document.getElementById("noteTitleFile").value = "";
      loadNotesList();
    } catch (e) { setNoteStatus("❌ 上传失败：" + e.message, "err"); }
    finally { dropZone.classList.remove("uploading"); }
  }

  document.getElementById("btnUploadNote")?.addEventListener("click", () => {
    if (fileInput.files[0]) uploadNote(fileInput.files[0]);
    else fileInput.click();
  });
  dropZone?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", () => uploadNote(fileInput.files[0]));
  dropZone?.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone?.addEventListener("drop", e => {
    e.preventDefault(); dropZone.classList.remove("drag-over");
    uploadNote(e.dataTransfer.files[0]);
  });
})();

async function loadNotesList() {
  const list = document.getElementById("notesList");
  if (!list) return;
  try {
    const items = await apiFetch("/api/notes");
    if (!items.length) { list.innerHTML = "<p class='jd-empty'>暂无笔记，保存后显示在此处</p>"; return; }
    list.innerHTML = "";
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "note-row";
      const date = new Date(item.modified_at * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const kb = (item.size / 1024).toFixed(1);
      row.innerHTML = `
        <div class="note-info">
          <p class="note-title-text">${item.title}</p>
          <p class="note-meta">${date} · ${kb} KB</p>
        </div>
        <div class="note-actions">
          <button class="btn-note-edit" data-fn="${item.filename}">编辑</button>
          <button class="btn-note-del" data-fn="${item.filename}">删除</button>
        </div>`;

      // Inline editor row (hidden initially)
      const editorRow = document.createElement("div");
      editorRow.className = "note-editor-row hidden";
      editorRow.innerHTML = `
        <input class="note-edit-title" placeholder="标题" />
        <textarea class="note-edit-content" rows="8" placeholder="正文"></textarea>
        <div class="note-edit-actions">
          <button class="btn-note-save-edit">保存并重建索引</button>
          <button class="btn-note-cancel-edit">取消</button>
          <span class="edit-inline-status"></span>
        </div>`;
      list.appendChild(row);
      list.appendChild(editorRow);

      // Edit button
      row.querySelector(".btn-note-edit").onclick = async () => {
        const isOpen = !editorRow.classList.contains("hidden");
        if (isOpen) { editorRow.classList.add("hidden"); return; }
        editorRow.querySelector(".note-edit-title").value = "加载中…";
        editorRow.querySelector(".note-edit-content").value = "";
        editorRow.classList.remove("hidden");
        try {
          const note = await apiFetch(`/api/notes/${encodeURIComponent(item.filename)}`);
          editorRow.querySelector(".note-edit-title").value = note.title || "";
          editorRow.querySelector(".note-edit-content").value = note.content || "";
        } catch (e) {
          editorRow.querySelector(".note-edit-title").value = "";
          editorRow.querySelector(".edit-inline-status").textContent = "加载失败：" + e.message;
        }
      };

      // Save edit
      editorRow.querySelector(".btn-note-save-edit").onclick = async () => {
        const statusEl = editorRow.querySelector(".edit-inline-status");
        statusEl.textContent = "⏳ 保存中…";
        try {
          const r = await apiFetch(`/api/notes/${encodeURIComponent(item.filename)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: editorRow.querySelector(".note-edit-title").value.trim(),
              content: editorRow.querySelector(".note-edit-content").value,
            }),
          });
          statusEl.textContent = `✅ 已保存，索引 ${r.chunk_count} 片段`;
          setTimeout(() => { editorRow.classList.add("hidden"); loadNotesList(); }, 1200);
        } catch (e) { statusEl.textContent = "❌ " + e.message; }
      };

      // Cancel
      editorRow.querySelector(".btn-note-cancel-edit").onclick = () => editorRow.classList.add("hidden");
    });

    list.querySelectorAll(".btn-note-del").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`确认删除「${btn.dataset.fn}」？`)) return;
        try {
          await apiFetch(`/api/notes/${encodeURIComponent(btn.dataset.fn)}`, { method: "DELETE" });
          loadNotesList();
        } catch (e) { alert("删除失败：" + e.message); }
      };
    });
  } catch (e) { list.innerHTML = `<p class='jd-empty'>加载失败：${e.message}</p>`; }
}

// Load history when JD tab is opened
document.querySelectorAll(".tabs button").forEach((btn) => {
  const origOnclick = btn.onclick;
  btn.addEventListener("click", () => {
    if (btn.dataset.tab === "jd") loadJDCatalog();
    if (btn.dataset.tab === "iv") populateIVSelector();
    if (btn.dataset.tab === "notes") loadNotesList();
  });
});

function renderCompareResult(r, container) {
  const score = typeof r.score === "number" ? r.score : 0;
  const levelColor = score >= 8 ? "#6ecf8e" : score >= 6 ? "#e8c76a" : score >= 4 ? "#e09a40" : "#e07070";
  const levelMap = { "优秀": "#6ecf8e", "良好": "#a8d88a", "一般": "#e8c76a", "需加强": "#e07070" };
  const lvColor = levelMap[r.level] || levelColor;

  function section(title, items, color) {
    if (!items?.length) return "";
    const lis = items.map(s => `<li>${s}</li>`).join("");
    return `<div class="cmp-sec"><p class="cmp-sec-title" style="color:${color}">${title}</p><ul class="cmp-list">${lis}</ul></div>`;
  }

  container.innerHTML = `
    <div class="cmp-header">
      <span class="cmp-score" style="--lc:${levelColor}">${score}<span class="cmp-score-max">/10</span></span>
      <span class="cmp-level" style="color:${lvColor}">${r.level || "—"}</span>
    </div>
    ${section("✅ 亮点", r.strengths, "#6ecf8e")}
    ${section("🔴 不足", r.gaps, "#e07070")}
    ${section("💡 改进建议", r.suggestions, "var(--accent)")}
    ${section("📌 参考要点", r.sample_points, "#8b97a8")}`;
}

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

    // User answer + compare
    const ansWrap = document.createElement("div");
    ansWrap.className = "iv-ans-wrap";

    const ta = document.createElement("textarea");
    ta.className = "iv-ans-input";
    ta.placeholder = "写下你的回答，点击「对比分析」获取评分和建议…";
    ta.rows = 4;
    ansWrap.appendChild(ta);

    const cmpBtn = document.createElement("button");
    cmpBtn.className = "btn-cmp";
    cmpBtn.textContent = "对比分析";
    ansWrap.appendChild(cmpBtn);

    const cmpResult = document.createElement("div");
    cmpResult.className = "cmp-result hidden";
    ansWrap.appendChild(cmpResult);

    cmpBtn.onclick = async () => {
      const userAns = ta.value.trim();
      cmpBtn.disabled = true;
      cmpBtn.textContent = "分析中…";
      cmpResult.classList.add("hidden");
      try {
        const r = await post("/api/answer-compare", {
          question: q.question,
          user_answer: userAns,
          hint: q.hint || q.answer || "",
        });
        renderCompareResult(r, cmpResult);
        cmpResult.classList.remove("hidden");
      } catch (e) {
        cmpResult.innerHTML = `<p style="color:#e07070">错误：${e.message}</p>`;
        cmpResult.classList.remove("hidden");
      } finally {
        cmpBtn.disabled = false;
        cmpBtn.textContent = "重新分析";
      }
    };

    card.appendChild(ansWrap);
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
    const jdFilter = document.getElementById("ivJdFilter").value;
    // Collect focus: selected pills if visible, else free text
    const activePills = [...document.querySelectorAll(".focus-pill.active")].map((p) => p.textContent);
    const focusVal = activePills.length > 0
      ? activePills.join("、")
      : document.getElementById("focus").value.trim();
    const j = await post("/api/interview-questions", {
      focus: focusVal,
      count: Math.min(20, Math.max(1, parseInt(document.getElementById("ivn").value, 10) || 8)),
      jd_entry_id: jdFilter || null,
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
