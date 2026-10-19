# SUNCALC — 태양광 발전·경제성 계산기

건축공학용 태양광 발전량·경제성 웹 서비스입니다.

## 공개 웹페이지 (GitHub Pages)

저장소를 GitHub에 올린 뒤 Pages가 활성화되면 아래 주소로 누구나 접속할 수 있습니다.

`https://<GitHub사용자명>.github.io/suncalc/`

## 로컬 실행 (Python API 서버)

```bash
python -u server.py
```

브라우저에서 http://127.0.0.1:3000 접속

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 상태 확인 |
| GET | `/api/defaults` | 기본값·지역 |
| GET | `/api/regions` | 지역 목록 |
| POST | `/api/calculate` | 발전·경제성 계산 |
