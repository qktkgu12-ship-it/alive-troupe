// 리치 본문(HTML) 안전 정화 — 허용 태그 화이트리스트 (브라우저 DOM 기반, 클라이언트 전용)
// 허용 외 태그는 풀어헤치고(unwrap), script/style은 제거, a[href]는 http(s)만 유지

const ALLOWED = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "A",
  "UL", "OL", "LI", "BLOCKQUOTE", "BR", "P", "DIV", "SPAN", "H1", "H2", "H3",
]);

export function sanitizeRichHtml(html: string): string {
  if (typeof document === "undefined") return "";
  const root = document.createElement("div");
  root.innerHTML = html || "";

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
        el.removeAttribute(a.name);
      });
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
  if (typeof document === "undefined") return (html || "").replace(/<[^>]*>/g, "");
  const d = document.createElement("div");
  d.innerHTML = html || "";
  return d.textContent || "";
}
