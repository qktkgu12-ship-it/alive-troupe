// logo.png(빨간 Alive 손글씨) → 헤더용 워드마크 (여백 잘라낸 투명/단색 PNG)
import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "public"), { recursive: true });

await sharp(join(root, "logo.png"))
  .trim({ threshold: 10 })
  .resize({ height: 140 }) // 레티나 대비 2x (표시 높이 ~28~36px)
  .png()
  .toFile(join(root, "public", "wordmark.png"));

console.log("생성: public/wordmark.png");
