(function () {
  const params = new URLSearchParams(location.search);
  const src = params.get("thumbUrl") || params.get("url") || "/_api/asset/raw";
  const stage = document.getElementById("stage");
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById("preview"));
  const status = document.getElementById("status");
  if (!stage || !img || !status) return;

  let zoom = 1, panX = 0, panY = 0, dragging = false, lastX = 0, lastY = 0;
  const apply = () => {
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  };
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoom = Math.min(16, Math.max(0.1, zoom * (1 - e.deltaY * 0.005)));
    } else {
      panX -= e.deltaX;
      panY -= e.deltaY;
    }
    apply();
  }, { passive: false });
  stage.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    stage.classList.add("dragging"); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    panX += e.clientX - lastX; panY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    apply();
  });
  stage.addEventListener("pointerup", () => { dragging = false; stage.classList.remove("dragging"); });
  stage.addEventListener("dblclick", () => { zoom = 1; panX = 0; panY = 0; apply(); });
  img.onload = () => { status.textContent = ""; };
  img.onerror = () => { status.textContent = "Unable to render preview."; };
  img.src = src;
})();
