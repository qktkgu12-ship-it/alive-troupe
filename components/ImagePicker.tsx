"use client";

import { useRef, useState } from "react";

// 사진을 작게 압축해 data URL로 변환 (Storage 없이 Firestore에 바로 저장하기 위함)
export async function compressImage(file: File, maxDim = 1024, quality = 0.6): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export default function ImagePicker({
  images,
  onChange,
  max = 4,
}: {
  images: string[];
  onChange: (imgs: string[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const arr = Array.from(files).slice(0, max - images.length);
      const compressed = await Promise.all(arr.map((f) => compressImage(f)));
      onChange([...images, ...compressed]);
    } catch {
      alert("이미지를 불러오지 못했어요. 다른 사진으로 시도해 주세요.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
            <button
              type="button"
              onClick={() => onChange(images.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white"
              aria-label="삭제"
            >
              ×
            </button>
          </div>
        ))}
        {images.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="grid h-20 w-20 place-items-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-400 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? "처리 중…" : "＋ 사진"}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <p className="mt-1.5 text-xs text-slate-400">최대 {max}장 · 사진은 자동으로 압축되어 저장돼요</p>
    </div>
  );
}
