// 가벼운 마크다운 렌더러 (안전: HTML 직접 주입 없이 React 요소로만 생성)
// 지원: **굵게** *기울임* ~~취소선~~ `코드` [글자](http링크) 자동링크, # 제목, > 인용, - / 1. 목록
import { Fragment, type ReactNode } from "react";

const INLINE_RE =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|\*([^*\n]+)\*|`([^`\n]+)`|(https?:\/\/[^\s]+)/g;

function inline(text: string, kp: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${kp}-${i++}`;
    if (m[1] !== undefined) {
      out.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer" className="text-accent underline">{m[1]}</a>);
    } else if (m[3] !== undefined) {
      out.push(<strong key={key}>{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      out.push(<s key={key}>{m[4]}</s>);
    } else if (m[5] !== undefined) {
      out.push(<em key={key}>{m[5]}</em>);
    } else if (m[6] !== undefined) {
      out.push(<code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em]">{m[6]}</code>);
    } else if (m[7] !== undefined) {
      out.push(<a key={key} href={m[7]} target="_blank" rel="noreferrer" className="break-all text-accent underline">{m[7]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BLOCK_START = /^(#{1,3}\s|>\s?|[-*]\s+|\d+\.\s+)/;

export default function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let bi = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? "text-lg font-bold" : lvl === 2 ? "text-base font-bold" : "font-semibold";
      blocks.push(<p key={bi} className={cls}>{inline(h[2], `h${bi}`)}</p>);
      bi++;
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push(
        <blockquote key={bi} className="border-l-2 border-slate-300 pl-3 text-slate-500">
          {q.map((t, ti) => (<Fragment key={ti}>{inline(t, `q${bi}-${ti}`)}{ti < q.length - 1 ? <br /> : null}</Fragment>))}
        </blockquote>
      );
      bi++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i++; }
      blocks.push(<ul key={bi} className="list-disc space-y-0.5 pl-5">{items.map((t, ti) => <li key={ti}>{inline(t, `u${bi}-${ti}`)}</li>)}</ul>);
      bi++;
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      blocks.push(<ol key={bi} className="list-decimal space-y-0.5 pl-5">{items.map((t, ti) => <li key={ti}>{inline(t, `o${bi}-${ti}`)}</li>)}</ol>);
      bi++;
      continue;
    }
    // 문단
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !BLOCK_START.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(
      <p key={bi} className="break-words leading-relaxed">
        {para.map((t, ti) => (<Fragment key={ti}>{inline(t, `p${bi}-${ti}`)}{ti < para.length - 1 ? <br /> : null}</Fragment>))}
      </p>
    );
    bi++;
  }

  return <div className={`space-y-2 ${className}`}>{blocks}</div>;
}
