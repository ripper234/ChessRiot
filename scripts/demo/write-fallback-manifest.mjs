import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assetDirectory = resolve(projectRoot, "public/demo-assets");
const paths = {
  media: resolve(assetDirectory, "chessriot-demo.mp4"),
  narration: resolve(assetDirectory, "fallback-narration.mp3"),
  captions: resolve(assetDirectory, "captions.vtt"),
};
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const manifest = {
  storyVersion: 4,
  durationSeconds: 90,
  width: 1280,
  height: 720,
  mimeType: "video/mp4",
  sizeBytes: statSync(paths.media).size,
  sha256: digest(paths.media),
  narrationSha256: digest(paths.narration),
  captionsSha256: digest(paths.captions),
};

writeFileSync(
  resolve(assetDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
