// 서비스 워커를 '파일'이 아니라 '주소'로 서빙한다.
// 버전(VERSION)을 코드에서 관리하고, 캐시 헤더를 직접 지정하기 위해서다.
//
// 서비스 워커는 하나만 둔다. FCM 전용 워커(firebase-messaging-sw.js)를 따로 등록하면
// 같은 범위(/)를 두고 서로 덮어써서 캐싱이나 푸시 중 하나가 죽는다.

// 서비스 워커는 항상 최신 내용이 내려가야 업데이트가 제때 반영된다
export const dynamic = "force-dynamic";

// 캐시 이름에 붙는 판. 서비스 워커 내용을 바꿀 때 올리면 옛 캐시가 정리된다.
const VERSION = "v3";

function sw(): string {
  return `
// ⚠️ 이 파일은 app/sw.js/route.ts 가 생성합니다. 직접 수정하지 마세요.
const VERSION = ${JSON.stringify(VERSION)};
const SHELL = 'alive-shell-' + VERSION;
const OFFLINE_URL = '/offline';

// ---------- 푸시 알림 ----------
// FCM도 결국 표준 Web Push로 배달된다. firebase SDK를 gstatic에서 importScripts로
// 불러오던 방식은 그 요청이 실패하면 알림이 통째로 조용히 죽는다.
// push 이벤트를 직접 처리하면 외부 의존성이 사라지고 실패 지점도 없다.
self.addEventListener('push', function (e) {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch (err) {
    // JSON이 아니면 본문만이라도 살린다
    try { p = { notification: { body: e.data.text() } }; } catch (e2) { p = {}; }
  }

  const n = p.notification || {};
  const d = p.data || {};
  const title = n.title || d.title || 'ALIVE';
  const body = n.body || d.body || '';
  const href = d.href || (p.fcmOptions && p.fcmOptions.link) || (n.click_action) || '/';

  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 같은 tag끼리는 덮어써서, 알림이 수십 개 쌓이지 않게 한다
      tag: d.tag || n.tag || 'alive',
      data: { href: href },
    })
  );
});

// 앱이 '너 푸시 준비됐니?' 하고 물어보면 답한다 (설정 진단용)
self.addEventListener('message', function (e) {
  if (!e.data || e.data.type !== 'alive-ping') return;
  const reply = { type: 'alive-pong', ready: true, error: '' };
  if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
  else if (e.source) e.source.postMessage(reply);
});

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
