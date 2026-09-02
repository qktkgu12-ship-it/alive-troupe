// 일정 리마인더 — 하루 한 번 돌면서 '내일 있는 일정'을 참여자에게 알린다.
//
// 연습을 빼먹는 걸 막는 게 목적이라, 알림은 전날 저녁 한 번만 보낸다.
// (당일 아침에도 보내려면 vercel.json의 schedule을 하나 더 추가하면 된다)
//
// 호출자는 Vercel Cron 뿐이다. 아무나 때려서 단원들 폰을 울리게 할 수 없도록
// CRON_SECRET으로 막는다. 사용자 ID 토큰을 쓰지 않으므로 /api/push를 거치지 않고
// firebase-admin으로 직접 발송한다.

import { NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 500;

// 한국 시간 기준 날짜 문자열 (서버가 UTC로 돌기 때문에 직접 맞춰 준다)
function seoulDateStr(offsetDays = 0): string {
  const now = new Date();
  const seoul = new Date(now.getTime() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return seoul.toISOString().slice(0, 10);
}

function ampm(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!m) return time ?? "";
  const h = Number(m[1]);
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${m[2]}`;
}

export async function GET(req: Request) {
  // ---- 1. 호출자 확인 ----
  const secret = process.env.CRON_SECRET ?? "";
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = adminDb();
  const messaging = adminMessaging();
  if (!db || !messaging) {
    return NextResponse.json({ error: "push-not-configured" }, { status: 503 });
  }

  // ---- 2. 알림 일시 중지 확인 ----
  try {
    const s = await db.collection("settings").doc("site").get();
    if (s.exists && s.get("pushPaused") === true) {
      return NextResponse.json({ ok: true, skipped: "push-paused" });
    }
  } catch {
    /* 설정을 못 읽으면 평소대로 보낸다 */
  }

  // ---- 3. 내일 일정 찾기 ----
  const tomorrow = seoulDateStr(1);
  const snap = await db.collection("events").where("date", "==", tomorrow).get();
  const events: { id: string; data: Record<string, unknown> }[] = snap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    // 숨긴 일정은 단원에게 안 보이므로 리마인더도 보내지 않는다
    .filter((e) => e.data.hidden !== true);

  if (events.length === 0) {
    return NextResponse.json({ ok: true, date: tomorrow, events: 0, sent: 0 });
  }

  // ---- 4. 받을 사람 후보 (승인된 단원만) ----
  const users = await db.collection("users").get();
  const memberUids = new Set(
    users.docs
      .filter((d) => ["member", "admin"].includes((d.get("role") as string) ?? ""))
      .map((d) => d.id)
  );

  // uid → 토큰들
  const tokenSnap = await db.collection("fcmTokens").get();
  const tokensByUid = new Map<string, string[]>();
  tokenSnap.forEach((d) => {
    const owner = d.get("uid") as string;
    if (!owner || !memberUids.has(owner)) return;
    const list = tokensByUid.get(owner) ?? [];
    list.push(d.id);
    tokensByUid.set(owner, list);
  });

  let sentTotal = 0;
  const dead: string[] = [];

  for (const e of events) {
    const f = e.data;
    const title = (f.title as string) ?? "일정";
    const startTime = (f.startTime as string) ?? "";
    const endTime = (f.endTime as string) ?? "";
    const location = (f.location as string) ?? "";
    const team = (f.team as string) ?? "";
    const participantUids = (f.participantUids as string[] | undefined) ?? [];

    // 대상: 개별 지정이 있으면 그 명단, 팀 지정이면 그 팀, 아니면 전체
    let targets: string[];
    if (participantUids.length > 0) {
      targets = participantUids.filter((u) => memberUids.has(u));
    } else if (team) {
      targets = users.docs
        .filter(
          (d) =>
            memberUids.has(d.id) &&
            ((d.get("team") as string) ?? "") === team
        )
        .map((d) => d.id);
    } else {
      targets = [...memberUids];
    }

    // 불참을 이미 알린 사람에게는 보내지 않는다
    const absSnap = await db.collection("events").doc(e.id).collection("absences").get();
    const absent = new Set(absSnap.docs.map((d) => d.id));

    const tokens: string[] = [];
    for (const u of targets) {
      if (absent.has(u)) continue;
      for (const t of tokensByUid.get(u) ?? []) tokens.push(t);
    }
    if (tokens.length === 0) continue;

    const when = startTime
      ? `내일 ${ampm(startTime)}${endTime ? ` ~ ${ampm(endTime)}` : ""}`
      : "내일";
    const body = [when, location].filter(Boolean).join(" · ");

    for (let i = 0; i < tokens.length; i += BATCH) {
      const part = tokens.slice(i, i + BATCH);
      const res = await messaging.sendEachForMulticast({
        tokens: part,
        data: {
          title: `내일 일정: ${title}`,
          body,
          href: `/schedule?tab=events&date=${tomorrow}`,
          tag: `reminder-${e.id}`,
        },
        webpush: {
          headers: { Urgency: "high", TTL: "86400" },
          notification: {
            title: `내일 일정: ${title}`,
            body,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            tag: `reminder-${e.id}`,
          },
          fcmOptions: { link: `/schedule?tab=events&date=${tomorrow}` },
        },
      });
      sentTotal += res.successCount;
      res.responses.forEach((r, idx) => {
        const code = r.error?.code ?? "";
        if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
          dead.push(part[idx]);
        }
      });
    }
  }

  // ---- 5. 죽은 토큰 청소 ----
  if (dead.length > 0) {
    const batch = db.batch();
    dead.slice(0, 500).forEach((t) => batch.delete(db.collection("fcmTokens").doc(t)));
    await batch.commit().catch(() => {});
  }

  return NextResponse.json({ ok: true, date: tomorrow, events: events.length, sent: sentTotal });
}
