// 리치 본문(HTML) 안전 정화 — 허용 태그 화이트리스트 (브라우저 DOM 기반, 클라이언트 전용)
// 허용 외 태그는 풀어헤치고(unwrap), script/style은 제거, a[href]는 http(s)만 유지

const ALLOWED = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "A",
  "UL", "OL", "LI", "BLOCKQUOTE", "BR", "P", "DIV", "SPAN", "H1", "H2", "H3",
  "FONT",
  // 본문 중간에 끼워 넣는 사진. 실제 이미지는 postMedia 하위 문서에 있고
  // 본문에는 data-mid(=사진 id)만 남는다. 글 문서가 1MB를 넘지 않도록.
  "IMG",
]);

// 편집기가 서식을 걸 자리를 만들려고 넣는 '자리표시 글자'(zero-width space).
// 눈에 안 보이지만 글자 수에도 잡히고 검색에도 걸리므로 저장 전에 전부 걷어낸다.
// (왜 넣는지는 lib/rich-text의 applyMark 참고)
const ANCHOR_RE = /​/g;

export function sanitizeRichHtml(html: string): string {
  if (typeof document === "undefined") return "";
  const root = document.createElement("div");
  root.innerHTML = (html || "").replace(ANCHOR_RE, "");

  const clean = (parent: Node) => {
    Array.from(parent.childNodes).forEach((node) => {
      if (node.nodeType === 8) {
        parent.removeChild(node); // 주석 제거
        return;
      }
      if (node.nodeType !== 1) return; // 텍스트는 허용
      const el = node as Element;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") {
        parent.removeChild(el);
        return;
      }
      if (!ALLOWED.has(el.tagName)) {
        // 허용 외 태그: 내용만 남기고 태그 제거
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
      Array.from(el.attributes).forEach((a) => {
        const n = a.name.toLowerCase();
        if (el.tagName === "A" && n === "href" && /^https?:\/\//i.test(a.value)) return;
        if (el.tagName === "FONT" && n === "size") return; // 글자 크기
        // 본문 사진: 자리표시자 id만 남기고 src(=수십 KB의 base64)는 떼어낸다
        if (el.tagName === "IMG" && n === "data-mid" && /^[a-z0-9-]{1,40}$/i.test(a.value)) return;
        // text-align만 허용 (정렬)
        if (n === "style" && /^text-align:\s*(left|center|right);?$/i.test(a.value.trim())) return;
        el.removeAttribute(a.name);
      });
      // data-mid 없는 사진(외부에서 붙여넣은 것 등)은 통째로 버린다
      if (el.tagName === "IMG" && !el.getAttribute("data-mid")) {
        parent.removeChild(el);
        return;
      }
      if (el.tagName === "A") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noreferrer noopener");
      }
      clean(el);
    });
  };

  let guard = 0;
  do {
    clean(root);
    guard++;
  } while (guard < 8 && Array.from(root.querySelectorAll("*")).some((e) => !ALLOWED.has(e.tagName)));

  return root.innerHTML;
}

// 글자 수/요약용: 태그 제거한 순수 텍스트
export function htmlToText(html: string): string {
  if (typeof document === "undefined") return (html || "").replace(/<[^>]*>/g, "").replace(ANCHOR_RE, "");
  const d = document.createElement("div");
  d.innerHTML = html || "";
  // 자리표시 글자를 빼야 '아무것도 안 썼는데 글자가 있다'고 잘못 세지 않는다
  return (d.textContent || "").replace(ANCHOR_RE, "");
}
