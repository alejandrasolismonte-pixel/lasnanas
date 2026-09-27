import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.4.0";

const wasm = await Deno.readFile(new URL("./index_bg.wasm", import.meta.resolve("npm:@resvg/resvg-wasm@2.4.0")));
await initWasm(wasm);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#064036"/><text x="20" y="100" fill="white" font-family="sans-serif" font-size="60">Ñañas Kimün</text></svg>`;
const image = new Resvg(svg).render();
const bytes = image.asPng();
console.log("png", bytes.length, Array.from(bytes.slice(0, 8)));
await Deno.writeFile("supabase/functions/send-volunteer-registration-notifications/_credential_scratch.png", bytes);
