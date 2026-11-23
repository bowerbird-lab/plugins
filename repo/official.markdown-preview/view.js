(async function () {
  const params = new URLSearchParams(location.search);
  const src = params.get("url") || "/_api/asset/raw";
  const root = document.getElementById("app");
  if (!root) return;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    /** @type {Record<string, string>} */
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
    /** @param {string} s */
    const esc = (s) => s.replace(/[&<>]/g, (c) => map[c] || c);
    const html = esc(text)
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n\n/g, "<br/><br/>");
    root.innerHTML = html;
  } catch (e) {
    root.textContent = "Failed to load markdown: " + (e instanceof Error ? e.message : String(e));
  }
})();
