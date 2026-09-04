// 단원의 '팀' 값 하나로 일정·알림 대상이 정해진다.
//
//   팀 없음("")  → 비활성. 어떤 일정에도 안 잡히고 단체 알림도 안 간다.
//                  (막 가입해 아직 배정 안 된 사람, 쉬고 있는 단원)
//   A팀·B팀      → 그 팀 일정과 전체 일정에 들어간다
//   원캐스트      → 팀이 나뉜 일정이든 전체 일정이든 전부 들어간다
//
// 개별 지정 일정(participantUids)은 이름을 콕 집어 고른 것이라 이 규칙과 무관하다 —
// 팀 없음인 사람도 지정하면 들어간다.

/** 팀을 나누지 않고 모든 일정에 들어가는 사람 */
export const ONE_CAST = "원캐스트";

/** 활동 중인가 (팀 없음 = 비활성) */
export function isActiveMember(team?: string): boolean {
  return !!team?.trim();
}

/**
 * 이 단원이 이 일정의 기본 대상인가.
 * @param memberTeam 단원의 팀
 * @param eventTeam  일정의 팀 (비어 있으면 '전체 일정')
 */
export function inEventAudience(memberTeam?: string, eventTeam?: string): boolean {
  if (!isActiveMember(memberTeam)) return false; // 팀 없음 → 어디에도 안 들어간다
  if (memberTeam === ONE_CAST) return true; // 원캐스트 → 팀을 가리지 않는다
  if (!eventTeam) return true; // 전체 일정 → 팀이 있는 사람 모두
  return memberTeam === eventTeam; // 팀 일정 → 그 팀만
}
