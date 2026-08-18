// 푸시 알림 (Firebase Cloud Messaging) — 브라우저 쪽
//
// 흐름
//  1) 단원이 '알림 켜기'를 누름 → 브라우저 권한 요청
//  2) 허용하면 이 기기의 토큰(FCM token)을 발급받아 Firestore에 저장
//  3) 관리자가 공지·일정을 올리면 서버(/api/push)가 저장된 토큰으로 발송
//
// 토큰은 '사람'이 아니라 '기기+브라우저' 단위다. 한 단원이 폰과 PC를 쓰면 토큰이 둘이다.

import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import app, { auth, db } from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";

// 이 기기의 토큰을 기억해 둔다 (알림을 끌 때 어떤 문서를 지울지 알아야 하므로)
const TOKEN_KEY = "alive-push-token";

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

/**
 * 앱을 보고 있는 동안 도착한 알림을 처리한다.
 * (백그라운드는 서비스 워커가 맡고, 이건 화면이 켜져 있을 때만)
 */
export async function onForegroundPush(cb: (n: { title: string; body: string; href: string }) => void) {
  const messaging = await messagingOrNull();
  if (!messaging) return () => {};
  try {
    return onMessage(messaging, (payload) => {
      const d = payload.data ?? {};
      const n = payload.notification ?? {};
      cb({
        title: n.title ?? d.title ?? "ALIVE",
        body: n.body ?? d.body ?? "",
        href: d.href ?? "/",
      });
    });
  } catch {
    return () => {};
  }
}

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
