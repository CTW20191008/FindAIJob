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
    if (btn.dataset.tab === "track" && typeof window.bootJobTrack === "function") {
      window.bootJobTrack();
    }
  };
});

function formatFastApiErrorPayload(j) {
  if (!j || typeof j !== "object") return String(j);
  const d = j.detail;
  if (Array.isArray(d)) {
    return d.map((e) => `${e.loc?.filter(Boolean).join(".") || "body"}: ${e.msg || ""}`).join("\n");
  }
  if (typeof d === "string") return d;
  return JSON.stringify(j, null, 2);
}

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
  if (!r.ok) throw new Error(formatFastApiErrorPayload(j));
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

let _currentJdId = null;      // selected JD in catalog / match pane
let _jdLibExpandedRowId = null; // which catalog row currently has inline editor under it
let _currentAnalysisId = null; // selected analysis

// ── JD Catalog ──────────────────────────────────────────────────────────────

function detachJdDetailPanel() {
  const holder = document.getElementById("jdLibDockHolder");
  const detail = document.getElementById("jdLibDetailBelow");
  if (detail && holder) {
    holder.appendChild(detail);
    detail.classList.add("hidden");
    detail.classList.remove("jd-lib-detail--inline");
  }
  _jdLibExpandedRowId = null;
}

function collapseJdLibDetail() {
  detachJdDetailPanel();
  _currentJdId = null;
  document.querySelectorAll("#jdCatalogList .jd-cat-row").forEach((r) =>
    r.classList.remove("active"));
  const stEl = document.getElementById("jdLibStatus");
  if (stEl) stEl.textContent = "";
}


// ---- 上方表单：仅「新建 JD」（避免与下方完整编辑重复）----
function showJdFormNew() {
  document.getElementById("jdCompany").value = "";
  document.getElementById("jdPosition").value = "";
  document.getElementById("jdText").value = "";
  document.getElementById("jdFormStatus").textContent = "";
  document.getElementById("jdEditForm").classList.remove("hidden");
}

function hideJdForm() {
  document.getElementById("jdEditForm").classList.add("hidden");
}

document.getElementById("btnAddJD")?.addEventListener("click", () => {
  void loadCatalogEditorPane(null);
  showJdFormNew();
});
document.getElementById("btnCancelJD")?.addEventListener("click", hideJdForm);

document.getElementById("btnSaveJD")?.addEventListener("click", async () => {
  const company = document.getElementById("jdCompany").value.trim();
  const position = document.getElementById("jdPosition").value.trim();
  const jd_text = document.getElementById("jdText").value.trim();
  const st = document.getElementById("jdFormStatus");
  if (!company || !position || !jd_text) { st.textContent = "请填写公司、岗位和 JD 文本"; return; }
  st.textContent = "⏳ 保存中…";
  try {
    const jd = await apiFetch("/api/jd-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, position, jd_text }),
    });
    _currentJdId = jd.id;
    hideJdForm();
    await loadJDCatalog();
    await loadCatalogEditorPane(_currentJdId);
    await populateJdMatchSelect();
  } catch (e) { st.textContent = "❌ " + e.message; }
});

async function runJdCatalogQuestionBank(jdId, btn) {
  if (
    !confirm(
      "将按该 JD 与知识库里已索引的简历等材料生成「面试题库」并入索引（约半分钟）；若已生成过则会覆盖后重新 ingest。确定？"
    )
  )
    return;
  const el = btn || null;
  const orig = el ? el.textContent : "";
  if (el) {
    el.disabled = true;
    el.textContent = "…";
  }
  try {
    const r = await post(`/api/jd-catalog/${encodeURIComponent(jdId)}/question-bank`, {});
    const cats = Array.isArray(r.categories) ? r.categories.filter(Boolean).join("、") : "";
    alert(`✅ 题库已生成：${r.question_count ?? 0} 道题${cats ? `（${cats}）` : ""}`);
    await loadJDCatalog();
    await populateJdMatchSelect();
    await populateIVSelector();
    if (_currentJdId === jdId) await loadCatalogEditorPane(jdId);
  } catch (e) {
    alert("❌ " + e.message);
  } finally {
    if (el) {
      el.disabled = false;
      el.textContent = orig;
    }
  }
}

// ---- Catalog List ----
async function loadJDCatalog() {
  const list = document.getElementById("jdCatalogList");
  if (!list) return;
  const reopenId = _jdLibExpandedRowId;
  detachJdDetailPanel();
  try {
    const items = await apiFetch("/api/jd-catalog");
    if (!items.length) {
      list.innerHTML = "<p class='jd-empty'>暂无 JD，点击「＋ 添加 JD」开始</p>";
      collapseJdLibDetail();
      return;
    }
    list.innerHTML = "";
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "jd-cat-row";
      row.dataset.id = item.id;
      const date = new Date(item.updated_at || item.created_at).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      });
      row.innerHTML = `
        <div class="jd-cat-info" data-id="${item.id}">
          <p class="jd-cat-title">${item.company} · ${item.position}</p>
          <p class="jd-cat-meta">${date} · ${item.analysis_count ?? 0} 次分析</p>
        </div>
        <div class="jd-cat-actions">
          <button class="btn-cat-edit" data-id="${item.id}" title="编辑 JD">✏️</button>
          <button class="btn-cat-qb" data-id="${item.id}" title="生成面试题库">📚</button>
          <button class="btn-cat-del" data-id="${item.id}" title="删除 JD 及所有分析">🗑</button>
        </div>`;
      list.appendChild(row);

      row.querySelector(".jd-cat-info").onclick = () => {
        hideJdForm();
        if (_jdLibExpandedRowId === item.id) {
          collapseJdLibDetail();
          return;
        }
        void (async () => {
          await loadCatalogEditorPane(item.id);
          document.getElementById("jdLibDetailBelow")?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        })();
      };
      row.querySelector(".btn-cat-edit").onclick = async (e) => {
        e.stopPropagation();
        hideJdForm();
        if (_jdLibExpandedRowId === item.id) {
          collapseJdLibDetail();
          return;
        }
        await loadCatalogEditorPane(item.id);
        document.getElementById("jdLibDetailBelow")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      };
      row.querySelector(".btn-cat-qb").onclick = async (e) => {
        e.stopPropagation();
        await runJdCatalogQuestionBank(item.id, e.currentTarget);
      };
      row.querySelector(".btn-cat-del").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`删除「${item.company} · ${item.position}」及其所有分析记录？`)) return;
        await apiFetch(`/api/jd-catalog/${item.id}`, { method: "DELETE" });
        if (_currentJdId === item.id) {
          resetAnalysisPane();
          collapseJdLibDetail();
        }
        await loadJDCatalog();
        populateIVSelector();
        void populateJdMatchSelect();
      };
    });

    const rid = reopenId && items.some((x) => x.id === reopenId) ? reopenId : null;
    if (rid) await loadCatalogEditorPane(rid);
  } catch (e) {
    list.innerHTML = `<p class='jd-empty'>加载失败：${e.message}</p>`;
  }
}

function resetAnalysisPane() {
  document.getElementById("jdAnalysisPane").innerHTML =
    '<p class="jd-empty">请在本页上方的「JD」下拉框中选择一条，或先到「JD 资料库」页签添加条目。</p>';
  document.getElementById("jdAnalysisPane").className = "jd-analysis-empty";
}

async function loadCatalogEditorPane(jdId) {
  const detail = document.getElementById("jdLibDetailBelow");
  const stEl = document.getElementById("jdLibStatus");
  if (!detail) return;
  if (!jdId || !String(jdId).trim()) {
    collapseJdLibDetail();
    return;
  }

  detachJdDetailPanel();

  const id = String(jdId).trim();
  const row = [...document.querySelectorAll("#jdCatalogList .jd-cat-row")].find((r) => r.dataset.id === id);
  if (!row) {
    collapseJdLibDetail();
    return;
  }

  if (stEl) stEl.textContent = "";
  try {
    const jd = await apiFetch(`/api/jd-catalog/${encodeURIComponent(id)}`);
    const h = document.getElementById("jdLibHdr");
    if (h) h.textContent = `编辑：${jd.company || "?"} · ${jd.position || "?"}`;
    document.getElementById("jdLibCompany").value = jd.company || "";
    document.getElementById("jdLibPosition").value = jd.position || "";
    document.getElementById("jdLibText").value = jd.jd_text || "";
    document.getElementById("jdLibKw").value = jd.jd_keywords || "";
    document.getElementById("jdLibNotes").value = jd.notes || "";

    row.insertAdjacentElement("afterend", detail);
    detail.classList.remove("hidden");
    detail.classList.add("jd-lib-detail--inline");
    _jdLibExpandedRowId = id;
    _currentJdId = id;
    document.querySelectorAll("#jdCatalogList .jd-cat-row").forEach((r) =>
      r.classList.toggle("active", r.dataset.id === id));
  } catch (e) {
    if (stEl) stEl.textContent = "加载失败：" + e.message;
    collapseJdLibDetail();
  }
}

async function populateJdMatchSelect() {
  const sel = document.getElementById("jdMatchSel");
  if (!sel) return;
  const cur = (_currentJdId && String(_currentJdId).trim()) || sel.value.trim();
  let items = [];
  try {
    items = await apiFetch("/api/jd-catalog");
  } catch {
    return;
  }
  sel.innerHTML = `<option value="">— 请选择 JD —</option>`;
  items.forEach((j) => {
    const o = document.createElement("option");
    o.value = j.id;
    o.textContent = `${j.company || "?"} · ${j.position || "?"}`;
    sel.appendChild(o);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  else {
    if (cur) _currentJdId = null;
    if (items[0]?.id) {
      sel.value = items[0].id;
      _currentJdId = items[0].id;
    }
  }
}

// ---- Analysis Panel ----
async function loadJDAnalyses(jd_id) {
  const pane = document.getElementById("jdAnalysisPane");
  const ms = document.getElementById("jdMatchSel");
  if (ms && jd_id) ms.value = jd_id;
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

  const resultArea = document.createElement("div");
  resultArea.id = "jdMatchResult";

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

  // Analysis history list（分析详情区放在列表下方，便于与「查看」阅读顺序一致）
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

      aRow.querySelector(".btn-hist-del").onclick = async () => {
        if (!confirm("删除此次分析记录？JD 本身保留。")) return;
        await apiFetch(`/api/jd-history/${a.id}`, { method: "DELETE" });
        if (_currentAnalysisId === a.id) { _currentAnalysisId = null; resultArea.innerHTML = ""; }
        loadJDCatalog();
        loadJDAnalyses(jd_id);
      };
    });
  }

  const resultTitle = document.createElement("h4");
  resultTitle.className = "jd-analyses-title jd-match-result-title";
  resultTitle.textContent = "分析详情";
  pane.appendChild(resultTitle);
  pane.appendChild(resultArea);
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
      const analyses = await apiFetch(
        `/api/jd-catalog/${jd.id}/analyses?include_qb_anchor=${encodeURIComponent("true")}`
      );
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

// Tab-specific lazy loaders
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    void (async () => {
      if (btn.dataset.tab === "jdlib") {
        await loadJDCatalog();
        if (_currentJdId) await loadCatalogEditorPane(_currentJdId);
        return;
      }
      if (btn.dataset.tab === "jd") {
        try {
          await populateJdMatchSelect();
          const v = document.getElementById("jdMatchSel")?.value?.trim();
          if (v) {
            _currentJdId = v;
            await loadJDAnalyses(v);
          } else {
            resetAnalysisPane();
          }
        } catch {
          resetAnalysisPane();
        }
        return;
      }
      if (btn.dataset.tab === "iv") populateIVSelector();
      if (btn.dataset.tab === "notes") loadNotesList();
    })();
  });
});

document.getElementById("jdMatchSel")?.addEventListener("change", async () => {
  const v = document.getElementById("jdMatchSel")?.value?.trim();
  _currentJdId = v || null;
  if (v) await loadJDAnalyses(v);
  else resetAnalysisPane();
});

document.getElementById("btnJdLibSave")?.addEventListener("click", async () => {
  const id = _currentJdId;
  if (!id) return;
  const st = document.getElementById("jdLibStatus");
  const co = document.getElementById("jdLibCompany")?.value?.trim();
  const pos = document.getElementById("jdLibPosition")?.value?.trim();
  if (!co || !pos) {
    st.textContent = "请填写公司与岗位名称";
    return;
  }
  st.textContent = "保存中…";
  try {
    await apiFetch(`/api/jd-catalog/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: co,
        position: pos,
        jd_text: document.getElementById("jdLibText").value,
        jd_keywords: document.getElementById("jdLibKw").value,
        notes: document.getElementById("jdLibNotes").value,
      }),
    });
    st.textContent = "已保存";
    await loadJDCatalog();
    await populateJdMatchSelect();
  } catch (e) {
    st.textContent = "❌ " + e.message;
  }
});

document.getElementById("btnJdLibCollapse")?.addEventListener("click", collapseJdLibDetail);

document.getElementById("btnJdLibGenKw")?.addEventListener("click", async () => {
  const id = _currentJdId;
  if (!id) return;
  const st = document.getElementById("jdLibStatus");
  st.textContent = "生成中…";
  try {
    const j = await post(`/api/jd-catalog/${encodeURIComponent(id)}/keywords-draft`, {});
    document.getElementById("jdLibKw").value = j.jd_keywords || "";
    st.textContent = "已写入草稿（若曾手动改过关键词则需先清空再自动生成）";
  } catch (e) {
    st.textContent = "❌ " + e.message;
  }
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

// ── 求职追踪 SQLite ─────────────────────────────────────────────────────
(function jobTrackUI() {
  const pan = document.getElementById("pan-track");
  if (!pan) {
    console.warn("FindAIJob: #pan-track 不存在，求职追踪脚本跳过");
    return;
  }

  let jtMeta = null;
  let selectedId = null;
  /** 详情里用于「打开资料库」跳转 */
  let _trackDetailCatalogId = null;
  /** @type {Array<{id:string,company?:string,position?:string,jd_text?:string,analysis_count?:number}>} */
  let trackJdCatalogList = [];
  /** 用于投递列表摘要、本条简历展示名；在 fillResumeSelects 拉取 `/api/resumes` 后更新 */
  let trackResumeListCache = [];

  async function fillTrackImportJdSelect() {
    const sel = document.getElementById("trackImportJd");
    const hint = document.getElementById("trackImportJdHint");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">— 不关联 · 在下面手写 JD —</option>`;
    trackJdCatalogList = [];
    if (hint) hint.textContent = "正在加载 JD 资料库…";
    try {
      trackJdCatalogList = await apiFetch("/api/jd-catalog");
      trackJdCatalogList.forEach((j) => {
        const o = document.createElement("option");
        o.value = j.id;
        const n = typeof j.analysis_count === "number" ? j.analysis_count : 0;
        o.textContent = `${j.company || "?"} · ${j.position || "?"} (${n} 次匹配分析)`;
        sel.appendChild(o);
      });
      if (hint) {
        hint.textContent =
          trackJdCatalogList.length === 0
            ? "资料库暂无 JD，请到「JD 资料库」页签添加条目。"
            : "选择后写入关联 ID；JD 正文 / 关键词请在资料库编辑，保存投递时会同步快照。";
      }
    } catch (e) {
      if (hint) hint.textContent = "无法加载 JD 资料库：" + (e.message || String(e));
    }
    sel.value = prev && [...sel.options].some((o) => o.value === prev) ? prev : "";
    syncTrackNewManualJdVisibility();
  }

  function syncTrackNewManualJdVisibility() {
    const w = document.getElementById("trackNewManualJdWrap");
    const imp = document.getElementById("trackImportJd");
    if (!w || !imp) return;
    w.classList.toggle("hidden", !!imp.value.trim());
  }

  function applyTrackImportJdPick(jdId) {
    document.getElementById("trackNewCo").value = "";
    document.getElementById("trackNewPos").value = "";
    syncTrackNewManualJdVisibility();
    if (!jdId) return;
    const row = trackJdCatalogList.find((x) => x.id === jdId);
    if (!row) return;
    document.getElementById("trackNewCo").value = row.company || "";
    document.getElementById("trackNewPos").value = row.position || "";
  }

  function isoDateLocal(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function primeFeedbackDateTimeInputs() {
    const dEl = document.getElementById("trackFbDate");
    const tEl = document.getElementById("trackFbTimeOnly");
    if (!dEl || !tEl) return;
    const now = new Date();
    dEl.value = isoDateLocal(now);
    const pad = (n) => String(n).padStart(2, "0");
    tEl.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  async function ensureMeta() {
    if (jtMeta) return jtMeta;
    jtMeta = await apiFetch("/api/job-track/meta");
    const dh = document.getElementById("trackPlatHints");
    if (dh && jtMeta.suggested_platforms) {
      dh.innerHTML = "";
      jtMeta.suggested_platforms.forEach((p) => {
        const o = document.createElement("option");
        o.value = p;
        dh.appendChild(o);
      });
    }
    function fillDirs(sel) {
      if (!sel || !jtMeta.position_directions) return;
      sel.innerHTML = "";
      jtMeta.position_directions.forEach((d) => {
        const o = document.createElement("option");
        o.value = d;
        o.textContent = d;
        sel.appendChild(o);
      });
    }
    fillDirs(document.getElementById("trackNewDir"));
    fillDirs(document.getElementById("trackEdDir"));

    function fillFb(sel, items) {
      if (!sel) return;
      sel.innerHTML = "";
      items.forEach((x) => {
        const o = document.createElement("option");
        o.value = x;
        o.textContent = x;
        sel.appendChild(o);
      });
    }
    fillFb(document.getElementById("trackFbSrc"), jtMeta.feedback_sources || []);
    fillFb(document.getElementById("trackFbType"), jtMeta.feedback_types || []);

    const ivs = document.getElementById("trackIvStage");
    if (ivs && jtMeta.pipeline_stages) {
      ivs.innerHTML = "";
      jtMeta.pipeline_stages.forEach((s) => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.id;
        ivs.appendChild(o);
      });
    }
    return jtMeta;
  }

  async function fillResumeSelects() {
    let items = [];
    try {
      items = await apiFetch("/api/resumes");
    } catch (_) {
      /* 无密钥或空库 */
    }
    trackResumeListCache = items;
    ["trackFilterResume", "trackNewResume"].forEach((sid) => {
      const sel = document.getElementById(sid);
      if (!sel) return;
      const cur = sel.value;
      const firstOpt = sid === "trackFilterResume" ? "全部投递" : "简历版本（选填）";
      sel.innerHTML = `<option value="">${firstOpt}</option>`;
      items.forEach((item) => {
        const o = document.createElement("option");
        o.value = item.filename;
        o.textContent = resumeDisplayName(item.filename, items) || item.filename;
        sel.appendChild(o);
      });
      if (cur) sel.value = cur;
    });
    syncTrackNewResumeVisibility();
  }

  function getTrackFilterResume() {
    return document.getElementById("trackFilterResume")?.value.trim() || "";
  }

  function syncTrackNewResumeVisibility() {
    const row = document.getElementById("trackNewResumeRow");
    const hint = document.getElementById("trackNewResumeHint");
    const rf = getTrackFilterResume();
    if (rf) {
      row?.classList.add("hidden");
      if (hint) {
        const disp = resumeDisplayName(rf, trackResumeListCache) || rf;
        hint.textContent = `新建投递将使用顶部筛选简历：「${disp}」（${rf}）`;
        hint.classList.remove("hidden");
      }
    } else {
      row?.classList.remove("hidden");
      if (hint) {
        hint.textContent = "";
        hint.classList.add("hidden");
      }
    }
  }

  function renderStats(s) {
    const el = document.getElementById("trackStats");
    const pct = (v) => (v == null ? "—" : `${v}%`);
    const dirRows = (s.by_direction || [])
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.direction)}</td><td>${row.applications}</td><td>${pct(row.first_round_pass_rate)}</td><td>${row.first_round_numerator}/${row.first_round_denominator}</td></tr>`
      )
      .join("");
    const rfRows = (s.by_resume || [])
      .map(
        (row) =>
          `<tr><td title="${escapeHtml(row.resume_filename)}">${escapeHtml(row.resume_filename.length > 36 ? row.resume_filename.slice(0, 34) + "…" : row.resume_filename)}</td><td>${row.applications}</td><td>${pct(row.first_round_pass_rate)}</td><td>${row.first_round_numerator}/${row.first_round_denominator}</td></tr>`
      )
      .join("");
    const fbRows = (s.feedback_distribution || [])
      .map((row) => `<tr><td>${escapeHtml(row.feedback_type)}</td><td>${row.count}</td></tr>`)
      .join("");
    el.innerHTML = `
      <div>投递日期窗口：<strong>${s.applied_from}</strong> ~ <strong>${s.applied_to}</strong> · 样本 <strong>${s.total_applications}</strong></div>
      <div class="track-stat-grid">
        <div class="track-stat-item">HR（初版口径）<br><strong>${pct(s.hr_reply_rate)}</strong><br><small>${s.hr_reply_numerator}/${s.hr_reply_denominator}</small></div>
        <div class="track-stat-item">面试转化<br><strong>${pct(s.interview_conversion_rate)}</strong><br><small>${s.interview_conversion_numerator}/${s.interview_conversion_denominator}</small></div>
        <div class="track-stat-item">一面通过<br><strong>${pct(s.first_round_pass_rate)}</strong><br><small>${s.first_round_numerator}/${s.first_round_denominator}</small></div>
      </div>
      ${s.interview_sessions_in_window_apps != null ? `<div class="muted small">时间窗投递下的复盘条目：<strong>${s.interview_sessions_in_window_apps}</strong>。</div>` : ""}
      <div class="muted small">${escapeHtml([s.hr_reply_note, s.interview_conversion_note].filter(Boolean).join(" ") || "")}</div>
      <details class="track-stat-detail">
        <summary>按岗位方向 · 简历版本 · 反馈类型（展开表格）</summary>
        <div class="track-mini-table-wrap">
          <p class="muted small" style="margin:0.4rem 0">一面通过率分列：通过率 / （通过数／有结论数）</p>
          <strong>岗位方向</strong>
          <table class="track-mini-table"><thead><tr><th>方向</th><th>投递</th><th>一面通过率</th><th>通过/样本</th></tr></thead><tbody>${dirRows || "<tr><td colspan=4 class=muted small>暂无</td></tr>"}</tbody></table>
          <strong style="display:block;margin-top:0.75rem">简历版本</strong>
          <table class="track-mini-table"><thead><tr><th>简历</th><th>投递</th><th>一面通过率</th><th>通过/样本</th></tr></thead><tbody>${rfRows || "<tr><td colspan=4 class=muted small>暂无</td></tr>"}</tbody></table>
          <strong style="display:block;margin-top:0.75rem">反馈类型分布</strong>
          <p class="muted small" style="margin:0">${s.feedback_distribution_note || ""}</p>
          <table class="track-mini-table"><thead><tr><th>反馈类型</th><th>条数</th></tr></thead><tbody>${fbRows || "<tr><td colspan=2 class=muted small>暂无</td></tr>"}</tbody></table>
        </div>
      </details>`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const TRACK_COACH_FOCUS_DEFAULT = "综合复盘与下周策略";

  function getCoachDaysValue() {
    return parseInt(document.getElementById("trackDays")?.value, 10) || 30;
  }

  function coachServerBannerHtml(rec, currentDays) {
    const analyzed = rec.analyzed_at
      ? new Date(rec.analyzed_at).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })
      : "";
    const wf =
      rec.window && rec.window.from != null && rec.window.to != null
        ? `${rec.window.from} ~ ${rec.window.to}`
        : "";
    const rf = (rec.resume_filename || "").trim();
    const resumeLine = rf
      ? `限定简历：<strong title="${escapeHtml(rf)}">${escapeHtml(rf.length > 40 ? rf.slice(0, 38) + "…" : rf)}</strong>`
      : `简历范围：<strong>未限定</strong>（时间窗内全部投递）`;
    const jaid = rec.jd_analysis_id != null ? String(rec.jd_analysis_id).trim() : "";
    const jdLine = jaid ? ` · 关联 JD 对标分析 ID：<code>${escapeHtml(jaid)}</code>` : "";
    let winNote = "";
    if (rec.days != null && Number(rec.days) !== Number(currentDays)) {
      winNote = ` 当前已选统计窗口为 <strong>${escapeHtml(String(currentDays))}</strong> 天，本条为 <strong>${escapeHtml(String(rec.days))}</strong> 天口径；可点「重新生成」对齐。`;
    }
    const inner = `以下为<strong>服务器已保存</strong>的最近一次建议。${
      analyzed ? ` 分析时间：<strong>${escapeHtml(analyzed)}</strong>。` : ""
    }${wf ? ` 投递日期窗：<strong>${escapeHtml(wf)}</strong>。` : ""} ${resumeLine}${jdLine}.${winNote}`;
    return `<div class="track-coach-cache-meta muted small">${inner}</div>`;
  }

  function parseCoachMarkdown(md) {
    const m = md != null ? String(md) : "";
    return typeof marked !== "undefined" ? marked.parse(m) : m.replace(/\n/g, "<br>");
  }

  async function fetchTrackCoachLatest() {
    const days = getCoachDaysValue();
    const rf = getTrackFilterResume();
    const q = new URLSearchParams({
      days: String(days),
      resume_filename: rf,
      focus: TRACK_COACH_FOCUS_DEFAULT,
    });
    return await apiFetch(`/api/job-track/ai/coach/latest?${q}`);
  }

  async function showTrackCoachPanelLatest() {
    const wrap = document.getElementById("trackCoachOut");
    const body = document.getElementById("trackCoachBody");
    const regen = document.getElementById("btnTrackCoachRegen");
    if (!wrap || !body) return;
    const days = getCoachDaysValue();
    wrap.classList.remove("hidden");
    if (regen) regen.disabled = true;
    body.innerHTML = '<p class="track-coach-loading muted">正在加载已保存的建议…</p>';
    try {
      const j = await fetchTrackCoachLatest();
      if (!j.found) {
        body.innerHTML =
          '<p class="track-coach-empty muted">当前「统计窗口 + 简历范围」组合下暂无服务器记录。请点击 <strong>重新生成</strong> 生成并写入数据库。</p>';
      } else {
        body.innerHTML = coachServerBannerHtml(j, days) + parseCoachMarkdown(j.markdown);
      }
      wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      body.innerHTML = `<p class="track-coach-error">❌ ${escapeHtml(err.message || String(err))}</p>`;
    } finally {
      if (regen) regen.disabled = false;
    }
  }

  async function runTrackCoachGenerate() {
    const wrap = document.getElementById("trackCoachOut");
    const body = document.getElementById("trackCoachBody");
    const regen = document.getElementById("btnTrackCoachRegen");
    if (!wrap || !body) return;
    wrap.classList.remove("hidden");
    if (regen) regen.disabled = true;
    body.innerHTML = '<p class="track-coach-loading muted">正在生成，请稍候…</p>';
    const days = getCoachDaysValue();
    const resume_filename = getTrackFilterResume();
    try {
      const j = await post("/api/job-track/ai/coach", {
        days,
        focus: TRACK_COACH_FOCUS_DEFAULT,
        resume_filename,
      });
      const md = j.markdown != null ? String(j.markdown) : "";
      body.innerHTML = coachServerBannerHtml(j, days) + parseCoachMarkdown(md);
      wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      body.innerHTML = `<p class="track-coach-error">❌ ${escapeHtml(err.message || String(err))}</p>`;
    } finally {
      if (regen) regen.disabled = false;
    }
  }

  function hideTrackJobDetailPanel() {
    const w = document.getElementById("trackDetailJobWrap");
    const b = document.getElementById("btnTrackToggleJobDetail");
    if (w) w.classList.add("hidden");
    if (b) {
      b.textContent = "岗位详情";
      b.setAttribute("aria-expanded", "false");
    }
  }

  function showTrackJobDetailPanel() {
    const w = document.getElementById("trackDetailJobWrap");
    const b = document.getElementById("btnTrackToggleJobDetail");
    if (w) w.classList.remove("hidden");
    if (b) {
      b.textContent = "收起岗位详情";
      b.setAttribute("aria-expanded", "true");
    }
  }

  function collapseTrackDetail() {
    hideTrackJobDetailPanel();
    selectedId = null;
    document.getElementById("trackDetail")?.classList.add("hidden");
    document.getElementById("trackList")?.querySelectorAll(".track-row-item").forEach((x) =>
      x.classList.remove("selected"));
  }

  function renderList(apps) {
    const el = document.getElementById("trackList");
    if (!apps.length) {
      el.innerHTML = "<p class='jd-empty'>暂无记录</p>";
      return;
    }
    el.innerHTML = "";
    apps.forEach((a) => {
      const div = document.createElement("div");
      div.className = "track-row-item" + (selectedId === a.id ? " selected" : "");
      const rfScope = getTrackFilterResume();
      const resumeBit =
        !rfScope && (a.resume_filename || "").trim()
          ? ` · ${escapeHtml(resumeDisplayName(a.resume_filename, trackResumeListCache) || a.resume_filename)}`
          : "";
      div.innerHTML = `<strong>${escapeHtml(a.company)}</strong> · ${escapeHtml(a.position)}<br>
        <span class="muted small">${escapeHtml(a.direction)} · 投于 ${escapeHtml(a.applied_on)}${resumeBit}</span>`;
      div.onclick = async () => {
        const det = document.getElementById("trackDetail");
        if (selectedId === a.id && det && !det.classList.contains("hidden")) {
          collapseTrackDetail();
          return;
        }
        selectedId = a.id;
        [...el.querySelectorAll(".track-row-item")].forEach((x) => x.classList.remove("selected"));
        div.classList.add("selected");
        await openDetail(a.id);
      };
      el.appendChild(div);
    });
  }

  async function refresh() {
    await ensureMeta();
    await fillResumeSelects();
    const days = document.getElementById("trackDays").value;
    const rf = getTrackFilterResume();
    const rfQ = rf ? `&resume_filename=${encodeURIComponent(rf)}` : "";
    const [stats, apps] = await Promise.all([
      apiFetch(`/api/job-track/stats?days=${encodeURIComponent(days)}${rfQ}`),
      apiFetch(`/api/job-track/applications?days=${encodeURIComponent(days)}${rfQ}`),
    ]);
    renderStats(stats);
    renderList(apps);
    if (selectedId) {
      try {
        await openDetail(selectedId);
      } catch (_) {
        selectedId = null;
        document.getElementById("trackDetail").classList.add("hidden");
      }
    }
  }

  function outcomeForStage(app, stageId) {
    const row = (app.stages || []).find((x) => x.stage === stageId);
    return row ? row.outcome : "";
  }

  /** 当前可操作环节：优先第一个「待定」，否则第一个「未通过」，否则已通过至 Offer → 焦点在 Offer「通过」*/
  function pickFocusStageId(stagesMeta, app) {
    const pipelineIds = (stagesMeta || []).map((s) => s.id);
    if (!pipelineIds.length) return null;
    const map = {};
    (app.stages || []).forEach((r) => {
      map[r.stage] = r.outcome;
    });

    const pendingIdx = pipelineIds.findIndex((sid) => map[sid] === "pending");
    if (pendingIdx >= 0) return pipelineIds[pendingIdx];

    const failedIdx = pipelineIds.findIndex((sid) => map[sid] === "failed");
    if (failedIdx >= 0) return pipelineIds[failedIdx];

    const last = pipelineIds[pipelineIds.length - 1];
    if (map[last] === "passed") return last;

    return pipelineIds[0];
  }

  async function openDetail(id) {
    await ensureMeta();
    await fillResumeSelects();
    const app = await apiFetch(`/api/job-track/applications/${encodeURIComponent(id)}`);
    const det = document.getElementById("trackDetail");
    det.classList.remove("hidden");
    hideTrackJobDetailPanel();
    document.getElementById("trackDetailTitle").textContent = `${app.company} — ${app.position}`;
    document.getElementById("trackEdCo").value = app.company || "";
    document.getElementById("trackEdPos").value = app.position || "";
    document.getElementById("trackEdDir").value = app.direction || "";
    document.getElementById("trackEdApplied").value = (app.applied_on || "").slice(0, 10);
    document.getElementById("trackEdPlat").value = app.platform || "";
    document.getElementById("trackEdLoc").value = app.location || "";
    document.getElementById("trackEdSalary").value = app.salary_range || "";

    const rfDisp = (app.resume_filename || "").trim();
    const rLine = document.getElementById("trackDetailResumeLine");
    if (rLine) {
      const label = resumeDisplayName(rfDisp, trackResumeListCache) || rfDisp || "（未填）";
      rLine.innerHTML = rfDisp
        ? `本条投递简历：<strong title="${escapeHtml(rfDisp)}">${escapeHtml(label)}</strong>`
        : "本条投递简历：<span class=muted>（未填）</span>";
    }

    _trackDetailCatalogId = app.jd_catalog_id ? String(app.jd_catalog_id).trim() : null;
    const catBox = document.getElementById("trackDetailJdFromCat");
    const manBox = document.getElementById("trackDetailJdManual");
    if (_trackDetailCatalogId) {
      catBox?.classList.remove("hidden");
      manBox?.classList.add("hidden");
      try {
        const ent = await apiFetch(`/api/jd-catalog/${encodeURIComponent(_trackDetailCatalogId)}`);
        const prev = document.getElementById("trackDetailJdPreview");
        if (prev) prev.textContent = (ent.jd_text || "").trim() || "（JD 正文为空）";
        const kwL = document.getElementById("trackDetailKwLine");
        const kws = (ent.jd_keywords || "").trim();
        if (kwL) kwL.textContent = kws ? `关键词：${kws}` : "关键词：（未填，可在 JD 资料库生成）";
        const nl = document.getElementById("trackDetailNotesLine");
        const n = (ent.notes || "").trim();
        if (nl) {
          if (n) {
            nl.textContent = `资料库备注：${n}`;
            nl.classList.remove("hidden");
          } else nl.classList.add("hidden");
        }
      } catch (e) {
        const prev = document.getElementById("trackDetailJdPreview");
        if (prev) prev.textContent = "无法加载关联资料库条目：" + (e.message || String(e));
      }
    } else {
      catBox?.classList.add("hidden");
      manBox?.classList.remove("hidden");
      document.getElementById("trackEdJdFree").value = app.jd_text || "";
      document.getElementById("trackEdKwFree").value = app.jd_keywords || "";
    }

    document.getElementById("trackEdNotes").value = app.notes || "";
    document.getElementById("trackEdAbandon").checked = !!app.abandoned;

    const stagesMeta = jtMeta.pipeline_stages || [];
    const stBox = document.getElementById("trackStages");
    stBox.innerHTML = "";

    function mkStageRow(st) {
      const row = document.createElement("div");
      row.className = "track-stage-row";
      const cur = outcomeForStage(app, st.id);
      const sel = document.createElement("select");
      [
        ["", "（未录入）"],
        ["pending", "待定"],
        ["passed", "通过"],
        ["failed", "未通过"],
      ].forEach(([v, lab]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = lab;
        sel.appendChild(o);
      });
      sel.value = cur || "";
      sel.onchange = async () => {
        const v = sel.value;
        if (!v) return;
        try {
          await apiFetch(
            `/api/job-track/applications/${encodeURIComponent(id)}/stages/${encodeURIComponent(st.id)}`,
            { method: "PATCH", headers: hdr(), body: JSON.stringify({ outcome: v }) }
          );
          await refresh();
        } catch (e) {
          alert(e.message);
        }
      };
      row.appendChild(document.createTextNode(st.id + "："));
      row.appendChild(sel);
      return row;
    }

    if (!stagesMeta.length) {
      stBox.innerHTML = "<p class='muted small'>无环节定义</p>";
    } else if (stagesMeta.length <= 1) {
      stagesMeta.forEach((st) => stBox.appendChild(mkStageRow(st)));
    } else {
      const focusSid = pickFocusStageId(stagesMeta, app);
      const focusMeta = stagesMeta.find((s) => s.id === focusSid) || stagesMeta[0];

      const hint = document.createElement("div");
      hint.className = "muted small track-stage-focus-hint";
      hint.textContent = "当前环节（系统按「待定→未通过→已完结」自动推断）：";
      stBox.appendChild(hint);
      stBox.appendChild(mkStageRow(focusMeta));

      const otherMeta = stagesMeta.filter((s) => s.id !== focusMeta.id);
      if (otherMeta.length) {
        const details = document.createElement("details");
        details.className = "track-stages-details track-stat-detail";

        const sum = document.createElement("summary");
        sum.textContent = `查看全流程（其余 ${otherMeta.length} 个环节）`;

        details.appendChild(sum);
        otherMeta.forEach((st) => details.appendChild(mkStageRow(st)));
        stBox.appendChild(details);
      }
    }

    const fbs = await apiFetch(`/api/job-track/applications/${encodeURIComponent(id)}/feedbacks`);
    const fl = document.getElementById("trackFbList");
    fl.innerHTML = "";
    if (!fbs.length) {
      fl.innerHTML = "<p class='muted small'>暂无</p>";
    } else {
      fbs.forEach((f) => {
        const wrap = document.createElement("div");
        wrap.className = "fb-line track-line-actions";
        const txt = document.createElement("span");
        txt.textContent = `${f.happened_at} · ${f.feedback_type} — ${(f.content || "").slice(0, 280)}${(f.content || "").length > 280 ? "…" : ""}`;
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn-small";
        del.textContent = "删";
        del.onclick = async (ev) => {
          ev.stopPropagation();
          if (!confirm("删除这条反馈？")) return;
          try {
            await apiFetch(`/api/job-track/feedbacks/${encodeURIComponent(f.id)}`, { method: "DELETE", headers: hdr() });
            await openDetail(id);
          } catch (e) {
            alert(e.message);
          }
        };
        wrap.appendChild(txt);
        wrap.appendChild(del);
        fl.appendChild(wrap);
      });
    }

    const ivs = await apiFetch(`/api/job-track/interviews?application_id=${encodeURIComponent(id)}`);
    const il = document.getElementById("trackIvList");
    il.innerHTML = "";
    if (!ivs.length) {
      il.innerHTML = "<p class='muted small'>暂无</p>";
    } else {
      ivs.forEach((v) => {
        const outer = document.createElement("details");
        outer.className = "track-stat-detail";
        outer.style.marginBottom = "0.35rem";

        const summary = document.createElement("summary");
        summary.style.cursor = "pointer";
        const sumRow = document.createElement("div");
        sumRow.className = "track-line-actions";
        sumRow.style.margin = "0";
        const sumTxt = document.createElement("span");
        sumTxt.textContent = `${v.interview_on} · ${v.stage} — ${(v.result || "（未填结果）").slice(0, 100)}${(v.result || "").length > 100 ? "…" : ""}`;
        const delIv = document.createElement("button");
        delIv.type = "button";
        delIv.className = "btn-small";
        delIv.textContent = "删";
        delIv.onclick = async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (!confirm("删除这场复盘？")) return;
          try {
            await apiFetch(`/api/job-track/interviews/${encodeURIComponent(v.id)}`, { method: "DELETE", headers: hdr() });
            await openDetail(id);
          } catch (e) {
            alert(e.message);
          }
        };
        sumRow.appendChild(sumTxt);
        sumRow.appendChild(delIv);
        summary.appendChild(sumRow);

        const expand = document.createElement("div");
        expand.className = "iv-expand-body";
        const meta = document.createElement("div");
        meta.textContent = `对方角色：${v.interviewer_type || "—"} · 时长：${v.duration_min != null ? v.duration_min + " 分钟" : "—"}`;
        expand.appendChild(meta);
        const qTit = document.createElement("strong");
        qTit.textContent = "问题";
        expand.appendChild(qTit);
        (v.questions || []).forEach((q) => {
          const line = document.createElement("div");
          line.textContent = `${q.weak ? "[弱] " : ""}${q.text || ""}`;
          expand.appendChild(line);
        });
        if ((v.failure_guess || "").trim()) {
          const fg = document.createElement("div");
          const st = document.createElement("strong");
          st.textContent = "失败原因推测 ";
          fg.appendChild(st);
          fg.appendChild(document.createTextNode(v.failure_guess));
          expand.appendChild(fg);
        }
        if ((v.improvements || "").trim()) {
          const im = document.createElement("div");
          const st = document.createElement("strong");
          st.textContent = "改进 ";
          im.appendChild(st);
          im.appendChild(document.createTextNode(v.improvements));
          expand.appendChild(im);
        }

        outer.appendChild(summary);
        outer.appendChild(expand);
        il.appendChild(outer);
      });
    }

    primeFeedbackDateTimeInputs();
    document.getElementById("trackDetail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  window.bootJobTrack = async () => {
    try {
      const na = document.getElementById("trackNewApplied");
      const ivd = document.getElementById("trackIvDate");
      if (na) na.value = isoDateLocal();
      if (ivd) ivd.value = isoDateLocal();
      await refresh();
    } catch (e) {
      alert("求职追踪加载失败：" + (e && e.message ? e.message : String(e)));
    }
  };

  const trackToolbar = pan.querySelector(".track-toolbar");
  if (trackToolbar) {
    trackToolbar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !trackToolbar.contains(b)) return;
      const id = b.id;
      if (id === "btnTrackRefresh") {
        e.preventDefault();
        refresh().catch((err) => alert(err.message || String(err)));
        return;
      }
      if (id === "btnTrackNew") {
        e.preventDefault();
        void (async () => {
          try {
            await ensureMeta();
            await fillResumeSelects();
            await fillTrackImportJdSelect();
            document.getElementById("trackNewWrap")?.classList.remove("hidden");
            syncTrackNewManualJdVisibility();
            const na = document.getElementById("trackNewApplied");
            if (na) na.value = isoDateLocal();
          } catch (err) {
            alert(err.message || String(err));
          }
        })();
        return;
      }
      if (id === "btnTrackCoach") {
        e.preventDefault();
        void (async () => {
          if (!document.getElementById("trackCoachOut") || !document.getElementById("trackCoachBody")) {
            alert("页面缺少 AI 建议容器");
            return;
          }
          await showTrackCoachPanelLatest();
        })();
      }
    });
  }

  document.getElementById("btnTrackCoachClose")?.addEventListener("click", () => {
    document.getElementById("trackCoachOut")?.classList.add("hidden");
  });

  document.getElementById("btnTrackCoachRegen")?.addEventListener("click", () => {
    void runTrackCoachGenerate();
  });

  document.getElementById("trackDays")?.addEventListener("change", () => {
    refresh().catch((e) => alert(e.message || String(e)));
    const out = document.getElementById("trackCoachOut");
    if (out && !out.classList.contains("hidden")) {
      void showTrackCoachPanelLatest();
    }
  });

  document.getElementById("trackFilterResume")?.addEventListener("change", () => {
    syncTrackNewResumeVisibility();
    refresh().catch((e) => alert(e.message || String(e)));
    const out = document.getElementById("trackCoachOut");
    if (out && !out.classList.contains("hidden")) {
      void showTrackCoachPanelLatest();
    }
  });

  document.getElementById("btnTrackCollapseDetail")?.addEventListener("click", () => collapseTrackDetail());

  document.getElementById("btnTrackToggleJobDetail")?.addEventListener("click", () => {
    const w = document.getElementById("trackDetailJobWrap");
    if (!w) return;
    if (w.classList.contains("hidden")) showTrackJobDetailPanel();
    else hideTrackJobDetailPanel();
  });

  document.getElementById("trackImportJd")?.addEventListener("change", () => {
    applyTrackImportJdPick(document.getElementById("trackImportJd").value.trim());
  });

  document.getElementById("btnTrackCancelNew")?.addEventListener("click", () => {
    document.getElementById("trackNewWrap").classList.add("hidden");
    const imp = document.getElementById("trackImportJd");
    if (imp) imp.value = "";
    syncTrackNewManualJdVisibility();
  });

  document.getElementById("btnTrackSaveNew")?.addEventListener("click", async () => {
    const st = document.getElementById("trackNewStatus");
    st.textContent = "提交中…";
    try {
      const jid = document.getElementById("trackImportJd")?.value?.trim();
      let jd_catalog_id = jid ? jid : null;
      let jd_text = "";
      let jd_keywords = "";

      if (jd_catalog_id) {
        try {
          const ent = await apiFetch(`/api/jd-catalog/${encodeURIComponent(jd_catalog_id)}`);
          jd_text = ent.jd_text || "";
          jd_keywords = (ent.jd_keywords || "").trim();
        } catch (e) {
          throw new Error("无法读取资料库条目：" + (e.message || String(e)));
        }
      } else {
        jd_text = document.getElementById("trackNewJdFree").value;
        jd_keywords = document.getElementById("trackNewKwFree").value.trim();
      }

      const body = {
        company: document.getElementById("trackNewCo").value.trim(),
        position: document.getElementById("trackNewPos").value.trim(),
        direction: document.getElementById("trackNewDir").value,
        applied_on: document.getElementById("trackNewApplied").value,
        platform: document.getElementById("trackNewPlat").value.trim(),
        location: document.getElementById("trackNewLoc").value.trim(),
        salary_range: document.getElementById("trackNewSalary").value.trim(),
        resume_filename: getTrackFilterResume() || document.getElementById("trackNewResume").value.trim(),
        jd_text,
        jd_keywords,
        notes: document.getElementById("trackNewNotes").value.trim(),
        jd_catalog_id,
      };
      const j = await post("/api/job-track/applications", body);
      st.textContent = "已创建";
      document.getElementById("trackNewWrap").classList.add("hidden");
      const imp = document.getElementById("trackImportJd");
      if (imp) imp.value = "";
      syncTrackNewManualJdVisibility();
      selectedId = j.id;
      await refresh();
    } catch (e) {
      st.textContent = "失败：" + e.message;
    }
  });

  document.getElementById("btnTrackSaveMeta")?.addEventListener("click", async () => {
    const st = document.getElementById("trackEdStatus");
    if (!selectedId) return;
    st.textContent = "保存中…";
    try {
      const snap = await apiFetch(`/api/job-track/applications/${encodeURIComponent(selectedId)}`);
      const catId = snap.jd_catalog_id ? String(snap.jd_catalog_id).trim() : "";
      let jd_text = "";
      let jd_keywords = "";
      if (catId) {
        const ent = await apiFetch(`/api/jd-catalog/${encodeURIComponent(catId)}`);
        jd_text = ent.jd_text || "";
        jd_keywords = (ent.jd_keywords || "").trim();
      } else {
        jd_text = document.getElementById("trackEdJdFree").value;
        jd_keywords = document.getElementById("trackEdKwFree").value;
      }

      await apiFetch(`/api/job-track/applications/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        headers: hdr(),
        body: JSON.stringify({
          company: document.getElementById("trackEdCo").value.trim(),
          position: document.getElementById("trackEdPos").value.trim(),
          direction: document.getElementById("trackEdDir").value,
          applied_on: document.getElementById("trackEdApplied").value,
          platform: document.getElementById("trackEdPlat").value.trim(),
          location: document.getElementById("trackEdLoc").value.trim(),
          salary_range: document.getElementById("trackEdSalary").value.trim(),
          jd_text,
          jd_keywords,
          notes: document.getElementById("trackEdNotes").value.trim(),
          abandoned: document.getElementById("trackEdAbandon").checked,
        }),
      });
      st.textContent = "已保存";
      await refresh();
    } catch (e) {
      st.textContent = "失败：" + e.message;
    }
  });

  document.getElementById("btnTrackOpenJdLib")?.addEventListener("click", () => {
    if (!_trackDetailCatalogId) return;
    _currentJdId = _trackDetailCatalogId;
    document.querySelector('.tabs button[data-tab="jdlib"]')?.click();
  });

  document.getElementById("btnTrackAddFb")?.addEventListener("click", async () => {
    if (!selectedId) return;
    const source = document.getElementById("trackFbSrc").value.trim();
    const feedback_type = document.getElementById("trackFbType").value.trim();
    const content = document.getElementById("trackFbContent").value.trim();
    if (!source) {
      alert("请选择反馈来源");
      return;
    }
    if (!feedback_type) {
      alert("请选择反馈类型");
      return;
    }
    if (!content) {
      alert("请填写反馈内容");
      return;
    }
    const dStr = document.getElementById("trackFbDate")?.value?.trim();
    const tStrRaw = document.getElementById("trackFbTimeOnly")?.value?.trim();
    if (!dStr) {
      alert("请先选择日期（第一项为日期选择器，点日历图标即可）");
      return;
    }
    const withSec = !tStrRaw ? "12:00:00" : `${tStrRaw}:00`;
    const happened_at = `${dStr} ${withSec}`;
    try {
      await post(`/api/job-track/applications/${encodeURIComponent(selectedId)}/feedbacks`, {
        source,
        happened_at,
        content,
        feedback_type,
        trustworthy: document.getElementById("trackFbTrust").checked,
        next_action: document.getElementById("trackFbNext").value.trim() || "",
      });
      await openDetail(selectedId);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("btnTrackAddIv")?.addEventListener("click", async () => {
    if (!selectedId) return;
    const ok = document.getElementById("trackIvQ").value.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, weak: false }));
    const weak = document.getElementById("trackIvWeak").value.split("\n").map((s) => s.trim()).filter(Boolean).map((text) => ({ text, weak: true }));
    const questions = ok.concat(weak);
    const dm = parseInt(document.getElementById("trackIvDur").value, 10);
    try {
      await post("/api/job-track/interviews", {
        application_id: selectedId,
        stage: document.getElementById("trackIvStage").value,
        interview_on: document.getElementById("trackIvDate").value,
        duration_min: Number.isFinite(dm) ? dm : null,
        interviewer_type: document.getElementById("trackIvType").value.trim(),
        questions,
        result: document.getElementById("trackIvResult").value.trim(),
        failure_guess: document.getElementById("trackIvFail").value.trim(),
        improvements: document.getElementById("trackIvImp").value.trim(),
      });
      document.getElementById("trackIvQ").value = "";
      document.getElementById("trackIvWeak").value = "";
      document.getElementById("trackIvFail").value = "";
      document.getElementById("trackIvImp").value = "";
      await openDetail(selectedId);
    } catch (e) {
      alert(e.message);
    }
  });

})();

