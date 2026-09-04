// @언급 — 댓글·답글에서 "@이름"으로 단원을 부르는 기능.
//
// 저장 형식은 그냥 글자다. "@김민수 이거 확인해줘"가 그대로 들어간다.
// 특별한 표시(uid를 숨겨 넣는 등)를 쓰지 않는 이유:
//   · 알림에 그대로 실을 수 있다 (문구를 다시 만들 필요가 없다)
//   · 언급 기능을 나중에 빼도 예전 댓글이 이상한 기호로 남지 않는다
//   · 이름이 바뀌면 강조가 풀릴 뿐, 글자는 멀쩡하다
// 대신 누구를 부른 건지는 이름을 명단과 맞춰 찾아낸다 (아래 두 함수).

export type MentionMember = { uid: string; name: string; avatar?: string };

/** 정규식에서 특별한 뜻을 가진 글자를 글자 그대로 쓰도록 막는다 */
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 이름이 긴 것부터 — "김민"과 "김민수"가 같이 있으면 "김민수"가 먼저 맞아야 한다 */
function byLongestName(members: MentionMember[]) {
  return members.filter((m) => m.name?.trim()).sort((a, b) => b.name.length - a.name.length);
}

/**
 * 본문에서 언급된 단원의 uid를 찾아낸다.
 *
 * "@"는 글 맨 앞이나 공백 뒤에 있을 때만 언급으로 본다 —
 * 이메일 주소(a@b.com)의 @까지 언급으로 세면 엉뚱한 사람에게 알림이 간다.
 */
export function extractMentionUids(text: string, members: MentionMember[]): string[] {
  if (!text.includes("@")) return [];
  const sorted = byLongestName(members);
  const found = new Set<string>();

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    // 앞 글자가 공백이 아니면 이름이 아니라 주소 같은 것
    if (i > 0 && !/\s/.test(text[i - 1])) continue;
    const rest = text.slice(i + 1);
    const hit = sorted.find((m) => rest.startsWith(m.name));
    if (hit) {
      found.add(hit.uid);
      i += hit.name.length; // 찾은 이름은 건너뛴다
    }
  }
  return [...found];
}

/**
 * 화면에 그릴 때 쓸 조각 목록.
 * 명단에 있는 이름만 언급으로 칠한다 — 아무 "@아무개"나 색이 붙으면
 * 진짜로 누굴 부른 건지 구분이 안 된다.
 */
export type TextPart = { type: "text" | "mention"; value: string };

export function splitMentions(text: string, members: MentionMember[]): TextPart[] {
  const sorted = byLongestName(members);
  if (sorted.length === 0 || !text.includes("@")) return [{ type: "text", value: text }];

  // (^|\s) 뒤의 @이름만 — extractMentionUids와 같은 규칙
  const re = new RegExp(`(^|\\s)@(${sorted.map((m) => escapeRe(m.name)).join("|")})`, "g");
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index! + m[1].length; // 앞 공백은 일반 글자로 남긴다
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "mention", value: `@${m[2]}` });
    last = start + 1 + m[2].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/**
 * 지금 커서 자리에서 @자동완성을 띄워야 하는지 본다.
 * 띄워야 하면 @가 시작된 위치와 지금까지 친 글자를 돌려준다.
 */
export function activeMentionQuery(
  text: string,
  caret: number
): { at: number; query: string } | null {
  // 커서 바로 왼쪽부터 거슬러 올라가며 @를 찾는다
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      if (i > 0 && !/\s/.test(text[i - 1])) return null; // 주소의 @
      return { at: i, query: text.slice(i + 1, caret) };
    }
    // 공백을 만나면 이 낱말엔 @가 없다는 뜻
    if (/\s/.test(ch)) return null;
    // 이름이 이보다 길 일은 없다 (너무 멀리까지 훑지 않게)
    if (caret - i > 20) return null;
  }
  return null;
}
