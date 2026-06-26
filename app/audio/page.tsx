"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { safeExternalUrl } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";
import {
  AUDIO_KIND_LABEL,
  type AudioKind,
  type AudioTrack,
  type Production,
} from "@/lib/types";

// 구글 드라이브 공유 링크를 '바로 다운로드' 링크로 변환 (가능할 때만)
// 항상 http(s)만 반환 (javascript: 등 위험 링크 차단)
function toDownloadUrl(url: string): string {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return safeExternalUrl(url) || "#";
}

function AudioInner() {
  const { user, profile, role } = useAuth();
  const isAdmin = role === "admin";

  const [productions, setProductions] = useState<Production[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [view, setView] = useState<ViewMode>("card");

  const loadProductions = useCallback(async () => {
    // 관리자는 전체 / 정단원은 자신이 참여한 작품만
    const q = isAdmin
      ? query(collection(db, "productions"), orderBy("order", "asc"))
      : query(collection(db, "productions"), where("participants", "array-contains", user?.uid ?? "__none__"));
    const snap = await getDocs(q);
    const list = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) }))
      .sort((a, b) => a.order - b.order);
    setProductions(list);
    setActiveId((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
  }, [isAdmin, user?.uid]);

  const loadTracks = useCallback(async (pid: string) => {
    setLoadingTracks(true);
    try {
      const snap = await getDocs(query(collection(db, "audio"), where("productionId", "==", pid)));
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<AudioTrack, "id">) }))
        .sort((a, b) => a.song.localeCompare(b.song) || a.kind.localeCompare(b.kind));
      setTracks(list);
    } finally {
      setLoadingTracks(false);
    }
  }, []);

  useEffect(() => {
    loadProductions();
  }, [loadProductions]);

  useEffect(() => {
    if (activeId) loadTracks(activeId);
    else setTracks([]);
  }, [activeId, loadTracks]);

  const active = productions.find((p) => p.id === activeId) ?? null;

  // 곡명으로 그룹화
  const grouped = useMemo(() => {
    const map: Record<string, AudioTrack[]> = {};
    for (const t of tracks) (map[t.song] ??= []).push(t);
    return Object.entries(map);
  }, [tracks]);

  async function removeTrack(t: AudioTrack) {
    if (!confirm("이 음원 링크를 삭제할까요?")) return;
    await deleteDoc(doc(db, "audio", t.id));
    if (activeId) loadTracks(activeId);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">음원 자료실</h1>
      </div>

      <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
        💡 음원은 구글 드라이브 등에 올린 뒤 <b>공유 링크</b>를 등록하는 방식입니다.
        드라이브 파일은 <b>‘링크가 있는 모든 사용자 — 뷰어’</b>로 공유해 두세요.
      </div>

      {/* 작품(폴더) 탭 — 참여 중인 작품만 표시 */}
      {productions.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">
          {isAdmin
            ? "작품이 없습니다. 관리자 페이지 > 작품 관리에서 추가하세요."
            : "참여 중인 작품이 없습니다. (관리자가 작품 참여명단에 추가하면 보여요)"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {productions.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeId === p.id ? "bg-accent text-accent-fg" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-700">{active.name}</h2>
            {active.gisu && <span className="chip">{active.gisu}</span>}
          </div>

          {/* 음원 링크 추가 (관리자만) */}
          {isAdmin && (
            <AddTrackForm
              productionId={active.id}
              addedByName={profile?.name || profile?.displayName || ""}
              onAdded={() => loadTracks(active.id)}
            />
          )}

          {/* 곡별 음원 목록 */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500">총 {tracks.length}개 음원</span>
            <ViewToggle value={view} onChange={setView} />
          </div>

          {loadingTracks ? (
            <p className="py-8 text-center text-slate-400">불러오는 중…</p>
          ) : tracks.length === 0 ? (
            <p className="card py-8 text-center text-slate-400">등록된 음원이 없습니다.</p>
          ) : view === "card" ? (
            /* ===== 카드 보기 (곡별 묶음) ===== */
            <div className="space-y-3">
              {grouped.map(([song, list]) => (
                <div key={song} className="card !p-4">
                  <h3 className="mb-2 font-semibold">🎵 {song}</h3>
                  <div className="space-y-2">
                    {list.map((t) => (
                      <TrackRow key={t.id} track={t} canDelete={isAdmin} onDeleted={() => loadTracks(active.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ===== 리스트 보기 (전체 한 줄씩) ===== */
            <div className="card divide-y divide-slate-100 !p-0">
              {tracks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                  <span className="chip shrink-0">{AUDIO_KIND_LABEL[t.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t.song}
                      {t.label ? ` · ${t.label}` : ""}
                    </p>
                    <p className="text-xs text-slate-400">{t.addedByName}</p>
                  </div>
                  <a
                    href={toDownloadUrl(t.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost !px-3 !py-1.5 shrink-0"
                  >
                    다운로드 ↗
                  </a>
                  {isAdmin && (
                    <button onClick={() => removeTrack(t)} className="shrink-0 text-xs text-red-500 hover:underline">
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrackRow({
  track,
  canDelete,
  onDeleted,
}: {
  track: AudioTrack;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  async function remove() {
    if (!confirm("이 음원 링크를 삭제할까요?")) return;
    await deleteDoc(doc(db, "audio", track.id));
    onDeleted();
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <span className="chip shrink-0">{AUDIO_KIND_LABEL[track.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.label || track.song}</p>
        <p className="text-xs text-slate-400">{track.addedByName}</p>
      </div>
      <a
        href={toDownloadUrl(track.url)}
        target="_blank"
        rel="noreferrer"
        className="btn-ghost !px-3 !py-1.5 shrink-0"
      >
        다운로드 ↗
      </a>
      {canDelete && (
        <button onClick={remove} className="text-xs text-red-500 hover:underline shrink-0">삭제</button>
      )}
    </div>
  );
}

function AddTrackForm({
  productionId,
  addedByName,
  onAdded,
}: {
  productionId: string;
  addedByName: string;
  onAdded: () => void;
}) {
  const [song, setSong] = useState("");
  const [kind, setKind] = useState<AudioKind>("mr");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!song || !url) {
      alert("곡명과 링크는 필수입니다.");
      return;
    }
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const track: Omit<AudioTrack, "id"> = {
        productionId,
        song,
        kind,
        label,
        url: url.startsWith("http") ? url : `https://${url}`,
        addedByName,
        createdAt: Date.now(),
      };
      await setDoc(doc(db, "audio", id), track);
      setSong("");
      setLabel("");
      setUrl("");
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 border-dashed">
      <p className="text-sm font-semibold text-slate-600">음원 링크 추가</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <input className="input" value={song} onChange={(e) => setSong(e.target.value)} placeholder="곡명 (예: I Am the One)" />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as AudioKind)}>
          <option value="mr">MR</option>
          <option value="guide">가이드</option>
          <option value="etc">기타</option>
        </select>
      </div>
      <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="표시 이름 (선택) — 예: MR 풀버전 / 2키 다운" />
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="구글 드라이브 공유 링크 (https://drive.google.com/...)" />
      <button onClick={add} disabled={busy} className="btn-accent w-full">
        {busy ? "추가 중…" : "음원 추가"}
      </button>
    </div>
  );
}

export default function AudioPage() {
  return (
    <Guard>
      <AudioInner />
    </Guard>
  );
}
