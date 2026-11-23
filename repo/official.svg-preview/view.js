(async function () {
  const params = new URLSearchParams(location.search);
  const src = params.get("url") || "/_api/asset/raw";
  const root = document.getElementById("root");
  if (!root) return;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== "svg") {
      throw new Error("Invalid SVG document");
    }
    root.replaceChildren(document.importNode(svg, true));
  } catch (e) {
    root.textContent = "Failed to load SVG: " + (e instanceof Error ? e.message : String(e));
  }
})();
