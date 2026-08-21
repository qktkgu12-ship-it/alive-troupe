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

  // 관리자에게 보내는 알림.
  //  - 정단원 이상이 보낼 땐 커스텀 문구를 허용한다(예약 신청 접수 알림 등).
  //  - 그 외(승인 대기 guest 의 가입 신청)는 서버가 문구를 고정해,
  //    아무 내용이나 관리자에게 밀어 넣지 못하게 한다.
  if (audience === "admins") {
    if (!isMember || !title) {
      title = "새 가입 신청";
      body = "승인을 기다리는 단원이 있어요.";
      href = "/admin";
    }
  } else if (audience === "self") {
    title = "테스트 알림";
    body = "이 알림이 보이면 설정이 잘 된 거예요 🎉";
    href = "/";
  } else if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!title) return NextResponse.json({ error: "title-required" }, { status: 400 });

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
  const tokens: string[] = [];
  tokenSnap.forEach((d) => {
    const owner = d.get("uid") as string;
    if (exclude.has(owner)) return;
    if (!allowUids.has(owner)) return;
    tokens.push(d.id);
  });
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
