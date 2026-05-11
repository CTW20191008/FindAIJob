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

document.getElementById("btnJd").onclick = async () => {
  const out = document.getElementById("outJd");
  out.textContent = "…";
  try {
    const j = await post("/api/jd-match", { jd_text: document.getElementById("jd").value });
    out.textContent = JSON.stringify(j, null, 2);
  } catch (e) {
    out.textContent = "错误：" + e.message;
  }
};

document.getElementById("btnIv").onclick = async () => {
  const out = document.getElementById("outIv");
  out.textContent = "…";
  try {
    const j = await post("/api/interview-questions", {
      focus: document.getElementById("focus").value.trim(),
      count: parseInt(document.getElementById("ivn").value, 10) || 8,
    });
    out.textContent = JSON.stringify(j, null, 2);
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
