const DEFAULT_MODELS = [
  "flux2",
  "gpt_image_2",
  "mango",
  "nano_banana_v2",
  "seedream",
  "guava",
  "minimax_h3_image",
];

/** @param {{ key?: string }} input */
export async function settingOptions({ key }) {
  if (key !== "defaultArchitecture") return [];
  const fallback = DEFAULT_MODELS.map((id) => ({ value: id, label: id }));
  const apiKey = (globalThis.host?.settings?.get("apiKey", "") || "").trim();
  if (!apiKey) return fallback;

  try {
    const res = await fetch("https://api.mage.space/v1/architectures", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const list = (data.architectures || [])
      .filter((/** @type {any} */ x) => x && x.type === "image" && x.id && x.image_inputs?.references?.field)
      .map((/** @type {any} */ x) => ({
        value: String(x.id),
        label: x.name && x.name !== x.id ? `${x.name} (${x.id})` : String(x.id),
      }));
    return list.length ? list : fallback;
  } catch {
    return fallback;
  }
}
