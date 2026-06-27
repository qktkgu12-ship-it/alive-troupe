// 공통 유틸 함수

// HEX 색상(#7c3aed) -> "124 58 237" (Tailwind rgb 변수용)
export function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `${r} ${g} ${b}`;
}

// 배경색에 대비되는 글자색(흰/검) 자동 결정
export function readableTextColor(hex: string): string {
  const triplet = hexToRgbTriplet(hex).split(" ").map(Number);
  const [r, g, b] = triplet;
  // 상대 휘도 (W3C 간이식)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "17 24 39" : "255 255 255";
}

// ---------- 강조색 1개에서 팔레트(배경·보조색) 자동 생성 ----------
// HSL로 변환해 '색상(Hue)'은 고정하고 채도·명도만 조절 → 같은 계열(모노크롬)로 항상 어울림

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgbTriplet(hex).split(" ").map((n) => Number(n) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function hslToTriplet(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360 / 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return `${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 강조색 → { bg(배경 60%), surface(보조 30%), surfaceStrong(테두리), accentDeep(그라데이션용 진한 강조) }
export function derivePalette(accentHex: string): {
  bg: string;
  surface: string;
  surfaceStrong: string;
  accentDeep: string;
} {
  const [h, s, l] = hexToHsl(accentHex);
  return {
    bg: hslToTriplet(h, clamp(s * 0.4, 0.06, 0.16), 0.975),
    surface: hslToTriplet(h, clamp(s * 0.5, 0.08, 0.2), 0.94),
    surfaceStrong: hslToTriplet(h, clamp(s * 0.5, 0.08, 0.22), 0.88),
    accentDeep: hslToTriplet(h, clamp(s * 1.05, 0, 1), clamp(l * 0.8, 0.12, 0.5)),
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// YYYY-MM
export function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// YYYY-MM-DD
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// 해당 연-월의 달력 그리드(일요일 시작, 6주 = 42칸) 생성
export function buildMonthGrid(year: number, month0: number): (Date | null)[] {
  const first = new Date(year, month0, 1);
  const startDow = first.getDay(); // 0=일
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month0, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

// 가능 시간 30분 슬롯 (12:00 ~ 24:00, 시작시간 기준 24칸)
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 12; h < 24; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

// 슬롯 시작시간 → 끝시간 (+30분)
export function slotEnd(slot: string): string {
  const [h, m] = slot.split(":").map(Number);
  const t = h * 60 + m + 30;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// 상대 시간 표기 (방금 전 / N분 전 / N시간 전 / N일 전 / 날짜)
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// 외부 링크 안전 검사: http(s) 만 허용 (javascript:, data: 등 차단 → 저장형 XSS 방지)
export function safeExternalUrl(url: string): string {
  return /^https?:\/\//i.test((url || "").trim()) ? url.trim() : "";
}

// 배열을 size 단위로 쪼개기 (Firestore 'in' 쿼리는 최대 30개)
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
