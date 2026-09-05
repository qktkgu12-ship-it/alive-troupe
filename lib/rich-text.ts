// 글쓰기 편집기 두 곳이 같이 쓰는 부분.
//
// ⚠️ 편집기가 둘이다.
//    PC  → app/board/write (components/RichEditor)
//    폰  → components/PostEditorSheet   ← 폰에서 글을 쓰면 이쪽이 열린다
//    (어느 쪽을 열지는 lib/post-editor-context가 isMobileDevice로 가른다)
//    한쪽만 고치면 다른 쪽은 그대로 남는다. 실제로 폰 툴바가 안 먹는 걸 고친다며
//    PC 편집기만 세 번 고친 적이 있다. 공통 로직은 반드시 여기에 둘 것.

/** 커서 자리에 걸려 있는 서식 — 툴바 버튼을 켜고 끄는 데 쓴다 */
export type Marks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  ul: boolean;
  ol: boolean;
  quote: boolean;
  align: string;
  /** <font size="n">이 걸려 있을 때만 값이 있다 (지정 안 했으면 빈 문자열) */
  size: string;
  /**
   * '지금 커서 자리의 실제 글자 크기' (1~7).
   *
   * size와 다르다 — size는 태그가 실제로 만들어졌을 때만 값이 있어서,
   * 커서만 두고 '크게'를 누른 직후(아직 글자를 안 친 상태)에는 빈 값이다.
   * 이 값은 브라우저가 픽셀 크기를 환산해 주는 것이라 그 순간도 잡힌다.
   * 대신 손도 안 댄 기본 글자도 2나 3을 돌려주므로
   * '어떤 크기가 켜져 있나'가 아니라 '특정 크기인가'를 물어볼 때만 쓸 것.
   */
  sizeNow: string;
};

export const NO_MARKS: Marks = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  ul: false,
  ol: false,
  quote: false,
  align: "justifyLeft",
  size: "",
  sizeNow: "",
};

function q(c: string): boolean {
  try {
    return document.queryCommandState(c);
  } catch {
    return false;
  }
}
function v(c: string): string {
  try {
    return String(document.queryCommandValue(c) ?? "");
  } catch {
    return "";
  }
}

/**
 * 커서가 지금 어떤 서식 안에 있는지 읽는다.
 *
 * queryCommandState만 믿으면 안 된다 — 브라우저가 알아서 계산해 주는 편의 기능이라
 * 기기마다 결과가 다르고, 폰에서는 서식이 걸려 있어도 전부 false를 주는 경우가 있다.
 * 그래서 커서 위의 태그를 직접 훑어 본 결과와 둘 중 하나라도 잡히면 켜진 것으로 본다.
 */
export function readMarks(root: HTMLElement | null): Marks {
  const found = { ...NO_MARKS, align: "", size: "" };
  // 커서가 편집칸 '안'에 있는가. 밖(제목칸 등)에 있으면 크기를 읽지 않는다 —
  // 제목칸은 글자가 크니까 손도 안 댄 빈 글에서 '크게'가 켜진 것처럼 보인다.
  let inside = false;

  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (sel && sel.rangeCount > 0 && root) {
    inside = root.contains(sel.getRangeAt(0).commonAncestorContainer);
    let n: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    while (n && n !== root) {
      if (n instanceof HTMLElement) {
        switch (n.tagName) {
          case "B": case "STRONG": found.bold = true; break;
          case "I": case "EM": found.italic = true; break;
          case "U": found.underline = true; break;
          case "S": case "STRIKE": case "DEL": found.strike = true; break;
          case "UL": found.ul = true; break;
          case "OL": found.ol = true; break;
          case "BLOCKQUOTE": found.quote = true; break;
          case "FONT": {
            const s = n.getAttribute("size");
            if (s && !found.size) found.size = s;
            break;
          }
        }
        // 정렬은 가장 가까운 것이 이긴다 (안쪽 블록이 바깥을 덮어쓴다)
        const a = n.style?.textAlign;
        if (a && !found.align) found.align = a;
      }
      n = n.parentNode;
    }
  }

  const alignFromDom =
    found.align === "center" ? "justifyCenter" : found.align === "right" ? "justifyRight" : "";

  return {
    bold: q("bold") || found.bold,
    italic: q("italic") || found.italic,
    underline: q("underline") || found.underline,
    strike: q("strikeThrough") || found.strike,
    ul: q("insertUnorderedList") || found.ul,
    ol: q("insertOrderedList") || found.ol,
    // formatBlock은 대소문자가 브라우저마다 다르다 (blockquote / BLOCKQUOTE)
    quote: v("formatBlock").toLowerCase() === "blockquote" || found.quote,
    align:
      alignFromDom ||
      (q("justifyCenter") ? "justifyCenter" : q("justifyRight") ? "justifyRight" : "justifyLeft"),
    // 크기는 queryCommandValue를 쓰지 않는다. 그 값은 '지금 몇 픽셀인가'를 1~7로
    // 환산해 주는 거라, 크기를 건드린 적 없는 글자도 편집칸 기본 크기에 따라
    // 2나 3이 나온다 → 툴바가 늘 켜져 있게 된다.
    // execCommand가 실제로 넣는 <font size="n">만 인정한다.
    size: found.size,
    // 반대로 sizeNow는 그 환산값을 그대로 쓴다. 아직 태그가 안 생긴
    // '눌러만 둔' 상태까지 잡아야 툴바가 바로 켜지기 때문이다.
    sizeNow: inside ? v("fontSize") : "",
  };
}

/**
 * 커서를 편집칸 맨 끝에 놓는다.
 *
 * 아무것도 안 쓴 상태에서 툴바부터 누르는 경우를 위한 것.
 * 그때는 기억해 둔 커서가 없어서, 포커스만 줘서는 execCommand가 걸릴 자리가 없다
 * → 서식을 켜도 아무 일도 안 일어난다.
 */
export function placeCaretAtEnd(el: HTMLElement | null): void {
  if (!el) return;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

/** 줄바꿈을 넘어가도 이어져야 하는 서식 (한 글자에 걸리는 것들) */
const INLINE: [keyof Marks, string][] = [
  ["bold", "bold"],
  ["italic", "italic"],
  ["underline", "underline"],
  ["strike", "strikeThrough"],
];

/**
 * Enter를 누르기 '직전'에 불러 둘 것.
 *
 * 브라우저는 줄이 바뀌면 켜 두었던 서식을 놓아 버리는 경우가 있다.
 * 굵게를 켜고 쓰다가 엔터를 치면 다음 줄부터 슬그머니 풀리는 게 그것이다.
 * 줄이 바뀐 직후에 다시 확인해서, 빠진 것만 도로 켠다.
 */
export function keepMarksAcrossNewline(
  root: HTMLElement | null,
  /**
   * 되살린 뒤의 서식 상태를 돌려준다 — 툴바 버튼의 켜짐 표시를 여기에 맞춰야 한다.
   *
   * ⚠️ 이걸 안 넘기면 서식은 되살아나는데 툴바만 꺼져 보인다.
   *    엔터의 keyup이 이 되살리기보다 먼저 올 때가 있어서,
   *    편집기가 keyup에서 읽은 '풀린 상태'가 그대로 화면에 남기 때문이다.
   */
  onRestored?: (marks: Marks) => void
): void {
  const before = readMarks(root);

  const reapply = () => {
    const after = readMarks(root);
    let touched = false;
    for (const [key, command] of INLINE) {
      if (before[key] && !after[key]) {
        try {
          document.execCommand(command, false);
          touched = true;
        } catch {
          /* 무시 */
        }
      }
    }
    // 크기는 size가 아니라 sizeNow로 본다.
    // size는 <font size> 태그가 실제로 만들어졌을 때만 값이 있어서,
    // '크게'를 눌러만 두고 아직 글자를 안 친 상태에서는 늘 비어 있었다
    // → 바로 그 상태에서 엔터를 치면 크기가 조용히 풀렸다.
    if (before.sizeNow && after.sizeNow !== before.sizeNow) {
      try {
        document.execCommand("fontSize", false, before.sizeNow);
        touched = true;
      } catch {
        /* 무시 */
      }
    }
    if (touched) onRestored?.(readMarks(root));
    return touched;
  };

  // requestAnimationFrame이 아니라 setTimeout을 쓴다 — rAF는 화면이 안 그려지는
  // 상황(백그라운드 탭 등)에서 아예 안 돌아서 서식이 조용히 풀릴 수 있다.
  setTimeout(reapply, 0);
  // 새 줄을 늦게 만드는 기기가 있어 한 번 더 확인한다.
  // 첫 번째에서 이미 되살아났으면 after가 켜진 상태라 두 번 걸리지 않는다.
  setTimeout(reapply, 60);
}
