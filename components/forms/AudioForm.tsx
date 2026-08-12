"use client";

// 자료실 등록 폼 (자료실 페이지 + 전역 바텀시트 공용)
// 페이지에서는 이미 고른 작품에 추가하고, 바텀시트에서는 작품을 직접 고름.

import { useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Select from "@/components/Select";
import type { Production } from "@/lib/types";

export default function AudioForm({
  productionId,
  productions,
  categories,
  defaultCat,
  addedByName,
  onAdded,
  onCancel,
}: {
  productionId?: string; // 고정 작품 (페이지에서 사용). 없으면 선택 UI 표시
  productions?: Production[]; // 작품 선택 목록 (바텀시트에서 사용)
  categories: string[];
  defaultCat: string;
  addedByName: string;
  onAdded: () => void;
  onCancel?: () => void;
}) {
  const fixed = !!productionId;
  const [pid, setPid] = useState(productionId ?? productions?.[0]?.id ?? "");
  const [cat, setCat] = useState(defaultCat);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCat(defaultCat);
  }, [defaultCat]);

  // 작품 목록이 늦게 로드되면 첫 작품을 기본 선택
  useEffect(() => {
    if (!fixed && !pid && productions && productions.length > 0) setPid(productions[0].id);
  }, [fixed, pid, productions]);

  async function add() {
    const targetPid = fixed ? productionId! : pid;
    if (!targetPid) {
      alert("작품을 선택해 주세요.");
      return;
    }
    if (!title.trim() || !url.trim()) {
      alert("제목과 링크는 필수입니다.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await setDoc(doc(db, "audio", id), {
        productionId: targetPid,
        category: cat,
        title: title.trim(),
        memo: memo.trim(),
        url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`,
        addedByName,
        createdAt: Date.now(),
      });
      setTitle("");
      setUrl("");
      setMemo("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 작품 (전역 시트에서만) */}
      {!fixed && (
        <>
          <div className="card !p-0 overflow-hidden">
            <Select
              className="!border-0 !bg-transparent !px-4 !py-3.5 !text-[15px] !ring-0"
              value={pid}
              onChange={(e) => setPid(e.target.value)}
            >
              <option value="">작품을 선택하세요</option>
              {(productions ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          {(productions ?? []).length === 0 && (
            <p className="px-1 text-xs text-amber-600">참여 중인 작품이 없습니다.</p>
          )}
        </>
      )}

      {/* 종류 + 제목 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <span className="text-[15px] font-medium text-slate-700">종류</span>
          <Select
            wrapperClassName="w-32"
            className="!border-0 !bg-surface !py-1.5 !text-[15px] !ring-0"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      </div>

      {/* 링크 + 메모 */}
      <div className="card !p-0 overflow-hidden divide-y divide-slate-100">
        <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="구글 드라이브 등 공유 링크" />
        <input className="field" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모 (선택)" />
      </div>

      <div className="flex gap-2">
        <button onClick={add} disabled={busy} className="btn-accent flex-1">
          {busy ? "추가 중…" : "자료 추가"}
        </button>
        {onCancel && <button onClick={onCancel} className="btn-ghost">취소</button>}
      </div>
    </div>
  );
}
