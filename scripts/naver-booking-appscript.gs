// =====================================================================
// 네이버 예약 메일 → Firestore 자동 연동 (Apps Script)
//   모든 네이버 예약 → externalBookings/naver_{예약번호}
//   (확정 일정에는 안 뜨고, 달력·일정방에서 '외부 손님 예약'으로 시간만 차단)
//
// ※ 소속 회원 예약은 더 이상 처리하지 않는다.
//   단원 예약은 홈페이지의 '예약 신청' 기능으로만 받는다.
//   예전에 events 컬렉션에 들어간 naver_ 문서는 purgeNaverEvents()로 한 번 정리.
// =====================================================================

const FIRESTORE_PROJECT = "alive-559ec";
const SENDER            = "naverbooking_noreply@navercorp.com";
const FALLBACK_DAYS     = 60;
const MAX_TITLE_LEN     = 60;

const COL_EVENTS   = "events";           // 정리(삭제)용으로만 참조
const COL_EXTERNAL = "externalBookings";

// 스크립트가 관리하는 필드
const EXTERNAL_FIELDS = ["date","startTime","endTime","product","createdAt"];

// ── Firestore REST ───────────────────────────────────────────────────
function firestoreUrl(path) {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`;
}
function authHeader() {
  return { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
}

// 공통 PATCH — collection·필드 목록만 다르게 받음
function patchDoc(collection, docId, fields, fieldList) {
  const mask = fieldList.map(f => "updateMask.fieldPaths=" + f).join("&");
  const res  = UrlFetchApp.fetch(firestoreUrl(`${collection}/${docId}`) + "?" + mask, {
    method: "PATCH",
    contentType: "application/json",
    headers: authHeader(),
    muteHttpExceptions: true,
    payload: JSON.stringify({ fields: fields }),
  });
  if (res.getResponseCode() >= 300) {
    console.error("❌ 저장 실패", collection, docId, res.getContentText());
    return false;
  }
  return true;
}

// 외부 손님 예약 → 날짜·시간만 보관 (확정 일정에는 등록하지 않음)
function saveExternal(docId, b) {
  return patchDoc(COL_EXTERNAL, docId, {
    date:      { stringValue: b.date },
    startTime: { stringValue: b.startTime },
    endTime:   { stringValue: b.endTime },
    product:   { stringValue: b.product || "" },
    createdAt: { integerValue: String(b.createdAt) },
  }, EXTERNAL_FIELDS);
}

function deleteFromFirestore(collection, docId) {
  const res = UrlFetchApp.fetch(firestoreUrl(`${collection}/${docId}`), {
    method: "DELETE", headers: authHeader(), muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300 && code !== 404) {
    console.error("❌ 삭제 실패", collection, docId, res.getContentText());
    return false;
  }
  return true;
}

// 취소 시 — 예전 버전이 events에 넣어둔 문서까지 함께 지운다.
// DELETE는 404를 성공으로 처리하므로 없으면 그냥 통과.
function deleteFromBoth(docId) {
  const a = deleteFromFirestore(COL_EXTERNAL, docId);
  const b = deleteFromFirestore(COL_EVENTS, docId);
  return a && b;
}

// ── 텍스트 정리 ──────────────────────────────────────────────────────
function cleanText(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, " ")   // HTML 주석 제거  ← 제목 깨짐의 원인
    .replace(/<[^>]*>/g, " ")           // 남은 HTML 태그
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// 값 뒤에 붙어오는 정크를 자르는 마커들
const CUT_MARKERS = [
  "예약취소내역", "신규예약내역", "예약확정", "스마트플레이스",
  "자세히 보기", "자세히보기", "예약번호", "결제상태", "결제수단",
  "예약자명", "예약일시", "이용일시", "고객센터", "네이버 예약",
];

// "라벨" 뒤 값을 마커 전까지 잘라 정리
function extractAfterLabel(flat, label, maxLen) {
  const re = new RegExp(label + "\\s*(.*)$");
  const m = flat.match(re);
  if (!m) return "";
  let s = m[1];
  for (const marker of CUT_MARKERS) {          // 가장 먼저 나오는 마커에서 절단
    const i = s.indexOf(marker);
    if (i !== -1) s = s.slice(0, i);
  }
  s = cleanText(s);
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen).trim() + "…";
  return s;
}

// 예약상품명 — 참고용. 못 찾아도 동작에 지장 없음.
function extractProduct(flat) {
  return extractAfterLabel(flat, "예약상품", MAX_TITLE_LEN);
}

// ── 파싱 ─────────────────────────────────────────────────────────────
function toHm(ampm, h, m) {
  let hh = parseInt(h, 10);
  if (ampm === "오후" && hh !== 12) hh += 12;
  if (ampm === "오전" && hh === 12) hh = 0;
  return String(hh).padStart(2, "0") + ":" + m;
}

const USE_DATE_RE = /이용일시(\d{4})\.(\d{1,2})\.(\d{1,2})\.?(?:\([월화수목금토일]\))?(오전|오후)(\d{1,2}):(\d{2})(?:[~〜～\-](?:(오전|오후))?(\d{1,2}):(\d{2}))?/;

function parseBlock(flat, msgDate) {
  const norm = flat.replace(/ /g, "");

  const noMatch = norm.match(/예약번호(\d{6,})/);
  const dtMatch = norm.match(USE_DATE_RE);
  if (!noMatch || !dtMatch) return null;

  const date      = `${dtMatch[1]}-${String(dtMatch[2]).padStart(2,"0")}-${String(dtMatch[3]).padStart(2,"0")}`;
  const startTime = toHm(dtMatch[4], dtMatch[5], dtMatch[6]);
  const endTime   = dtMatch[8] ? toHm(dtMatch[7] || dtMatch[4], dtMatch[8], dtMatch[9]) : "";

  // 예약상품(회원/외부)을 구분하지 않는다 — 모두 외부 예약으로 시간만 차단.
  // 제목·팀·요청사항·예약자명은 저장하지 않는다(개인정보 최소화).
  return {
    bookingNo: noMatch[1],
    booking: { date, startTime, endTime, product: extractProduct(flat), createdAt: msgDate.getTime() },
  };
}

function opSave(r) {
  return { docId: "naver_" + r.bookingNo, action: "save", booking: r.booking };
}
function opDelete(bookingNo) {
  return { docId: "naver_" + bookingNo, action: "delete" };
}

function parseBookingEmail(message) {
  const flat = cleanText(message.getPlainBody());   // ← 주석·태그 먼저 제거
  const norm = flat.replace(/ /g, "");
  const when = message.getDate();

  let type;
  if (norm.indexOf("예약을취소") !== -1)      type = "cancel";
  else if (norm.indexOf("예약을변경") !== -1 ||
           norm.indexOf("예약이변경") !== -1) type = "change";
  else                                        type = "confirm";

  if (type === "change") {
    const ni = flat.indexOf("신규예약내역");
    const ci = flat.indexOf("예약취소내역");
    if (ni !== -1 && ci > ni) {
      const newer = parseBlock(flat.slice(ni, ci), when);   // 변경 후
      const older = parseBlock(flat.slice(ci), when);       // 변경 전
      const ops = [];
      if (older) ops.push(opDelete(older.bookingNo));
      if (newer) ops.push(opSave(newer));
      return ops;
    }
    console.warn("⚠️ 변경 메일 블록 분할 실패:", message.getSubject());
  }

  const r = parseBlock(flat, when);
  if (!r) return [];
  return type === "cancel" ? [opDelete(r.bookingNo)] : [opSave(r)];
}

// ── 메인 ─────────────────────────────────────────────────────────────
function buildQuery(lastRunMs) {
  if (lastRunMs > 0) {
    const d = new Date(lastRunMs - 86400000);   // 안전 버퍼 1일
    return `from:${SENDER} after:${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `from:${SENDER} newer_than:${FALLBACK_DAYS}d`;
}

function checkNaverBookingEmails() {
  const props     = PropertiesService.getScriptProperties();
  const lastRunMs = parseInt(props.getProperty("lastRunAt") || "0", 10);
  const q         = buildQuery(lastRunMs);
  console.log("🔍", q);

  const msgs = [];
  GmailApp.search(q, 0, 50).forEach(t => t.getMessages().forEach(m => msgs.push(m)));
  if (msgs.length === 0) {
    console.log("📭 새 메일 없음");
    props.setProperty("lastRunAt", String(Date.now()));
    return;
  }

  msgs.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());
  console.log(`📬 메시지 ${msgs.length}건`);

  const finalState = {};
  msgs.forEach(m => parseBookingEmail(m).forEach(op => { finalState[op.docId] = op; }));

  let saved = 0, deleted = 0, skipped = 0;

  Object.keys(finalState).forEach(docId => {
    const op     = finalState[docId];
    const sigKey = "st_" + docId;
    const b      = op.booking;
    // v2: 회원/외부 구분이 없어졌으므로 시그니처 형식을 바꿔 기존 기록과 겹치지 않게 한다
    const sig = op.action === "delete"
      ? "D"
      : "S2" + JSON.stringify([b.date, b.startTime, b.endTime]);

    if (props.getProperty(sigKey) === sig) { skipped++; return; }

    if (op.action === "delete") {
      console.log("🗑  삭제 →", docId);
      if (deleteFromBoth(docId)) { props.setProperty(sigKey, sig); deleted++; }
      return;
    }

    console.log(`🙋 외부 예약 → ${docId}  ${b.date} ${b.startTime}~${b.endTime || "?"}  "${b.product || "-"}"`);
    // 예전 버전이 회원 예약으로 events에 넣었던 건이면 거기서 제거
    deleteFromFirestore(COL_EVENTS, docId);
    if (saveExternal(docId, b)) { props.setProperty(sigKey, sig); saved++; }
  });

  console.log(`✅ 외부 ${saved} / 삭제 ${deleted} / 변경없음 ${skipped}`);
  props.setProperty("lastRunAt", String(Date.now()));
}

// ── 유틸리티 ─────────────────────────────────────────────────────────
function resetState() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  console.log(`✅ 상태 초기화 — 다음 실행 시 ${FALLBACK_DAYS}일 백필`);
}

// 컬렉션의 naver_ 문서 전체 나열 (확인용)
function listDocsIn(collection) {
  let token = "", n = 0;
  do {
    const url = firestoreUrl(collection) + "?pageSize=300" + (token ? "&pageToken=" + token : "");
    const res = UrlFetchApp.fetch(url, { headers: authHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) { console.error(res.getContentText()); return; }
    const json = JSON.parse(res.getContentText());
    (json.documents || []).forEach(d => {
      const id = d.name.split("/").pop();
      if (id.indexOf("naver_") !== 0) return;
      const f = d.fields || {};
      const label = (f.title || {}).stringValue || (f.product || {}).stringValue || "";
      console.log(`[${collection}] ${id}  ${(f.date||{}).stringValue} ${(f.startTime||{}).stringValue}~${(f.endTime||{}).stringValue}  "${label}"`);
      n++;
    });
    token = json.nextPageToken || "";
  } while (token);
  console.log(`[${collection}] 총 ${n}건`);
}

function listNaverDocs() {
  listDocsIn(COL_EVENTS);
  listDocsIn(COL_EXTERNAL);
}

// ⚠️ 1회용 정리 — events에 남아 있는 naver_ 문서(옛 소속회원 예약)를 모두 삭제.
//    이제 네이버 예약은 확정 일정에 표시하지 않으므로 한 번 실행해 비워 준다.
//    실행 전 listNaverDocs()로 지워질 목록을 먼저 확인할 것.
function purgeNaverEvents() {
  let token = "", removed = 0;
  do {
    const url = firestoreUrl(COL_EVENTS) + "?pageSize=300" + (token ? "&pageToken=" + token : "");
    const res = UrlFetchApp.fetch(url, { headers: authHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) { console.error(res.getContentText()); return; }
    const json = JSON.parse(res.getContentText());
    (json.documents || []).forEach(d => {
      const id = d.name.split("/").pop();
      if (id.indexOf("naver_") !== 0) return;
      console.log("🧹 events에서 삭제:", id);
      deleteFromFirestore(COL_EVENTS, id);
      removed++;
    });
    token = json.nextPageToken || "";
  } while (token);
  console.log(`✅ events의 네이버 문서 ${removed}건 정리 완료`);
}

function testConnection() {
  const res = UrlFetchApp.fetch(firestoreUrl(COL_EXTERNAL) + "?pageSize=1", {
    headers: authHeader(), muteHttpExceptions: true,
  });
  console.log("상태:", res.getResponseCode(), res.getContentText().slice(0, 300));
}

// 파싱 결과만 확인 (Firestore 쓰기 없음)
function debugParse() {
  const q = buildQuery(0);
  console.log("🔍", q);
  const msgs = [];
  GmailApp.search(q, 0, 50).forEach(t => t.getMessages().forEach(m => msgs.push(m)));
  msgs.sort((a, b) => a.getDate().getTime() - b.getDate().getTime());

  const fs = {};
  msgs.forEach(m => {
    const ops = parseBookingEmail(m);
    console.log(`\n[${m.getDate().toLocaleString()}] ${m.getSubject()}`);
    if (!ops.length) { console.log("   → (파싱 실패)"); return; }
    ops.forEach(op => {
      fs[op.docId] = op;
      if (op.action === "delete") console.log("   🗑 ", op.docId);
      else {
        const b = op.booking;
        console.log(`   🙋 외부 ${op.docId}  ${b.date} ${b.startTime}~${b.endTime || "?"}  "${b.product || "-"}"`);
      }
    });
  });

  console.log("\n===== 최종 상태 =====");
  Object.keys(fs).forEach(id => {
    const op = fs[id];
    if (op.action === "delete") { console.log(`❌ ${id} (삭제)`); return; }
    const b = op.booking;
    console.log(`🙋 외부 ${id}  ${b.date} ${b.startTime}~${b.endTime || "?"}`);
  });
}
