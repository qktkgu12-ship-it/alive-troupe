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
