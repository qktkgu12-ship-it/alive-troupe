"use client";

import { useMemo } from "react";
import { sanitizeRichHtml } from "@/lib/sanitize";
import { hydrateMedia, type MediaMap } from "@/lib/post-media";
import Markdown from "./Markdown";

// 본문 렌더: HTML(리치 에디터)이면 정화 후 표시, 아니면(구버전 평문/마크다운) Markdown으로
//
// 본문 중간의 사진은 <img data-mid>로만 저장돼 있어서, 실제 이미지를 끼워 넣어 준다.
export default function PostContent({
  content,
  media,
  onImageClick,
  className = "",
}: {
  content: string;
  media?: MediaMap;
  onImageClick?: (src: string) => void;
  className?: string;
}) {
  const isHtml = /<[a-z][\s\S]*>/i.test(content || "");
  const clean = useMemo(() => {
    if (!isHtml) return "";
    const safe = sanitizeRichHtml(content);
    return media ? hydrateMedia(safe, media) : safe;
  }, [content, isHtml, media]);

  if (isHtml) {
    return (
      <div
        className={`rich ${className} [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl ${
          onImageClick ? "[&_img]:cursor-zoom-in" : ""
        }`}
        // 사진을 누르면 크게 보기 — 본문 전체에 한 번만 걸어 둔다
        onClick={
          onImageClick
            ? (e) => {
                const el = e.target as HTMLElement;
                if (el.tagName === "IMG") {
                  const src = (el as HTMLImageElement).src;
                  if (src) onImageClick(src);
                }
              }
            : undefined
        }
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return <Markdown text={content} className={className} />;
}
