# SMOS 기획안

Sub-Merchant Onboarding Status — 서브 머천트 온보딩 현황 보드

---

## 1. 왜 만들었나 (Problem)

SentBe의 Sales 팀은 서브 머천트 온보딩 상태를 확인하려면 운영팀에 직접 물어보거나 구글 시트를 뒤져야 했다. 시트는 컬럼이 많고 모바일에서 보기 어렵고, 어떤 머천트가 어느 단계에서 막혀있는지 한눈에 파악할 수 없었다.

## 2. 누구를 위한 앱인가 (Users)

| 사용자 | 핵심 니즈 | 사용 빈도 |
|--------|----------|----------|
| **Sales 팀** (주 사용자) | 머천트 이름/MID 검색 → 현재 단계·실패사유·VA 발급 즉시 확인 | 수시 (하루 여러 번, 폰으로) |
| **Sales 리드** | 전체 온보딩 현황 요약, 주간 보고, 클라이언트별 승인율 | 주 1~2회 |
| **운영팀** (간접) | Slack 알림으로 상태 변경 인지, 시트에서 직접 작업 | 실시간 알림 수신 |

## 3. 핵심 가치 (Core Value)

> **"머천트 이름 치면 3초 안에 온보딩 어디까지 왔는지 안다"**

이것이 SMOS의 존재 이유. 모든 기능과 UI 결정은 이 문장에 부합하는지로 판단한다.

## 4. 아키텍처

```
Google Sheets (원천 데이터)
    ↓ IMPORTRANGE
운영 시트 (KRW·VND 탭)
    ↓ doGet API
Apps Script (Code.gs)  ←→  Slack (알림)
    ↓ JSON
index.html (GitHub Pages)
    ↑ 30초 폴링
Sales 폰/PC
```

- **단일 파일**: `index.html` 하나. CSS/JS 인라인. 빌드 없음.
- **데이터 방향**: 시트 → 보드 (읽기 전용). 보드 → 시트 쓰기는 없음.
- **인증**: Google Sign-In (sentbe.com 도메인 제한)
- **호스팅**: GitHub Pages (`smos-deploy` 레포)

## 5. 코리도 (Corridor)

### KRW
- **상태 흐름**: KYC → Ops confirming → Succeeded / Failed
- **Steps**: Request → KYB → Review → VA 발급
- **주요 필드**: Client, 상점명, MID, 요청일, 티켓, 상태, 실패사유, VA, VA상태, 메모

### VND
- **상태 흐름**: In progress → Approved / Rejected·Offboarded
- **Steps**: Request → KYB → Review → VA 발급
- **주요 필드**: MID, 상점명, FI Merchant, FI Partner, 은행명, 요청일, 상태, VA, VA발급일, KYC일, Jira

## 6. 구현 완료 기능

### v1 — 기본 보드
- [x] KRW/VND 탭 전환
- [x] 검색 (상점명·고객명·MID)
- [x] 상태별 필터 칩
- [x] 클라이언트별 그룹 접기/펼치기
- [x] 머천트 상세 펼치기 (step tracker, 전체 필드)
- [x] VA 번호 복사
- [x] 머천트 요약 복사 (공유용)

### v2 — 대시보드·다크모드
- [x] 대시보드 (주간 신규, 주간 승인율, 클라이언트별, 월간 추이, 승인율 추이)
- [x] 다크 테마 토글
- [x] 정렬 (그룹순/최근순)
- [x] CSV 내보내기
- [x] JSON 백업

### v3 — 인증·보안
- [x] Google Sign-In (sentbe.com 도메인 제한)
- [x] Users 탭 기반 role 관리 (admin/sales/ops)
- [x] 관리 모드 (admin만 편집)
- [x] JWT 검증
- [x] GitHub Actions 보안 스캔

### v4 — 이메일·Forecast
- [x] 주간 보고 이메일 (HTML 템플릿)
- [x] Ops/Sales 분리 이메일
- [x] Forecast 뷰 (KRW/VND 별도 탭)
- [x] 한국어/영어 전환

### v5 — Slack 연동
- [x] 상태 변경 Slack 알림 (1분 폴링 방식)
- [x] 5가지 알림: 신규, 실패, 철회, 승인, 진행상태 변경
- [x] 주간 보고 Slack 발송

## 7. 다음 개발 우선순위

### Priority 1: Funnel Analytics — 머천트 개별 조회 강화
**목표**: 검색 결과에서 머천트의 온보딩 단계를 즉시 파악
- 머천트 카드에 step tracker 항상 노출 (현재: 펼쳐야 보임)
- 접힌 상태에서도 Request → KYB → Review → VA 진행 단계 표시
- 완료(초록), 진행중(파란), 실패(빨강), 대기(회색) 색상 코딩
- **이것이 앱의 핵심 가치와 직결되는 기능**

### Priority 2: Funnel Analytics — 전체 퍼널 통계
**목표**: 대시보드에서 전체 온보딩 병목 파악
- 대시보드 최상단에 Funnel 섹션 추가
- Summary 카드 (Total / Completion Rate)
- 상태별 가로 바 차트 + 단계간 전환율
- 전환율 색상: 80%+ 초록, 50~79% 노랑, 50% 미만 빨강

### Priority 3: Forecast vs Actual
**목표**: 예측 대비 실제 온보딩 실적 비교
- Forecast 뷰에 실제 데이터 오버레이
- 차이 시각화 (초과/미달)

### Priority 4: Smart Alerts 고도화
**목표**: 알림의 정밀도와 유용성 향상
- 장기 체류 알림 (N일 이상 같은 단계)
- 알림 요약 (1시간 묶음)
- 중요도별 알림 레벨

### Backlog
- 코리도 추가 (JPY 등) — 필요 시
- 머천트 셀프서비스 포털 — 회사 내부 개발 중이므로 보류
- 자동화 (온보딩 프로세스) — SMOS 역할 범위 재검토 필요
- 팀 담당자별 뷰 — 추후

## 8. 하지 않는 것 (Non-Goals)

- **양방향 데이터 쓰기**: 시트가 원천. SMOS에서 시트로 쓰기는 하지 않음. 운영팀도 Sales도 SMOS에 직접 입력할 일 없음 (시트에서 작업).
- **SLA 타이머**: 운영팀 내부 관리 영역. SMOS에 노출 불필요.
- **활동 로그**: 불필요.
- **빌드 시스템 도입**: 단일 파일 유지. webpack, vite 등 도입 금지.
- **localStorage/sessionStorage**: 아티팩트 환경에서 깨짐. 상태는 메모리 + 백엔드만.

## 9. 기술 제약

- 단일 HTML 파일 (CSS/JS 인라인)
- 외부 의존성: Pretendard CDN, Google Sign-In SDK만 허용
- 모바일 우선 (입력 폰트 16px 이상)
- 색상은 CSS 변수 (`--s-*`)
- UI 문구 한국어 / 데이터 값은 시트 원본 그대로
- 코리도 차이는 `CORRIDORS` config에서만 처리 (하드코딩 분기 금지)

## 10. 핵심 URL

| 항목 | URL |
|------|-----|
| GitHub Pages | https://sentbejack.github.io/smos/ |
| Apps Script | `AKfycby47m1...eGMgHiA` (현재 배포) |
| Google Sheet | `18duKGwDXB0V...7U2hE` |
| Slack Channel | #smos-alerts |

---

## 배포 기록 (Changelog)

### v6.1 — 2026-08-02
- **보안: JWT fallback 제거** — tokeninfo API 실패 시 서명 미검증 fallback을 제거하고 인증 거부로 변경
- BACKEND_URL 업데이트

### v6.0 — 2026-08-02
- **P1: 머천트 카드 step tracker 항상 노출**
  - step tracker를 detail 내부 → item-row 아래로 이동 (접힌 상태에서도 보임)
  - stepTag() 함수·CSS 제거 (중복)
- **P2: 대시보드 퍼널 통계**
  - Summary 카드 3개 (Total / Succeeded / 완료율)
  - 상태별 가로 바 차트 (전체 대비 비율 %)
  - Failed/Rejected 구분선 분리
- KR/EN 다국어 키 추가 (dashFunnelSection, dashFunnelTotal, dashFunnelRate)
- SPEC.md 기획안 추가

### v5.1 — 2026-07-31
- Slack 알림을 onEdit → 1분 폴링 방식으로 전환
  - IMPORTRANGE 데이터는 onEdit 트리거가 발동하지 않는 문제 해결
  - `pollStatusChanges()`: 전체 시트 읽기 → ScriptProperties 스냅샷과 diff → 변경 건 알림
- BACKEND_URL 업데이트

### v5.0 — 2026-07-14
- Slack 실시간 알림 도입 (5가지 유형)
- 주간 보고 Slack 발송
- Container-bound script 마이그레이션

### v4.2 — 2026-07-12
- Forecast 뷰: KRW/VND 별도 탭에서 읽기
- 현황→Status 이름 변경

### v4.1 — 2026-07-10
- VA 컬럼 매핑 수정 (`"VA"` → `"가상 계좌 여부"`)
- VND 은행명 필드 추가

### v4.0 — 2026-07-08
- 주간 보고 이메일 (HTML 템플릿)
- Ops/Sales 분리 이메일
- Forecast 뷰 추가
- 한국어/영어 전환

### v3.0 — 2026-07-05
- Google Sign-In 도입 (sentbe.com 제한)
- Users 탭 기반 role 관리
- JWT 검증
- GitHub Actions 보안 스캔

### v2.0 — 2026-06-28
- 대시보드 (주간·월간 차트, 승인율)
- 다크 테마
- CSV 내보내기, JSON 백업
- 정렬 모드

### v1.0 — 2026-06-20
- 최초 배포
- KRW/VND 탭, 검색, 상태 필터
- 클라이언트 그룹, 머천트 상세
- Step tracker, VA 복사
