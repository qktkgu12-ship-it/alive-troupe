// 서비스 워커를 '파일'이 아니라 '주소'로 서빙한다.
// public/sw.js 로 두면 Firebase 설정값을 소스에 직접 박아야 하는데,
// 이렇게 하면 환경변수(.env / Vercel)에 있는 값을 그대로 끌어다 쓸 수 있다.
//
// 서비스 워커는 하나만 둔다. FCM 전용 워커(firebase-messaging-sw.js)를 따로 등록하면
// 같은 범위(/)를 두고 서로 덮어써서 캐싱이나 푸시 중 하나가 죽는다.

// 서비스 워커는 항상 최신 내용이 내려가야 업데이트가 제때 반영된다
export const dynamic = "force-dynamic";

const CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// 캐시 이름에 붙는 판. 서비스 워커 내용을 바꿀 때 올리면 옛 캐시가 정리된다.
const VERSION = "v1";

function sw(): string {
  return `
// ⚠️ 이 파일은 app/sw.js/route.ts 가 생성합니다. 직접 수정하지 마세요.
const VERSION = ${JSON.stringify(VERSION)};
const SHELL = 'alive-shell-' + VERSION;
const OFFLINE_URL = '/offline';

// ---------- 푸시 알림 (Firebase Cloud Messaging) ----------
// gstatic에서 받아오므로 오프라인 설치 시 실패할 수 있다. 실패해도 캐싱은 계속 동작해야 하므로 감싼다.
try {
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  firebase.initializeApp(${JSON.stringify(CONFIG)});
  const messaging = firebase.messaging();

  // 앱이 꺼져 있거나 백그라운드일 때 도착한 알림
  messaging.onBackgroundMessage(function (payload) {
    const d = payload.data || {};
    const n = payload.notification || {};
    self.registration.showNotification(n.title || d.title || 'ALIVE', {
      body: n.body || d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 같은 tag끼리는 덮어써서, 알림이 수십 개 쌓이지 않게 한다
      tag: d.tag || 'alive',
      data: { href: d.href || '/' },
    });
  });
} catch (e) {
  // 푸시는 못 쓰지만 오프라인 캐싱은 그대로 동작
}

// 알림을 누르면 이미 열린 탭이 있으면 그쪽으로, 없으면 새로 연다
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || '/';
  e.waitUntil((async function () {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const t of tabs) {
      if ('focus' in t) {
        await t.focus();
        if ('navigate' in t) { try { await t.navigate(href); } catch (err) {} }
        return;
      }
    }
    await self.clients.openWindow(href);
  })());
});

// ---------- 설치 / 정리 ----------
self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const c = await caches.open(SHELL);
    // 오프라인 안내 화면과 로고는 미리 받아둔다 (네트워크가 끊긴 뒤엔 못 받으므로)
    try { await c.addAll([OFFLINE_URL, '/wordmark.png', '/icon-192.png']); } catch (err) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(function (k) { return k.indexOf('alive-') === 0 && k !== SHELL; })
          .map(function (k) { return caches.delete(k); })
    );
    await self.clients.claim();
  })());
});

// ---------- 요청 가로채기 ----------
async function cacheFirst(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

async function networkFirstPage(req) {
  try {
    return await fetch(req);
  } catch (err) {
    const c = await caches.open(SHELL);
    const off = await c.match(OFFLINE_URL);
    return off || Response.error();
  }
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 다른 출처(Firestore·구글 로그인·폰트 CDN)는 건드리지 않는다.
  // Firestore는 자체 IndexedDB 캐시가 있고, 인증 요청을 가로채면 로그인이 깨진다.
  if (url.origin !== self.location.origin) return;

  // 서비스 워커 자신과 API는 항상 네트워크에서
  if (url.pathname === '/sw.js' || url.pathname.indexOf('/api/') === 0) return;

  // 해시가 박힌 빌드 산출물 → 내용이 바뀌면 이름도 바뀌므로 캐시 우선이 안전하고 가장 빠르다
  if (url.pathname.indexOf('/_next/static/') === 0) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // 페이지 이동 → 항상 최신을 먼저 시도하고, 끊겼을 때만 오프라인 안내
  if (req.mode === 'navigate') {
    e.respondWith(networkFirstPage(req));
    return;
  }

  // 아이콘·이미지·폰트 → 캐시 우선
  if (/\\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
  }
});
`.trim();
}

export function GET() {
  return new Response(sw(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // 서비스 워커 자체는 캐시하지 않아야 업데이트가 바로 반영된다
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
