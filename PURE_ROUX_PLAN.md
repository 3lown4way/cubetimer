# Pure Roux Solver 재작성 계획

## 목표
- Phase solver (Kociemba) 완전 제거
- cubing.js general solver 완전 제거  
- SpeedCubeDB 알고리즘 기반 Pure Roux 구현
- FB → SB → CMLL → LSE 단계별 beam search

## 현재 문제점
1. FB/SB 탐지 로직이 piece-based로 복잡하고 부정확
2. Beam search scoring이 FB/SB 진행도를 제대로 측정 못 함
3. FB-preserving moves가 실제로 FB를 깨뜨리는 경우 있음

## 해결 방안

### 1. FB/SB 탐지 단순화
```javascript
// 현재: piece position + orientation 비교 (복잡함)
// 변경: FB/SB 정의 명확화 + simple coordinate check

// Left Block (FB): 
// - Corners: ULB, ULF, DLB, DLF (4개)
// - Edges: UL, FL, DL (3개)
// - 모두 제자리 + 올바른 orientation

// Right Block (SB):
// - Corners: URB, URF, DRB, DRF (4개)  
// - Edges: UR, FR, DR (3개)
// - 모두 제자리 + 올바른 orientation
```

### 2. Beam search 개선
```javascript
// FB: depth 8, beam 1000, all moves
// SB: depth 10, beam 1500, FB-preserving moves only
// CMLL: depth 6, beam 500, {U, R, L} moves
// LSE: depth 8, beam 500, {M, U} moves
```

### 3. SpeedCubeDB 알고리즘 확대
- CMLL: 168 algs (완료)
- LSE: 135 algs (완료)
- FB: 수집 필요 (1x2x3 block builders)
- SB: 수집 필요 (1x2x3 block builders)

### 4. Fallback 구조
```
1차: Phase solver (빠름, ~90% 성공)
2차: Beam search (FB→SB→CMLL→LSE, Pure Roux)
3차: SpeedCubeDB alg lookup (CMLL/LSE만)
```

## 구현 순서
1. FB/SB 탐지 함수 단순화
2. Beam search 파라미터 개선
3. SpeedCubeDB FB/SB alg 수집
4. Phase solver/cubing.js fallback 제거
5. 전체 테스트

## 예상 소요 시간
- 코드 작성: 2-3시간
- 테스트/디버깅: 1-2시간
- 총 3-5시간
