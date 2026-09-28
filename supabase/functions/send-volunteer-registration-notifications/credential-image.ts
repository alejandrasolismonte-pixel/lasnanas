import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { CREDENTIAL_FONT_BASE64 } from "./credential-font.ts";
import { CREDENTIAL_WASM_BASE64 } from "./credential-renderer-wasm.ts";

const width = 1586;
const height = 992;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const fontBytes = Uint8Array.from(atob(CREDENTIAL_FONT_BASE64), (char) => char.charCodeAt(0));
let wasmReady: Promise<void> | undefined;

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 16_384) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 16_384)));
  }
  return btoa(chunks.join(""));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character] as string);
}

function textWidth(value: string, size: number): number {
  return [...value].reduce((sum, char) => {
    const proportion = char === " " ? .29 : /[ilI1.,:]/u.test(char) ? .3 : /[MWmw]/u.test(char) ? .9 : .6;
    return sum + proportion * size;
  }, 0);
}

function wrapName(value: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const char of word) {
      if (textWidth(line + char, size) > maxWidth && line) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function nameMarkup(name: string): string {
  for (let size = 88; size >= 52; size -= 2) {
    if (textWidth(name, size) <= 725)
      return `<text x="595" y="466" font-size="${size}">${escapeXml(name)}</text>`;
  }
  for (let size = 62; size >= 30; size -= 2) {
    const lines = wrapName(name, size, 725);
    if (lines.length > 2) continue;
    return lines.map((line, index) =>
      `<text x="595" y="${lines.length === 1 ? 466 : 420 + index * 58}" font-size="${size}">${escapeXml(line)}</text>`
    ).join("");
  }
  for (let size = 28; size >= 18; size -= 2) {
    const lines = wrapName(name, size, 725);
    if (lines.length > 3) continue;
    return lines.map((line, index) =>
      `<text x="595" y="${386 + index * 44}" font-size="${size}">${escapeXml(line)}</text>`
    ).join("");
  }
  const characters = [...name];
  const lineLength = Math.ceil(characters.length / 3);
  return [0, 1, 2].map((index) => fittedText(
    characters.slice(index * lineLength, (index + 1) * lineLength).join(""),
    595, 386 + index * 44, 725, 28, 16, "#fff6e6"
  )).join("");
}

function fittedText(value: string, x: number, y: number, maxWidth: number, maxSize: number, minSize: number, color: string): string {
  let size = maxSize;
  while (size > minSize && textWidth(value, size) > maxWidth) size -= 2;
  const fit = textWidth(value, size) > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${fit}>${escapeXml(value)}</text>`;
}

async function initializeRenderer(): Promise<void> {
  wasmReady ??= (async () => {
    const bytes = Uint8Array.from(atob(CREDENTIAL_WASM_BASE64), (char) => char.charCodeAt(0));
    await initWasm(bytes);
  })();
  try { await wasmReady; } catch (error) { wasmReady = undefined; throw error; }
}

export type InitialCredentialDetails = {
  name: string;
  planId: "keyuwün" | "kimün" | "pülli";
  expiresAt: string;
};

// Generates the attachment from the same artwork and field positions as the panel credential.
// This copy intentionally uses the generic avatar; uploading a photo updates the panel download.
export async function renderInitialCredentialPng(background: Uint8Array, details: InitialCredentialDetails): Promise<Uint8Array> {
  if (background.length < 100 || background.length > 3_000_000 ||
      !pngSignature.every((byte, index) => background[index] === byte)) throw new Error("invalid_credential_background");
  // deno-lint-ignore no-control-regex
  const name = String(details.name).normalize("NFC").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().replace(/\s+/g, " ");
  const plans = { "keyuwün": "Keyuwün", "kimün": "Kimün", "pülli": "Pülli" } as const;
  if (!name || name.length > 125 || !Object.hasOwn(plans, details.planId) || Number.isNaN(Date.parse(details.expiresAt))) {
    throw new Error("invalid_credential_details");
  }
  const expiry = new Intl.DateTimeFormat("es-CL", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Santiago",
  }).format(new Date(details.expiresAt));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <image x="0" y="0" width="${width}" height="${height}" xlink:href="data:image/png;base64,${base64(background)}"/>
    <defs><clipPath id="avatar"><circle cx="333" cy="544" r="181"/></clipPath></defs>
    <g clip-path="url(#avatar)" fill="#ded6c8"><circle cx="333" cy="501" r="67"/><ellipse cx="333" cy="694" rx="146" ry="120"/></g>
    <g font-family="Noto Sans" font-weight="400" fill="#fff6e6" stroke="#fff6e6" stroke-width="1.1" paint-order="stroke fill">
      ${nameMarkup(name)}
      ${fittedText(plans[details.planId], 752, 557, 420, 75, 43, "#f47820")}
      ${fittedText(expiry, 737, 702, 575, 43, 30, "#fff6e6")}
      ${fittedText("Membresía activa", 232, 814, 305, 36, 27, "#fff6e6")}
    </g>
  </svg>`;
  await initializeRenderer();
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    font: { fontBuffers: [fontBytes], defaultFontFamily: "Noto Sans" },
  });
  try {
    const image = renderer.render();
    try { return image.asPng().slice(); }
    finally { image.free(); }
  } finally { renderer.free(); }
}

export function encodeCredentialAttachment(png: Uint8Array) {
  if (png.length < 100 || png.length > 3_000_000 ||
      !pngSignature.every((byte, index) => png[index] === byte)) throw new Error("invalid_credential_png");
  return { name: "credencial-las-nanas-inicial.png", content: base64(png) };
}
