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
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Guard from "@/components/Guard";
import {
  AUDIO_KIND_LABEL,
  type AudioKind,
  type AudioTrack,
  type Production,
} from "@/lib/types";
import { formatBytes } from "@/lib/utils";

function AudioInner() {
  const { profile, role } = useAuth();
  const isAdmin = role === "admin";

  const [productions, setProductions] = useState<Production[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);

  const loadProductions = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "productions"), orderBy("order", "asc")));
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Production, "id">) }));
    setProductions(list);
    setActiveId((cur) => cur ?? list[0]?.id ?? null);
  }, []);

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

  async function addProduction() {
    const name = prompt("새 작품(공연) 이름을 입력하세요\n예: 2026 정기공연 - 넥스트 투 노멀");
    if (!name) return;
    const id = crypto.randomUUID();
    await setDoc(doc(db, "productions", id), {
      name,
      order: productions.length,
      createdAt: Date.now(),
    });
    await loadProductions();
    setActiveId(id);
  }

  async function removeProduction(p: Production) {
    if (!confirm(`'${p.name}' 폴더와 안의 모든 음원을 삭제할까요?`)) return;
    // 안의 음원 파일/문서 모두 삭제
    const snap = await getDocs(query(collection(db, "audio"), where("productionId", "==", p.id)));
    await Promise.all(
      snap.docs.map(async (d) => {
        const t = d.data() as AudioTrack;
        try {
          await deleteObject(ref(storage, t.storagePath));
        } catch {
          /* 파일이 이미 없을 수 있음 */
        }
        await deleteDoc(d.ref);
      })
    );
    await deleteDoc(doc(db, "productions", p.id));
    setActiveId(null);
    await loadProductions();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">음원 자료실</h1>
        {isAdmin && (
          <button onClick={addProduction} className="btn-accent">+ 작품 폴더</button>
        )}
      </div>

      {/* 작품(폴더) 탭 */}
      {productions.length === 0 ? (
        <p className="card py-12 text-center text-slate-400">
          아직 작품 폴더가 없습니다.{isAdmin ? " 위 버튼으로 추가하세요." : ""}
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
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700">{active.name}</h2>
            {isAdmin && (
              <button onClick={() => removeProduction(active)} className="btn-danger">폴더 삭제</button>
            )}
          </div>

          {/* 업로드 (관리자 + 정단원) */}
          <UploadForm
            productionId={active.id}
            uploaderName={profile?.name || profile?.displayName || ""}
            onUploaded={() => loadTracks(active.id)}
          />

          {/* 곡별 음원 목록 */}
          {loadingTracks ? (
            <p className="py-8 text-center text-slate-400">불러오는 중…</p>
          ) : grouped.length === 0 ? (
            <p className="card py-8 text-center text-slate-400">등록된 음원이 없습니다.</p>
          ) : (
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
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(track.fileUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = track.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(track.fileUrl, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  async function remove() {
    if (!confirm("이 음원을 삭제할까요?")) return;
    try {
      await deleteObject(ref(storage, track.storagePath));
    } catch {
      /* 무시 */
    }
    await deleteDoc(doc(db, "audio", track.id));
    onDeleted();
  }

  return (
    <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <span className="chip shrink-0">{AUDIO_KIND_LABEL[track.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.fileName}</p>
        <p className="text-xs text-slate-400">{formatBytes(track.size)} · {track.uploadedByName}</p>
      </div>
      <button onClick={download} disabled={downloading} className="btn-ghost !px-3 !py-1.5 shrink-0">
        {downloading ? "받는 중…" : "다운로드"}
      </button>
      {canDelete && (
        <button onClick={remove} className="text-xs text-red-500 hover:underline shrink-0">삭제</button>
      )}
    </div>
  );
}

function UploadForm({
  productionId,
  uploaderName,
  onUploaded,
}: {
  productionId: string;
  uploaderName: string;
  onUploaded: () => void;
}) {
  const [song, setSong] = useState("");
  const [kind, setKind] = useState<AudioKind>("mr");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  function upload() {
    if (!song || !file) {
      alert("곡명과 파일을 선택하세요.");
      return;
    }
    const id = crypto.randomUUID();
    const storagePath = `audio/${productionId}/${id}_${file.name}`;
    const task = uploadBytesResumable(ref(storage, storagePath), file);
    setProgress(0);
    task.on(
      "state_changed",
      (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => {
        console.error(err);
        alert("업로드에 실패했어요. 다시 시도해 주세요.");
        setProgress(null);
      },
      async () => {
        const fileUrl = await getDownloadURL(task.snapshot.ref);
        const track: Omit<AudioTrack, "id"> = {
          productionId,
          song,
          kind,
          fileName: file.name,
          fileUrl,
          storagePath,
          size: file.size,
          uploadedByName: uploaderName,
          createdAt: Date.now(),
        };
        await setDoc(doc(db, "audio", id), track);
        setSong("");
        setFile(null);
        setProgress(null);
        onUploaded();
      }
    );
  }

  return (
    <div className="card space-y-3 border-dashed">
      <p className="text-sm font-semibold text-slate-600">음원 업로드</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input className="input" value={song} onChange={(e) => setSong(e.target.value)} placeholder="곡명 (예: I Am the One)" />
        <select className="input sm:w-32" value={kind} onChange={(e) => setKind(e.target.value as AudioKind)}>
          <option value="mr">MR</option>
          <option value="guide">가이드</option>
          <option value="etc">기타</option>
        </select>
      </div>
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-sm file:font-semibold file:text-accent"
      />
      {progress !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      <button onClick={upload} disabled={progress !== null} className="btn-accent w-full">
        {progress !== null ? `업로드 중… ${progress}%` : "업로드"}
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
