// 푸시 발송 엔드포인트
//
// 클라이언트가 직접 FCM에 쏘게 하면 서버 키가 노출되므로, 반드시 서버를 거친다.
// 호출자가 누구인지 ID 토큰으로 확인한 뒤, 등급에 맞는 범위로만 보낸다.
//
// 받는 범위(audience)
//   all    — 알림 켠 단원 전체.        정단원 이상만 요청 가능
//   uids   — 지정한 단원들에게만.       정단원 이상만 요청 가능 (최대 100명)
//   admins — 관리자에게만.             누구나 가능하되 문구를 서버가 고정 (가입 신청용)
//   self   — 나에게만.                  설정이 제대로 됐는지 확인하는 테스트용

import { NextResponse } from "next/server";
import { adminAuth, adminDb, adminMessaging } from "@/lib/firebase-admin";

export const runtime = "nodejs"; // firebase-admin은 엣지 런타임에서 못 돈다
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").toLowerCase();

const BATCH = 500; // FCM은 한 번에 500개까지 받는다
const MAX_TARGETS = 100; // 지정 발송 인원 상한
const MAX_TITLE = 100;
const MAX_BODY = 300;

type Audience = "all" | "uids" | "admins" | "self";

interface Body {
  audience?: Audience;
  title?: string;
  body?: string;
  href?: string;
  tag?: string;
  /** audience가 'uids'일 때 받을 사람들 */
  to?: string[];
  /** 이 uid들에게는 보내지 않는다 (보통 보낸 사람 본인) */
  exclude?: string[];
}

/**
 * 알림 한 줄에 들어가는 '폭'. 한글은 1, 영문·숫자는 대략 0.5칸을 먹는다.
 * 글자 수로만 자르면 한글 문구는 넘치고 영문 제목은 아깝게 잘린다.
 */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힯　-〿＀-￯]/.test(ch) ? 1 : 0.5;
  return w;
}

/** 폭 기준으로 자른다 (넘치면 … 을 붙인다) */
function clipWidth(s: string, maxWidth: number): string {
  if (width(s) <= maxWidth) return s;
  let out = "";
  let w = 0;
  for (const ch of s) {
    const cw = width(ch);
    if (w + cw > maxWidth - 1) break; // … 자리 남겨 둔다
    out += ch;
    w += cw;
  }
  return out.trimEnd() + "…";
}

/**
 * 본문을 반드시 '한 줄'로 만든다.
 *
 * 아이폰은 홈 화면 앱이 보낸 알림의 제목 밑에 "from ALIVE" 한 줄을 강제로 그려 넣는다
 * (애플이 그리는 것이라 앱에서 없앨 수 없다). 그래서 본문이 두 줄이면 알림이 네 줄이 되어
 * 알림 센터가 금세 어수선해진다.
 *   제목 1줄 + from ALIVE 1줄 + 본문 1줄 = 3줄
 * 이 규칙을 여기 한 곳에서 강제한다. 나중에 알림을 추가하는 사람이 몰라도 안전하다.
 *
 * ⚠️ 길이가 변하는 내용(일정 제목 등)은 본문이 아니라 '제목'에 넣어야 한다.
 *    제목은 iOS가 알아서 한 줄로 잘라 주지만, 본문은 줄바꿈해서 늘어난다.
 */
const BODY_WIDTH = 24;
function oneLine(s: string): string {
  // 줄바꿈은 가운뎃점으로 이어 붙인다 (내용이 조용히 사라지지 않게)
  const flat = s.replace(/\s*\n+\s*/g, " · ").replace(/\s+/g, " ").trim();
  return clipWidth(flat, BODY_WIDTH);
}

function clip(s: unknown, max: number): string {
  return typeof s === "string" ? s.trim().slice(0, max) : "";
}

export async function POST(req: Request) {
  // 어느 단계에서 터졌는지 알기 위한 표식. 테스트 발송일 때만 응답에 실어 보낸다.
  const step = { at: "start", test: false };
  try {
    return await handle(req, step);
  } catch (e) {
    console.error("[push] 실패", step.at, e);
    const detail = `${step.at}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
    return NextResponse.json(
      // 진단 정보는 본인에게 보내는 테스트에서만 노출한다
      step.test ? { error: "failed", detail } : { error: "failed" },
      { status: 500 }
    );
  }
}

async function handle(req: Request, step: { at: string; test: boolean }) {
  // ---- 0. 내용 먼저 읽기 ----
  // 뒤쪽에서 읽으면, 그 전에 터진 예외는 '테스트 발송인지' 모르는 채로 잡혀서
  // 진단 정보를 붙일 수 없다. 그래서 무엇보다 먼저 읽는다.
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  const audience: Audience = payload.audience ?? "all";
  step.test = audience === "self";

  const auth = adminAuth();
  const db = adminDb();
  const messaging = adminMessaging();
  if (!auth || !db || !messaging) {
    // 서비스 계정 키가 아직 등록되지 않은 상태
    return NextResponse.json({ error: "push-not-configured" }, { status: 503 });
  }

  // ---- 1. 호출자 확인 ----
  const header = req.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let uid: string;
  let email: string;
  step.at = "verifyIdToken";
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
    email = (decoded.email ?? "").toLowerCase();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- 2. 등급 확인 ----
  step.at = "readUser";
  let role = "guest";
  const me = await db.collection("users").doc(uid).get();
  if (me.exists) role = (me.get("role") as string) ?? "guest";
  const isAdmin = (ADMIN_EMAIL !== "" && email === ADMIN_EMAIL) || role === "admin";
  const isMember = isAdmin || role === "member";

  // ---- 3. 내용 확인 ----
  let title = clip(payload.title, MAX_TITLE);
  let body = clip(payload.body, MAX_BODY);
  let href = clip(payload.href, 300) || "/";
  const tag = clip(payload.tag, 40) || "alive";

  // 관리자에게 보내는 알림:
  //  - 정단원 이상이 보낼 땐 커스텀 문구를 허용 (예약 신청 알림 등)
  //  - 그 외(guest의 가입 신청)는 서버가 문구를 고정해 임의 내용 주입을 막는다
  if (audience === "admins") {
    if (!isMember || !title) {
      title = "새 가입 신청";
      body = "승인을 기다리는 단원이 있어요.";
      href = "/admin";
    }
  } else if (audience === "self") {
    title = "테스트 알림";
    body = "알림이 정상적으로 도착했어요. 🎉";
    href = "/";
  } else if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!title) return NextResponse.json({ error: "title-required" }, { status: 400 });

  // 제목은 한 줄, 본문도 한 줄 — "from ALIVE"까지 합쳐 알림을 3줄로 묶는다.
  // 제목은 iOS가 알아서 자르지만, 알림 센터 밖(잠금화면 등)에서도 같게 보이도록 여기서도 자른다.
  title = clipWidth(title, 26);
  body = oneLine(body);

  // ---- 3-1. 알림 일시 중지 ----
  // 관리자가 settings/site 의 pushPaused 를 켜 두면 남에게 가는 알림을 전부 막는다.
  // 시험 삼아 글·일정을 등록해도 단원들 폰이 울리지 않는다.
  // 본인에게 보내는 테스트(self)는 설정 확인용이라 그대로 통과시킨다.
  if (audience !== "self") {
    step.at = "readSettings";
    try {
      const s = await db.collection("settings").doc("site").get();
      if (s.exists && s.get("pushPaused") === true) {
        return NextResponse.json({ ok: true, skipped: "push-paused", sent: 0 });
      }
    } catch {
      /* 설정을 못 읽으면 평소대로 보낸다 (알림이 조용히 죽는 편보다 낫다) */
    }
  }

  // ---- 4. 받을 사람 정하기 ----
  const exclude = new Set(payload.exclude ?? []);
  // 테스트는 나에게 보내는 것이 목적이므로 본인 제외를 적용하지 않는다
  if (audience !== "self") exclude.add(uid);

  let allowUids: Set<string>;

  if (audience === "self") {
    allowUids = new Set([uid]);
  } else if (audience === "uids") {
    const to = (payload.to ?? []).filter((t) => typeof t === "string" && t);
    if (to.length === 0) return NextResponse.json({ sent: 0 });
    if (to.length > MAX_TARGETS) return NextResponse.json({ error: "too-many-targets" }, { status: 400 });
    allowUids = new Set(to);
  } else if (audience === "admins") {
    const admins = await db.collection("users").where("role", "==", "admin").get();
    allowUids = new Set(admins.docs.map((d) => d.id));
  } else {
    // 'all' = 승인된 단원 전체.
    // 승인 대기(guest)도 '승인됐어요' 알림을 받으려고 토큰을 등록해 두므로,
    // 전체 발송에 그대로 태우면 공지 내용이 미승인자에게 새어 나간다. 반드시 걸러낸다.
    const users = await db.collection("users").get();
    allowUids = new Set(
      users.docs.filter((d) => ["member", "admin"].includes((d.get("role") as string) ?? "")).map((d) => d.id)
    );
  }
  if (allowUids.size === 0) return NextResponse.json({ sent: 0 });

  // ---- 5. 토큰 모으기 ----
  step.at = "readTokens";
  const tokenSnap = await db.collection("fcmTokens").get();

  // 기기 하나에 토큰이 여럿 남아 있으면 같은 알림이 그 기기에 여러 번 배달된다.
  //
  // 토큰은 '기기+브라우저' 단위인데, 알림을 껐다 켜거나 FCM이 토큰을 갱신하면
  // 새 문서가 생기고 옛 문서는 그대로 남는다. 옛 토큰도 한동안은 살아 있어서
  // 같은 폰에 두 번 도착한다 — 실제로 불참 알림이 두 개씩 뜨는 걸로 나타났다.
  //
  // 그래서 기기 하나당 가장 최근 토큰 하나만 남긴다.
  //   · deviceId가 있으면 그걸로 (앱이 브라우저마다 심어 두는 고유값 — 정확하다)
  //   · 없는 옛 문서는 uid+브라우저 문자열로 (같은 폰의 같은 브라우저면 같은 값)
  const newest = new Map<string, { id: string; at: number }>();
  tokenSnap.forEach((d) => {
    const owner = d.get("uid") as string;
    if (exclude.has(owner)) return;
    if (!allowUids.has(owner)) return;
    const deviceId = (d.get("deviceId") as string) ?? "";
    const key = deviceId ? `d:${deviceId}` : `u:${owner}|${(d.get("ua") as string) ?? ""}`;
    // createdAt은 서버 타임스탬프. 옛 문서엔 없을 수도 있어 0으로 본다.
    const ts = d.get("createdAt") as { toMillis?: () => number } | number | undefined;
    const at =
      typeof ts === "number" ? ts : typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
    const prev = newest.get(key);
    if (!prev || at > prev.at) newest.set(key, { id: d.id, at });
  });
  const tokens = [...newest.values()].map((v) => v.id);
  if (tokens.length === 0) return NextResponse.json({ sent: 0 });

  // ---- 6. 발송 ----
  // notification 대신 data만 보낸다. 그래야 서비스 워커의 onBackgroundMessage가
  // 항상 호출돼서 아이콘·클릭 이동을 우리가 통제할 수 있다.
  let sent = 0;
  const dead: string[] = [];
  // FCM은 개별 실패를 예외가 아니라 결과에 담아 돌려준다. 원인을 알려면 따로 챙겨야 한다.
  let firstError = "";

  step.at = "send";
  for (let i = 0; i < tokens.length; i += BATCH) {
    const part = tokens.slice(i, i + BATCH);
    const res = await messaging.sendEachForMulticast({
      tokens: part,
      data: { title, body, href, tag },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        // notification 블록을 함께 실어야 우리 서비스 워커의 핸들러가 어떤 이유로
        // 살아 있지 않아도 FCM SDK가 알림을 대신 띄워 준다.
        // (data만 보내면 핸들러가 죽은 순간 알림이 조용히 사라진다. iOS는 특히
        //  보이지 않는 푸시를 허용하지 않는다.)
        notification: {
          title,
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag,
        },
        fcmOptions: { link: href },
      },
    });
    sent += res.successCount;
    res.responses.forEach((r, idx) => {
      const code = r.error?.code ?? "";
      if (r.error && !firstError) firstError = `${code} ${r.error.message}`.slice(0, 200);
      // 기기를 바꿨거나 앱을 지운 경우 → 죽은 토큰이므로 정리
      if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
        dead.push(part[idx]);
      }
    });
  }

  // ---- 7. 죽은 토큰 청소 ----
  // 놔두면 발송할 때마다 계속 실패하며 쌓인다
  if (dead.length > 0) {
    const batch = db.batch();
    dead.slice(0, 500).forEach((t) => batch.delete(db.collection("fcmTokens").doc(t)));
    await batch.commit().catch(() => {});
  }

  if (sent === 0 && firstError) {
    console.error("[push] 모두 실패", firstError);
    return NextResponse.json(step.test ? { sent: 0, detail: firstError } : { sent: 0 });
  }
  return NextResponse.json({ sent });
}
