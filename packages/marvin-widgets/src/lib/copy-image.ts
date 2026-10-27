import { MV_ROOT_CLASS, MV_THEME_CSS } from "../theme";

/**
 * Copies one rendered element to the clipboard as a PNG, as it is on screen: an unfolded list
 * stays unfolded. The element is cloned into an SVG `foreignObject` together with the theme
 * stylesheet, so the token colors resolve without the page around it, drawn onto a canvas at
 * twice its size and written to the clipboard. Descendants marked `data-copy-exclude` are left
 * out (the copy button itself).
 *
 * The clipboard write is started before the image is drawn, with a promise of the blob, because
 * Safari accepts a write only inside the click that asked for it. A host whose iframe is not
 * granted `clipboard-write` refuses it; then `save`, when given, is offered the PNG instead (the
 * widget hands it to the host's `ui/download-file`). Resolves to what happened.
 */
export async function copyElementAsImage(
  node: HTMLElement,
  save?: (png: Blob) => Promise<boolean>,
): Promise<"copied" | "saved"> {
  const png = renderPng(node);
  // Awaited below on every path that needs it; this only keeps a failed render from surfacing
  // as an unhandled rejection when the clipboard refused first and nothing else awaits it.
  png.catch(() => undefined);
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      throw new Error("clipboard images are not supported here");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return "copied";
  } catch (refused) {
    if (save && (await save(await png))) return "saved";
    throw refused;
  }
}

/** A blob as base64, the form an MCP embedded resource carries binary content in. */
export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function themeOf(node: HTMLElement): "light" | "dark" {
  const pinned = node.closest(`.${MV_ROOT_CLASS}`)?.getAttribute("data-theme");
  if (pinned === "light" || pinned === "dark") return pinned;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function renderPng(node: HTMLElement): Promise<Blob> {
  const { width, height } = node.getBoundingClientRect();
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const clone = node.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll("[data-copy-exclude]")) el.remove();
  clone.style.margin = "0";

  const root = document.createElement("div");
  root.className = MV_ROOT_CLASS;
  root.setAttribute("data-theme", themeOf(node));
  root.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  root.style.width = `${w}px`;
  const style = document.createElement("style");
  style.textContent = MV_THEME_CSS;
  root.append(style, clone);

  const xhtml = new XMLSerializer().serializeToString(root);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"),
  );
}
