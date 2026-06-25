// 로고 → 파비콘 / 모바일 홈화면 / 애플 / 매니페스트 아이콘 자동 생성
import sharp from "sharp";
import { mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// logo-new.png 가 있으면 우선 사용, 없으면 logo.png
const SRC = existsSync(join(root, "logo-new.png"))
  ? join(root, "logo-new.png")
  : join(root, "logo.png");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

mkdirSync(join(root, "public"), { recursive: true });
mkdirSync(join(root, "app"), { recursive: true });

console.log("원본:", SRC);

// 로고 주변 여백을 잘라낸 버전 (투명/단색 테두리 제거)
const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer();

// size 정사각형 안에, 비율 유지하며 padRatio 만큼 여백을 두고 흰 배경에 합성
async function makeIcon(size, padRatio, outPath) {
  const pad = Math.round(size * padRatio);
  const inner = size - pad * 2;
  const fitted = await sharp(trimmed)
    .resize({ width: inner, height: inner, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();
  await sharp(fitted)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .flatten({ background: WHITE }) // 투명 배경을 흰색으로
    .png()
    .toFile(outPath);
  console.log("생성:", outPath);
}

// 일반 아이콘(any)
await makeIcon(512, 0.1, join(root, "public", "icon-512.png"));
await makeIcon(192, 0.1, join(root, "public", "icon-192.png"));
// 마스커블(안드로이드 적응형) — 안전영역 위해 여백 넉넉히
await makeIcon(512, 0.2, join(root, "public", "icon-maskable-512.png"));
// 애플 터치 아이콘
await makeIcon(180, 0.1, join(root, "app", "apple-icon.png"));
// 파비콘(브라우저 탭)
await makeIcon(256, 0.08, join(root, "app", "icon.png"));

console.log("완료!");
