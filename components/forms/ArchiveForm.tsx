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
  submitRef,
}: {
  productions: Production[];
  isAdmin: boolean;
  onSaved: () => void;
  onCancel: () => void;
  author: { uid: string; name: string };
  edit?: ArchiveItem;
  submitRef?: React.MutableRefObject<(() => void) | null>;
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
  const [busy, setBusy] = useState(false);

  // 헤더 ✓ 버튼 등록
  if (submitRef) submitRef.current = () => { void save(); };

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
        tags: [],
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
    <div className="space-y-3">
      {/* 작품 */}
      <div className="card !p-0 overflow-hidden">
        <Select
          className="!border-0 !bg-transparent !px-4 !py-3.5 !text-[15px] !ring-0"
          value={productionId}
          onChange={(e) => setProductionId(e.target.value)}
        >
          <option value="">{isAdmin ? "미지정 (관리자만 볼 수 있음)" : "작품을 선택하세요"}</option>
          {productions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>
      {productions.length === 0 && (
        <p className="px-1 text-xs text-amber-600">
          {isAdmin ? "작품 관리에서 작품을 먼저 만들어 주세요." : "참여 중인 작품이 없습니다."}
        </p>
      )}

      {/* 제목 */}
      <div className="card !p-0 overflow-hidden">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      </div>

      {/* 종류 */}
      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-[15px] font-medium text-slate-700">종류</span>
          <Select
            wrapperClassName="w-32"
            className="!border-0 !bg-surface !py-1.5 !text-[15px] !ring-0"
            value={kind}
            onChange={(e) => setKind(e.target.value as ArchiveKind)}
          >
            <option value="rehearsal">연습</option>
            <option value="performance">공연</option>
            <option value="etc">기타</option>
          </Select>
        </div>
      </div>

      {/* 링크 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        {clips.map((c, i) => (
          <div key={i} className="flex items-center gap-1 pr-2">
            <input
              className="field w-24 shrink-0 !px-4"
              value={c.label}
              onChange={(e) => updateClip(i, "label", e.target.value)}
              placeholder="라벨"
            />
            <input
              className="field min-w-0 flex-1 !px-0"
              value={c.url}
              onChange={(e) => updateClip(i, "url", e.target.value)}
              placeholder="https://youtu.be/..."
            />
            {clips.length > 1 && (
              <button
                type="button"
                onClick={() => removeClip(i)}
                aria-label="링크 삭제"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-slate-50 hover:text-red-500"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addClip} className="w-full px-4 py-3 text-left text-sm font-medium text-slate-500 transition hover:bg-slate-50">
          + 링크 추가
        </button>
      </div>

      {/* 설명 */}
      <div className="card !p-0 overflow-hidden">
        <textarea
          className="field min-h-[80px] resize-none"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="설명·메모"
        />
      </div>

    </div>
  );
}
