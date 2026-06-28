"use client";

import { useMemo } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize";
import Markdown from "./Markdown";

// 본문 렌더: HTML(리치 에디터)이면 정화 후 표시, 아니면(구버전 평문/마크다운) Markdown으로
export default function PostContent({ content, className = "" }: { content: string; className?: string }) {
  const isHtml = /<[a-z][\s\S]*>/i.test(content || "");
  const clean = useMemo(() => (isHtml ? sanitizeRichHtml(content) : ""), [content, isHtml]);

  if (isHtml) {
    return <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  return <Markdown text={content} className={className} />;
}
