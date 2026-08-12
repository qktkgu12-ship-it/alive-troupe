"use client";

// 아카이브 자료 등록·수정 폼 (아카이브 페이지 + 전역 바텀시트 공용)

import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useTheme } from "@/lib/theme-context";
import Select from "@/components/Select";
import type { ArchiveClip, ArchiveItem, ArchiveKind, Production } from "@/lib/types";

// 오늘 날짜(YYYY-MM-DD, 로컬 기준)
function todayStr() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// 자료의 영상 목록 (구버전: url 하나 → 단일 클립으로 변환)
export function itemClips(it: ArchiveItem): ArchiveClip[] {
  if (it.clips && it.clips.length > 0) return it.clips;
  if (it.url) return [{ label: "", url: it.url }];
  return [];
}

export default function ArchiveForm({
  productions,
  isAdmin,
  onSaved,
  onCancel,
  author,
  edit,
  bare = false,
}: {
  productions: Production[];
  isAdmin: boolean;
  onSaved: () => void;
  onCancel: () => void;
  author: { uid: string; name: string };
  edit?: ArchiveItem;
  bare?: boolean; // true = 카드 테두리 없이 (바텀시트 안에서 사용)
}) {
  const { settings } = useTheme();
  // 새 자료: 현재 진행 작품을 기본 선택(접근 가능한 작품일 때만), 날짜는 오늘
  const defaultPid =
    settings.currentProductionId && productions.some((p) => p.id === settings.currentProductionId)
      ? settings.currentProductionId
      : "";

  const [title, setTitle] = useState(edit?.title ?? "");
  const [productionId, setProductionId] = useState(edit ? edit.productionId ?? "" : defaultPid);
  const [kind, setKind] = useState<ArchiveKind>(edit?.kind ?? "rehearsal");
  const [date, setDate] = useState(edit ? edit.date : todayStr());
  const [clips, setClips] = useState<ArchiveClip[]>(edit ? itemClips(edit) : [{ label: "", url: "" }]);
  const [description, setDescription] = useState(edit?.description ?? "");
  const [tags, setTags] = useState((edit?.tags ?? []).join(" "));
  const [busy, setBusy] = useState(false);

  function updateClip(i: number, field: keyof ArchiveClip, val: string) {
    setClips((prev) => prev.map((c, idx) => (idx === i ? { ...c, [field]: val } : c)));
  }
  function addClip() {
    setClips((prev) => [...prev, { label: "", url: "" }]);
  }
  function removeClip(i: number) {
    setClips((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function save() {
    const cleaned = clips
      .map((c) => ({
        label: c.label.trim(),
        url: c.url.trim() ? (c.url.trim().startsWith("http") ? c.url.trim() : `https://${c.url.trim()}`) : "",
      }))
      .filter((c) => c.url);

    if (!title.trim() || cleaned.length === 0) {
      alert("제목과 링크(최소 1개)는 필수입니다.");
      return;
    }
    if (!isAdmin && !productionId) {
      alert("작품을 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const fields = {
        title: title.trim(),
        productionId: productionId || null,
        kind,
        date: date || new Date().toISOString().slice(0, 10),
        url: cleaned[0].url, // 대표 링크(구버전 호환)
        clips: cleaned,
        description,
        tags: tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean),
      };
      if (edit) {
        // 수정: 작성자·작성일은 유지
        await setDoc(doc(db, "archives", edit.id), fields, { merge: true });
      } else {
        await setDoc(doc(db, "archives", crypto.randomUUID()), {
          ...fields,
          createdBy: author.uid,
          createdByName: author.name,
          createdAt: Date.now(),
        });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={bare ? "space-y-3" : "card space-y-3"}>
      {!bare && <p className="font-bold text-slate-900">{edit ? "자료 수정" : "자료 등록"}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Select value={productionId} onChange={(e) => setProductionId(e.target.value)}>
            <option value="">{isAdmin ? "미지정 (관리자만 볼 수 있음)" : "작품을 선택하세요"}</option>
            {productions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          {productions.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              {isAdmin ? "작품 관리에서 작품을 먼저 만들어 주세요." : "참여 중인 작품이 없습니다."}
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
        </div>
        <div>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ArchiveKind)}>
            <option value="rehearsal">연습</option>
            <option value="performance">공연</option>
            <option value="etc">기타</option>
          </Select>
        </div>
        <div>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <div className="space-y-2">
            {clips.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input w-28 shrink-0"
                  value={c.label}
                  onChange={(e) => updateClip(i, "label", e.target.value)}
                  placeholder="라벨"
                />
                <input
                  className="input flex-1"
                  value={c.url}
                  onChange={(e) => updateClip(i, "url", e.target.value)}
                  placeholder="https://youtu.be/..."
                />
                {clips.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeClip(i)}
                    aria-label="링크 삭제"
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-slate-400 transition hover:bg-slate-50 hover:text-red-500"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={addClip} className="mt-2 text-sm font-medium text-accent hover:underline">
            + 링크 추가
          </button>
        </div>
        <div className="sm:col-span-2">
          <textarea className="input min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명·메모" />
        </div>
        <div className="sm:col-span-2">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-ghost">취소</button>
        <button onClick={save} disabled={busy} className="btn-accent flex-1">
          {busy ? "저장 중…" : edit ? "수정 저장" : "자료 등록"}
        </button>
      </div>
    </div>
  );
}
