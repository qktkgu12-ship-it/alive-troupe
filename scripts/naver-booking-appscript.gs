// =====================================================================
// 네이버 예약 메일 → Firestore 자동 연동 (Apps Script)
//   소속 회원 예약  → events/naver_{예약번호}           (확정 일정으로 표시)
//   그 외 모든 예약 → externalBookings/naver_{예약번호}  (확정 일정에는 안 뜨고,
//                     일정방에서 '외부 손님 예약'으로 시간만 차단)
// =====================================================================

const FIRESTORE_PROJECT = "alive-559ec";
const SENDER            = "naverbooking_noreply@navercorp.com";
const PRODUCT_KEYWORD   = "극단얼라이브소속회원";   // 공백 제거 기준
const TEAM_NAMES        = ["A팀", "B팀"];
const LOCATION          = "스튜디오 얼라이브";
const FALLBACK_DAYS     = 60;
const MAX_TITLE_LEN     = 60;

const COL_EVENTS   = "events";
const COL_EXTERNAL = "externalBookings";

// 스크립트가 관리하는 필드 (hidden 등 앱에서 만든 필드는 건드리지 않음)
const EVENT_FIELDS    = ["title","date","startTime","endTime","location","memo","team","source","createdAt"];
const EXTERNAL_FIELDS = ["date","startTime","endTime","product","createdAt"];

// ── Firestore REST ───────────────────────────────────────────────────
function firestoreUrl(path) {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}`;
}
function runQueryUrl() {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery`;
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

// 소속 회원 예약 → 확정 일정
function saveEvent(docId, b) {
  return patchDoc(COL_EVENTS, docId, {
    title:     { stringValue: b.title },
    date:      { stringValue: b.date },
    startTime: { stringValue: b.startTime },
    endTime:   { stringValue: b.endTime },
    location:  { stringValue: b.location },
    memo:      { stringValue: b.memo },
    team:      { stringValue: b.team },
    source:    { stringValue: "naver" },
    createdAt: { integerValue: String(b.createdAt) },
  }, EVENT_FIELDS);
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

// 예약상품이 바뀌어(회원↔외부) 반대편 컬렉션에 옛 문서가 남는 것을 막는다.
// DELETE는 404를 성공으로 처리하므로 없으면 그냥 통과.
function deleteFromBoth(docId) {
  const a = deleteFromFirestore(COL_EVENTS, docId);
  const b = deleteFromFirestore(COL_EXTERNAL, docId);
  return a && b;
}

// 특정 날짜의 기존 확정 일정 조회 (중복 방지용 — 확정 일정에만 적용)
function fetchEventsOnDate(date) {
  const res = UrlFetchApp.fetch(runQueryUrl(), {
    method: "post",
    contentType: "application/json",
    headers: authHeader(),
    muteHttpExceptions: true,
    payload: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: COL_EVENTS }],
        where: { fieldFilter: {
          field: { fieldPath: "date" }, op: "EQUAL", value: { stringValue: date }
        }},
        limit: 50,
      }
    }),
  });
  if (res.getResponseCode() >= 300) {
    console.error("❌ 조회 실패", date, res.getContentText());
    return [];
  }
  const out = [];
  (JSON.parse(res.getContentText()) || []).forEach(r => {
    if (!r.document) return;
    const f = r.document.fields || {};
    out.push({
      id:        r.document.name.split("/").pop(),
      startTime: (f.startTime || {}).stringValue || "",
      title:     (f.title     || {}).stringValue || "",
      source:    (f.source    || {}).stringValue || "",
    });
  });
  return out;
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

// 요청사항 뒤에 붙어오는 정크를 자르는 마커들
const CUT_MARKERS = [
  "예약취소내역", "신규예약내역", "예약확정", "스마트플레이스",
  "자세히 보기", "자세히보기", "예약번호", "결제상태", "결제수단",
  "예약자명", "예약일시", "이용일시", "고객센터", "네이버 예약",
];

// "라벨" 뒤 값을 마커 전까지 잘라 정리 (요청사항·예약상품 공용)
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

function extractRequest(flat) {
  return extractAfterLabel(flat, "요청사항", MAX_TITLE_LEN);
}

// 예약상품명 — 참고용(외부 예약 문서에만 저장). 못 찾아도 동작에 지장 없음.
function extractProduct(flat) {
  return extractAfterLabel(flat, "예약상품", MAX_TITLE_LEN);
}

// ── 마스킹된 예약자명 → 홈페이지 멤버 이름 대조 ────────────────────
// 네이버는 예약자명을 "박*현"처럼 가운데를 가려서 보냄.
// publicProfiles의 단원 이름과 글자수·보이는 글자로 대조해 원래 이름을 복원한다.
// 후보가 2명 이상이면(예: 박지현·박수현) 추측하지 않고 빈값을 돌려준다.

const EMPTY_REQUEST_TOKENS = ["", "-", "--", "―", ".", "없음", "무", "x", "X"];
function isEmptyRequest(s) {
  return EMPTY_REQUEST_TOKENS.indexOf(String(s || "").trim()) !== -1;
}

let MEMBER_NAMES_CACHE = null;   // 실행(run) 1회만 조회

function fetchMemberNames() {
  if (MEMBER_NAMES_CACHE) return MEMBER_NAMES_CACHE;
  const names = [];
  let token = "";
  do {
    const url = firestoreUrl("publicProfiles") + "?pageSize=300" + (token ? "&pageToken=" + token : "");
    const res = UrlFetchApp.fetch(url, { headers: authHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) {
      console.error("❌ 멤버 이름 조회 실패", res.getContentText());
      MEMBER_NAMES_CACHE = [];
      return MEMBER_NAMES_CACHE;
    }
    const json = JSON.parse(res.getContentText());
    (json.documents || []).forEach(d => {
      const n = ((d.fields || {}).name || {}).stringValue || "";
      const t = n.trim();
      if (t) names.push(t);
    });
    token = json.nextPageToken || "";
  } while (token);
  MEMBER_NAMES_CACHE = names;
  console.log(`👥 멤버 이름 ${names.length}명 로드`);
  return names;
}

// "박*현" → 정규식 /^박.현$/ 로 대조. * 가 여러 개여도 동작.
function resolveMemberName(masked) {
  const m = String(masked || "").trim();
  if (!m || m.indexOf("*") === -1) return "";   // 마스킹이 아니면 대조할 필요 없음

  const names = fetchMemberNames();
  if (!names.length) return "";

  // 정규식 특수문자 이스케이프 후 * 만 '아무 글자 1개'로
  const pattern = "^" + m.split("").map(ch =>
    ch === "*" ? "." : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("") + "$";
  const re = new RegExp(pattern);

  const hits = [];
  names.forEach(n => { if (re.test(n) && hits.indexOf(n) === -1) hits.push(n); });

  if (hits.length === 1) return hits[0];
  if (hits.length > 1) console.warn(`⚠️ 이름 후보 여러 명 — "${m}" → ${hits.join(", ")} (추측 안 함)`);
  else                 console.warn(`⚠️ 일치하는 멤버 없음 — "${m}"`);
  return "";
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

  // 예약상품 판정: 공백을 모두 제거해 비교하므로 표기 차이(극단 얼라이브 소속 회원 / 극단얼라이브 소속회원)에 안전
  const isMember = norm.indexOf(PRODUCT_KEYWORD) !== -1;

  const date      = `${dtMatch[1]}-${String(dtMatch[2]).padStart(2,"0")}-${String(dtMatch[3]).padStart(2,"0")}`;
  const startTime = toHm(dtMatch[4], dtMatch[5], dtMatch[6]);
  const endTime   = dtMatch[8] ? toHm(dtMatch[7] || dtMatch[4], dtMatch[8], dtMatch[9]) : "";

  if (!isMember) {
    // 외부 손님 예약 — 제목·팀·요청사항은 쓰지 않음(개인정보 최소화). 날짜·시간만 보관.
    return {
      bookingNo: noMatch[1],
      isMember: false,
      booking: { date, startTime, endTime, product: extractProduct(flat), createdAt: msgDate.getTime() },
    };
  }

  const request   = extractRequest(flat);
  const nameMatch = flat.match(/예약자명\s*(\S+?)님/);
  const guest     = nameMatch ? cleanText(nameMatch[1]) : "";

  // 요청사항이 '-' 처럼 사실상 비어 있으면 제목으로 쓰지 않는다
  const hasRequest = !isEmptyRequest(request);

  let team = "", title = hasRequest ? request : "";
  if (hasRequest) {
    for (const t of TEAM_NAMES) if (request.indexOf(t) !== -1) { team = t; break; }
    if (team && title.indexOf(team) === 0) title = title.slice(team.length).trim();
  }

  // 요청사항이 없으면 마스킹된 예약자명(박*현)을 멤버 명단과 대조해 실제 이름으로
  if (!title) {
    const resolved = resolveMemberName(guest);
    if (resolved)      title = resolved;
    else if (guest)    title = `${guest} 예약`;   // 대조 실패 시 기존 동작 유지
    else               title = "네이버 예약";
  }

  return {
    bookingNo: noMatch[1],
    isMember: true,
    booking: { title, date, startTime, endTime, location: LOCATION, memo: "", team, createdAt: msgDate.getTime() },
  };
}

function opSave(r) {
  return { docId: "naver_" + r.bookingNo, action: "save", isMember: r.isMember, booking: r.booking };
}
function opDelete(bookingNo) {
  // 삭제는 양쪽 컬렉션에서 지우므로 isMember를 몰라도 안전
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

  const dayCache = {};   // date → 그날 기존 확정 일정 (1회만 조회)
  let saved = 0, savedExt = 0, deleted = 0, skipped = 0, dup = 0;

  Object.keys(finalState).forEach(docId => {
    const op     = finalState[docId];
    const sigKey = "st_" + docId;
    const b      = op.booking;
    // 시그니처에 isMember를 포함 → 예약상품이 회원↔외부로 바뀌면 반드시 다시 처리됨
    const sig = op.action === "delete"
      ? "D"
      : "S" + JSON.stringify([op.isMember, b.date, b.startTime, b.endTime,
                              op.isMember ? b.title : "", op.isMember ? b.team : ""]);

    if (props.getProperty(sigKey) === sig) { skipped++; return; }

    if (op.action === "delete") {
      console.log("🗑  삭제 →", docId);
      if (deleteFromBoth(docId)) { props.setProperty(sigKey, sig); deleted++; }
      return;
    }

    // ── 외부 손님 예약 ─────────────────────────────────────────────
    if (!op.isMember) {
      console.log(`🙋 외부 예약 → ${docId}  ${b.date} ${b.startTime}~${b.endTime || "?"}  "${b.product || "-"}"`);
      // 이전에 회원 예약으로 events에 들어갔던 건이면 거기서 제거
      deleteFromFirestore(COL_EVENTS, docId);
      if (saveExternal(docId, b)) { props.setProperty(sigKey, sig); savedExt++; }
      return;
    }

    // ── 소속 회원 예약 → 확정 일정 ─────────────────────────────────
    // 중복 가드: 같은 날짜·시작시간에 다른 확정 일정이 이미 있으면 등록 안 함
    if (!(b.date in dayCache)) dayCache[b.date] = fetchEventsOnDate(b.date);
    const clash = dayCache[b.date].find(ev => ev.id !== docId && ev.startTime === b.startTime);
    if (clash) {
      console.log(`⏭  중복 건너뜀 → ${b.date} ${b.startTime} — 기존 "${clash.title}" (${clash.id})`);
      props.setProperty(sigKey, sig);   // 다음 실행 때 다시 조회하지 않도록 기록
      dup++;
      return;
    }

    console.log(`💾 저장 → ${docId}  ${b.date} ${b.startTime}~${b.endTime}  "${b.title}"  [${b.team || "전체"}]`);
    // 이전에 외부 예약으로 externalBookings에 들어갔던 건이면 거기서 제거
    deleteFromFirestore(COL_EXTERNAL, docId);
    if (saveEvent(docId, b)) {
      props.setProperty(sigKey, sig);
      dayCache[b.date].push({ id: docId, startTime: b.startTime, title: b.title, source: "naver" });
      saved++;
    }
  });

  console.log(`✅ 확정 ${saved} / 외부 ${savedExt} / 삭제 ${deleted} / 중복 ${dup} / 변경없음 ${skipped}`);
  props.setProperty("lastRunAt", String(Date.now()));
}

// ── 유틸리티 ─────────────────────────────────────────────────────────
function resetState() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  console.log(`✅ 상태 초기화 — 다음 실행 시 ${FALLBACK_DAYS}일 백필`);
}

// 컬렉션의 naver_ 문서 전체 나열 (중복 확인용)
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
      const legacy = /^naver_\d{8}_\d{4}$/.test(id) ? "  ⚠️구버전" : "";
      const label  = (f.title || {}).stringValue || (f.product || {}).stringValue || "";
      console.log(`[${collection}] ${id}  ${(f.date||{}).stringValue} ${(f.startTime||{}).stringValue}~${(f.endTime||{}).stringValue}  "${label}"${legacy}`);
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

// 구버전 문서(naver_YYYYMMDD_HHMM) 일괄 삭제
function cleanupLegacyDocs() {
  let token = "", removed = 0;
  do {
    const url = firestoreUrl(COL_EVENTS) + "?pageSize=300" + (token ? "&pageToken=" + token : "");
    const res = UrlFetchApp.fetch(url, { headers: authHeader(), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) { console.error(res.getContentText()); return; }
    const json = JSON.parse(res.getContentText());
    (json.documents || []).forEach(d => {
      const id = d.name.split("/").pop();
      if (/^naver_\d{8}_\d{4}$/.test(id)) {
        console.log("🧹 구버전 삭제:", id);
        deleteFromFirestore(COL_EVENTS, id);
        removed++;
      }
    });
    token = json.nextPageToken || "";
  } while (token);
  console.log(`✅ 구버전 ${removed}건 정리 완료`);
}

function testConnection() {
  const res = UrlFetchApp.fetch(firestoreUrl(COL_EVENTS) + "?pageSize=1", {
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
        console.log(op.isMember
          ? `   💾 확정 ${op.docId}  ${b.date} ${b.startTime}~${b.endTime}  "${b.title}"  [${b.team || "전체"}]`
          : `   🙋 외부 ${op.docId}  ${b.date} ${b.startTime}~${b.endTime || "?"}  "${b.product || "-"}"`);
      }
    });
  });

  console.log("\n===== 최종 상태 =====");
  Object.keys(fs).forEach(id => {
    const op = fs[id];
    if (op.action === "delete") { console.log(`❌ ${id} (삭제)`); return; }
    const b = op.booking;
    console.log(`${op.isMember ? "✅ 확정" : "🙋 외부"} ${id}  ${b.date} ${b.startTime}~${b.endTime || "?"}`);
  });
}
