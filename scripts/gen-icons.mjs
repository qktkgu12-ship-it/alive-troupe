// logo.png → 파비콘 / 모바일 홈화면 / 애플 / 매니페스트 아이콘 자동 생성
import sharp from "sharp";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "logo.png");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

mkdirSync(join(root, "public"), { recursive: true });
mkdirSync(join(root, "app"), { recursive: true });

// 로고 주변 여백을 잘라낸 버전
const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer();

// size 정사각형 안에, 비율 유지하며 padRatio 만큼 여백을 두고 로고 배치
async function makeIcon(size, padRatio, outPath) {
  const pad = Math.round(size * padRatio);
  const inner = size - pad * 2;
  const fitted = await sharp(trimmed)
    .resize({ width: inner, height: inner, fit: "contain", background: WHITE })
    .toBuffer();
  await sharp(fitted)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: WHITE })
    .png()
    .toFile(outPath);
  console.log("생성:", outPath);
}

// 일반 아이콘(any) — 여백 적당히
await makeIcon(512, 0.12, join(root, "public", "icon-512.png"));
await makeIcon(192, 0.12, join(root, "public", "icon-192.png"));
// 마스커블(안드로이드 적응형) — 안전영역 위해 여백 넉넉히
await makeIcon(512, 0.22, join(root, "public", "icon-maskable-512.png"));
// 애플 터치 아이콘
await makeIcon(180, 0.12, join(root, "app", "apple-icon.png"));
// 파비콘(브라우저 탭) — Next가 app/icon.png 를 자동 인식
await makeIcon(256, 0.1, join(root, "app", "icon.png"));

console.log("완료!");
