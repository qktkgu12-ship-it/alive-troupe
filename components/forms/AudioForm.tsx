"use client";

// 자료실 등록 폼 (자료실 페이지 + 전역 바텀시트 공용)
// 페이지에서는 이미 고른 작품에 추가하고, 바텀시트에서는 작품을 직접 고름.

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { pushToUsers } from "@/lib/push";
import Select from "@/components/Select";
import type { AudioTrack, Production } from "@/lib/types";

export default function AudioForm({
  productionId,
  productions,
  categories,
  defaultCat,
  addedByName,
  onAdded,
  onCancel,
  submitRef,
  edit,
}: {
  productionId?: string;
  productions?: Production[];
  categories: string[];
  defaultCat: string;
  addedByName: string;
  onAdded: () => void;
  onCancel?: () => void;
  submitRef?: React.MutableRefObject<(() => void) | null>;
  edit?: AudioTrack;
}) {
  const { user } = useAuth();
  const fixed = !!productionId;
  const [pid, setPid] = useState(edit?.productionId ?? productionId ?? productions?.[0]?.id ?? "");
  const [cat, setCat] = useState(edit?.category ?? defaultCat);
  const [title, setTitle] = useState(edit?.title ?? edit?.song ?? "");
  const [url, setUrl] = useState(edit?.url ?? "");
  const [memo, setMemo] = useState(edit?.memo ?? edit?.label ?? "");
  const [busy, setBusy] = useState(false);

  // 헤더 ✓ 버튼 등록
  if (submitRef) submitRef.current = () => { void add(); };

  useEffect(() => {
    if (!edit) setCat(defaultCat);
  }, [defaultCat, edit]);

  // 작품 목록이 늦게 로드되면 첫 작품을 기본 선택
  useEffect(() => {
    if (!fixed && !pid && productions && productions.length > 0) setPid(productions[0].id);
  }, [fixed, pid, productions]);

  // 그 작품에 참여하는 단원에게만 알린다 (자료를 볼 수 있는 사람들).
  // productions prop이 없을 때도 있어서 작품 문서를 직접 읽는다.
  async function notifyParticipants(targetPid: string, trackTitle: string) {
    try {
      const known = productions?.find((p) => p.id === targetPid);
      let people = known?.participants ?? [];
      if (people.length === 0) {
        const snap = await getDoc(doc(db, "productions", targetPid));
        people = (snap.data() as Production | undefined)?.participants ?? [];
      }
      if (people.length === 0) return;
      await pushToUsers(people, {
        title: "새 자료가 올라왔어요",
        body: trackTitle,
        href: "/audio",
        tag: "audio",
      });
    } catch {
      /* 알림 실패가 등록을 막지 않도록 */
    }
  }

  async function add() {
    const targetPid = fixed ? productionId! : pid;
    if (!targetPid) { alert("작품을 선택해 주세요."); return; }
    if (!title.trim() || !url.trim()) { alert("제목과 링크는 필수입니다."); return; }
    setBusy(true);
    try {
      const cleanUrl = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
      if (edit) {
        await setDoc(doc(db, "audio", edit.id), {
          category: cat, title: title.trim(), memo: memo.trim(), url: cleanUrl,
        }, { merge: true });
      } else {
        await setDoc(doc(db, "audio", crypto.randomUUID()), {
          productionId: targetPid, category: cat,
          title: title.trim(), memo: memo.trim(), url: cleanUrl,
          // createdBy가 있어야 올린 본인이 나중에 고치고 지울 수 있다
          addedByName, createdBy: user?.uid ?? "", createdAt: Date.now(),
        });
        notifyParticipants(targetPid, title.trim());
        setTitle(""); setUrl(""); setMemo("");
      }
      onAdded();
    } catch (e) {
      // 여태 실패해도 아무 표시가 없어서, 권한 때문에 막힌 걸 아무도 몰랐다
      const msg = e instanceof Error ? e.message : String(e);
      alert(
        msg.includes("permission") || msg.includes("insufficient")
          ? "등록 권한이 없어요. 이 작품의 참여 명단에 있는지 확인해 주세요."
          : "등록에 실패했어요. 잠시 뒤 다시 시도해 주세요."
      );
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

    </div>
  );
}
