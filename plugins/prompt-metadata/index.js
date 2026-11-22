/** @param {{ item?: Record<string, any> }} ctx */
export function inspect({ item }) {
  if (!item) return null;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  const meta = item.meta && typeof item.meta === "object" ? item.meta : {};

  const rows = [];
  if (prompt) {
    const words = prompt.split(/\s+/).filter(Boolean).length;
    rows.push({ label: "Prompt Length", value: `${prompt.length} chars (${words} words)` });
  }
  for (const [key, label] of [
    ["model", "Model"],
    ["sampler", "Sampler"],
    ["seed", "Seed"],
    ["steps", "Steps"],
    ["cfgScale", "CFG Scale"],
  ]) {
    if (meta[key] !== undefined && meta[key] !== null && String(meta[key]).trim() !== "") {
      rows.push({ label, value: String(meta[key]), copyable: true });
    }
  }

  const textBlocks = [];
  if (prompt) {
    textBlocks.push({ title: "Prompt", text: prompt });
  }
  if (typeof meta.negativePrompt === "string" && meta.negativePrompt.trim()) {
    textBlocks.push({ title: "Negative Prompt", text: meta.negativePrompt.trim() });
  }

  if (rows.length === 0 && textBlocks.length === 0) {
    return null;
  }

  return {
    sections: [
      {
        title: "AI Generation",
        rows,
        textBlocks,
      },
    ],
  };
}
