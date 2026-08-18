// Firebase Admin SDK (서버 전용)
// 푸시 발송과 관리자 확인에만 쓴다. 이 파일은 절대 클라이언트에서 import하면 안 된다.
//
// 서비스 계정 키는 Vercel 환경변수 FIREBASE_SERVICE_ACCOUNT 에 JSON 통째로 넣는다.

import { cert, getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP_NAME = "alive-admin";

function init(): App | null {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null; // 키가 없으면 푸시 기능만 비활성 (앱 나머지는 정상 동작)

  try {
    const json = JSON.parse(raw) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    return initializeApp(
      {
        credential: cert({
          projectId: json.project_id,
          clientEmail: json.client_email,
          // Vercel 환경변수에 붙여넣으면 줄바꿈이 \n 두 글자로 들어오는 경우가 있다
          privateKey: json.private_key.replace(/\\n/g, "\n"),
        }),
      },
      APP_NAME
    );
  } catch {
    return null;
  }
}

export function adminApp(): App | null {
  try {
    return getApp(APP_NAME);
  } catch {
    return init();
  }
}

export function adminAuth() {
  const a = adminApp();
  return a ? getAuth(a) : null;
}

export function adminDb() {
  const a = adminApp();
  return a ? getFirestore(a) : null;
}

export function adminMessaging() {
  const a = adminApp();
  return a ? getMessaging(a) : null;
}
