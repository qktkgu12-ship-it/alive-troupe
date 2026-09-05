// 푸시 알림 (Firebase Cloud Messaging) — 브라우저 쪽
//
// 흐름
//  1) 단원이 '알림 켜기'를 누름 → 브라우저 권한 요청
//  2) 허용하면 이 기기의 토큰(FCM token)을 발급받아 Firestore에 저장
//  3) 관리자가 공지·일정을 올리면 서버(/api/push)가 저장된 토큰으로 발송
//
// 토큰은 '사람'이 아니라 '기기+브라우저' 단위다. 한 단원이 폰과 PC를 쓰면 토큰이 둘이다.

import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported, type Messaging } from "firebase/messaging";
import app, { auth, db } from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";

// 이 기기의 토큰을 기억해 둔다 (알림을 끌 때 어떤 문서를 지울지 알아야 하므로)
const TOKEN_KEY = "alive-push-token";
// 이 브라우저에 한 번 심어 두는 고유값 (토큰이 갱신돼도 안 바뀐다)
const DEVICE_KEY = "alive-device-id";

/**
 * 이 브라우저를 가리키는 고정된 값.
 *
 * 토큰은 FCM이 마음대로 갱신한다. 갱신될 때마다 새 문서가 생기고 옛 문서는 남는데,
 * 옛 토큰도 한동안 살아 있어서 같은 폰에 알림이 두 번 배달된다.
 * 이 값을 문서에 같이 적어 두면 서버가 '같은 기기'임을 알아보고
 * 가장 최근 것 하나만 골라 보낸다.
 */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return ""; // 저장을 못 하면 서버가 uid+브라우저 문자열로 대신 판단한다
  }
}

/** 이 브라우저가 푸시를 지원하는가 (iOS는 홈 화면에 설치해야만 가능) */
export async function pushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  if (!VAPID_KEY) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/** 현재 알림 권한 상태 */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function messagingOrNull(): Promise<Messaging | null> {
  try {
    return getMessaging(app);
  } catch {
    return null;
  }
}

/**
 * 알림 켜기. 권한을 요청하고 토큰을 받아 Firestore에 저장한다.
 * @returns 성공 여부
 */
export async function enablePush(uid: string): Promise<boolean> {
  if (!(await pushSupported())) return false;

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;

  // 서비스 워커가 준비돼야 토큰을 받을 수 있다
  const reg = await navigator.serviceWorker.ready;
  const messaging = await messagingOrNull();
  if (!messaging) return false;

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg,
  });
  if (!token) return false;

  // 문서 ID = 토큰. 같은 기기에서 다시 켜도 문서가 하나로 유지된다.
  await setDoc(doc(db, "fcmTokens", token), {
    uid,
    deviceId: deviceId(),
    ua: navigator.userAgent.slice(0, 200),
    createdAt: serverTimestamp(),
  });

  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 무시 */
  }
  return true;
}

/** 알림 끄기. 이 기기의 토큰 문서를 지운다. (브라우저 권한 자체는 설정에서만 취소 가능) */
export async function disablePush(): Promise<void> {
  let token = "";
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    /* 무시 */
  }
  if (!token) return;
  try {
    await deleteDoc(doc(db, "fcmTokens", token));
  } catch {
    /* 이미 없으면 무시 */
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 무시 */
  }
}

/**
 * 앱을 열 때마다 조용히 토큰을 다시 확인한다.
 *
 * 이게 없으면 알림이 영영 안 온다. 두 가지 경우 때문이다.
 *  - FCM이 토큰을 갱신하면 Firestore에 적힌 옛 토큰은 죽은 값이 된다.
 *  - 안드로이드 크롬은 저장공간이 부족하면 오리진 스토리지를 통째로 회수한다.
 *    (이 앱은 Firestore 오프라인 캐시까지 IndexedDB를 써서 회수 대상이 되기 쉽다)
 * 둘 다 화면의 스위치는 '켜짐'으로 보이는데 알림만 안 오는 상태를 만들고,
 * 단원이 직접 스위치를 껐다 켜기 전에는 스스로 회복되지 않는다.
 *
 * 권한을 새로 묻지 않는다 — 이미 'granted'인 기기만 손본다.
 * 실패해도 앱 동작을 막으면 안 되므로 절대 throw하지 않는다.
 */
export async function refreshPushToken(uid: string): Promise<void> {
  try {
    // 권한을 요청하지 않는다. 이미 허용한 기기만 대상.
    if (pushPermission() !== "granted") return;
    if (!(await pushSupported())) return;

    // 서비스 워커 등록이 없으면 ready는 영영 resolve되지 않는다 → 시간 제한을 둔다
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    if (!reg) return;

    const messaging = await messagingOrNull();
    if (!messaging) return;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (!token) return;

    let stored = "";
    try {
      stored = localStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      /* 무시 */
    }

    // 그대로면 Firestore에 살아있는 문서가 있다는 뜻 — 쓸데없이 쓰지 않는다
    if (stored === token) return;

    // 토큰이 바뀌었거나(회전) 저장소가 비워졌다(회수) → 다시 등록한다
    await setDoc(doc(db, "fcmTokens", token), {
      uid,
      deviceId: deviceId(),
      ua: navigator.userAgent.slice(0, 200),
      createdAt: serverTimestamp(),
    });

    // 옛 문서는 지운다. 안 지우면 같은 폰에 알림이 두 번 간다.
    if (stored) {
      await deleteDoc(doc(db, "fcmTokens", stored)).catch(() => {});
    }

    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 무시 */
    }
  } catch {
    /* 알림은 부가 기능이므로 실패해도 넘어간다 */
  }
}

/** 이 기기에서 알림을 켜 둔 상태인가 */
export function pushEnabledHere(): boolean {
  if (typeof window === "undefined") return false;
  if (pushPermission() !== "granted") return false;
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

// 앱이 켜져 있을 때 오는 알림을 따로 받는 함수(onMessage)는 두지 않는다.
// 서비스 워커가 push 이벤트를 직접 받아 어느 상황에서든 알림을 띄우므로,
// 여기서 또 받으면 같은 알림이 두 번 뜬다.

/**
 * 관리자용 — 단원 전체에게 푸시 발송.
 * 권한 확인은 서버가 하므로, 관리자가 아니면 조용히 무시된다.
 * 보낸 사람 본인에게는 가지 않는다.
 *
 * 알림 발송이 실패해도 글·일정 등록 자체는 성공해야 하므로 절대 throw하지 않는다.
 */
export async function pushToAll(msg: {
  title: string;
  body: string;
  href?: string;
  tag?: string;
}): Promise<void> {
  await send({ ...msg, audience: "all" });
}

/**
 * 지정한 단원들에게만 발송 (최대 100명).
 * 댓글·자료 등록처럼 관련된 사람에게만 알릴 때 쓴다.
 */
export async function pushToUsers(
  uids: string[],
  msg: { title: string; body: string; href?: string; tag?: string }
): Promise<void> {
  const to = [...new Set(uids.filter(Boolean))];
  if (to.length === 0) return;
  await send({ ...msg, audience: "uids", to });
}

/**
 * 가입 신청이 들어왔음을 관리자에게 알린다.
 * 승인 대기(guest)도 호출할 수 있어야 하므로, 문구는 서버가 정한다.
 */
export async function pushSignupRequest(): Promise<void> {
  await send({ audience: "admins", title: "", body: "" });
}

/**
 * 관리자 전체에게 커스텀 문구로 알린다 (예약 신청 접수 등).
 * 정단원 이상만 문구가 반영되고, 그 외에는 서버가 가입 신청 문구로 대체한다.
 */
export async function pushToAdmins(msg: {
  title: string;
  body: string;
  href?: string;
  tag?: string;
}): Promise<void> {
  await send({ ...msg, audience: "admins" });
}

/**
 * 서비스 워커에게 푸시 준비 상태를 물어본다.
 * gstatic에서 firebase 스크립트를 못 받아오면 백그라운드 알림이 조용히 죽으므로,
 * 그 경우를 구분하기 위해 필요하다.
 */
async function swMessagingReady(): Promise<{ ready: boolean; error: string } | null> {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) return null;
    return await new Promise((resolve) => {
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 2000); // 옛 워커는 응답하지 않는다
      ch.port1.onmessage = (e) => {
        clearTimeout(timer);
        resolve({ ready: !!e.data?.ready, error: String(e.data?.error ?? "") });
      };
      reg.active!.postMessage({ type: "alive-ping" }, [ch.port2]);
    });
  } catch {
    return null;
  }
}

/**
 * 나에게 테스트 알림을 보낸다. 설정이 어디서 막혔는지 알아야 하므로
 * 다른 함수와 달리 결과·오류를 그대로 돌려준다.
 */
export async function pushTest(): Promise<{ ok: boolean; message: string }> {
  const u = auth.currentUser;
  if (!u) return { ok: false, message: "로그인이 필요해요." };

  if (!(await pushSupported())) {
    return { ok: false, message: "이 브라우저에서는 알림을 쓸 수 없어요. (VAPID 키 미등록일 수도 있어요)" };
  }
  if (pushPermission() !== "granted") {
    return { ok: false, message: "알림 권한이 없어요. 먼저 스위치를 켜 주세요." };
  }
  if (!pushEnabledHere()) {
    return { ok: false, message: "이 기기가 등록되지 않았어요. 스위치를 껐다 켜 보세요." };
  }

  try {
    const res = await fetch("/api/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await u.getIdToken()}`,
      },
      body: JSON.stringify({ audience: "self", title: "", body: "" }),
    });

    if (res.status === 503) {
      return { ok: false, message: "서버에 서비스 계정 키(FIREBASE_SERVICE_ACCOUNT)가 없어요. Vercel 환경변수를 확인해 주세요." };
    }
    if (res.status === 401) return { ok: false, message: "로그인 정보가 만료됐어요. 새로고침 후 다시 시도해 주세요." };
    if (res.status === 403) return { ok: false, message: "발송 권한이 없어요." };

    const data = (await res.json().catch(() => ({}))) as { sent?: number; detail?: string };

    if (!res.ok) {
      return {
        ok: false,
        message: data.detail
          ? `발송 실패 (${res.status})\n${data.detail}`
          : `발송에 실패했어요. (오류 ${res.status})`,
      };
    }
    if (!data.sent) {
      return {
        ok: false,
        message: data.detail
          ? `발송은 됐지만 전달에 실패했어요.\n${data.detail}`
          : "보낼 기기를 찾지 못했어요. 스위치를 껐다 켜 보세요.",
      };
    }
    // 여기까지 오면 FCM은 받아갔다. 이제 문제는 '띄우는 쪽'뿐이므로 상태를 모두 보여준다.
    const sw = await swMessagingReady();
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    const diag = [
      `발송 ${data.sent}건`,
      `워커 ${sw === null ? "무응답(구버전)" : sw.ready ? "정상" : "실패"}`,
      `설치앱 ${standalone ? "예" : "아니오"}`,
      `권한 ${Notification.permission}`,
    ].join(" · ");

    if (sw && !sw.ready) {
      return { ok: false, message: `서비스 워커가 푸시 준비에 실패했어요.\n${diag}${sw.error ? `\n${sw.error}` : ""}` };
    }
    return { ok: true, message: `보냈어요! 잠시 뒤 알림이 뜹니다.\n${diag}` };
  } catch {
    return { ok: false, message: "서버에 연결하지 못했어요." };
  }
}

/** 실제 요청. 알림 발송 실패가 본래 작업(글 등록 등)을 막으면 안 되므로 절대 throw하지 않는다. */
async function send(payload: Record<string, unknown>): Promise<void> {
  try {
    const u = auth.currentUser;
    if (!u) return;
    const idToken = await u.getIdToken();
    await fetch("/api/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* 알림은 부가 기능이므로 실패해도 넘어간다 */
  }
}
