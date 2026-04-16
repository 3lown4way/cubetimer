# Roux 3x3 Solver 수정 계획

## 문제 분석

현재 Roux solver가 제대로 작동하지 않는 핵심 원인들:

### 1. 잘못된 Prune Table 인덱스 (`rouxPruneTables.js`)

> [!CAUTION]
> `rouxPruneTables.js`의 piece 인덱스가 `roux3x3.js`와 완전히 불일치

| 파일 | FB Corners | FB Edges | SB Corners | SB Edges |
|------|-----------|----------|-----------|----------|
| **roux3x3.js** (올바름) | [5, 6] | [7, 9, 11] | [4, 7] | [5, 8, 10] |
| **rouxPruneTables.js** (잘못됨) | [0, 3, 4, 7] | [3, 6, 8] | [1, 2, 5, 6] | [1, 4, 5] |

Prune table이 완전히 엉뚱한 위치를 추적하고 있어서 heuristic이 의미없는 값을 반환합니다.

### 2. SB에서 r 슬라이스 이동이 빠져 있음
- `roux3x3.js`의 `SB_MOVES`에 `r`, `r'`, `r2`가 없음
- Roux SB 풀이에서 r 이동은 매우 중요 (R + M을 동시에 해결)
- `rouxPruneTables.js`의 `FB_PRESERVING_MOVES`에는 있지만 메인 솔버에는 누락

### 3. Beam Search 비효율성
- 큰 beam width에도 불구하고 12+ move scramble을 풀지 못 함 (해결 시간 >> 30초)
- Prune table heuristic이 깨져 있으므로 scoring 함수가 올바른 방향으로 안내하지 못 함

### 4. Phase Solver Fallback이 Roux식 풀이를 제공하지 않음
- Fallback 시 CFOP/Kociemba 기반 해결책을 반환
- 실제 Roux 단계(FB→SB→CMLL→LSE)가 아닌 "(solved by phase solver)" 라벨만 붙음

## 제안 변경사항

### [Component 1: Prune Tables 수정]

#### [MODIFY] [rouxPruneTables.js](file:///home/jhkang/cubetimer/solver/rouxPruneTables.js)
- FB/SB piece 인덱스를 cubing.js 실제 값으로 수정:
  - `FB_CORNER_POSITIONS = [5, 6]` (DLF, DLB)
  - `FB_EDGE_POSITIONS = [7, 9, 11]` (DL, FL, BL)  
  - `SB_CORNER_POSITIONS = [4, 7]` (DRF, DRB)
  - `SB_EDGE_POSITIONS = [5, 8, 10]` (DR, FR, BR)
- Orientation 체크도 state encoding에 포함

---

### [Component 2: 메인 Roux Solver 개선]

#### [MODIFY] [roux3x3.js](file:///home/jhkang/cubetimer/solver/roux3x3.js)
- `SB_MOVES`에 `r`, `r'`, `r2` 추가 (FB를 깨뜨리지 않는 이동)
- Beam search 설정 최적화:
  - FB: depth 10, beam 8000 → 더 공격적 탐색
  - SB: depth 14, beam 24000, 더 넓은 moves 허용
- Prune table 활용 개선: heuristic 값이 0이면 즉시 해결 감지
- Phase solver fallback 시에도 Roux 단계 추출 시도

---

### [Component 3: CMLL/LSE 개선]

#### [MODIFY] [roux3x3.js](file:///home/jhkang/cubetimer/solver/roux3x3.js)
- CMLL: IDA* search depth를 12까지 확장 (현재 10)
- LSE: IDA* search depth를 14까지 확장 (현재 10)
- M-slice 에지만 남은 경우 LSE가 거의 항상 성공하도록 보장

## Verification Plan

### Automated Tests
```bash
# 1. Piece index 검증 테스트
node debug-piece-indices.mjs

# 2. 간단한 scramble 테스트 (5개)
node test-roux-simple.mjs

# 3. 복잡한 scramble 포함 테스트 (8개)  
node test-roux-comprehensive.mjs

# 4. 실제 WCA 스크램블 테스트
node -e "..."  # 20-move random scramble test
```

### Manual Verification
- 브라우저에서 앱을 열고 Roux 모드로 전환
- 복잡한 스크램블로 풀이 요청하여 정상 작동 확인
