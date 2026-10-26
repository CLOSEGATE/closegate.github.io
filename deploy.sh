#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 클로즈 게이트 새 버전 배포 (Google Cloud Shell 전용)
#  1) GitHub 저장소를 받거나 최신으로 맞춘다
#  2) 이 폴더의 새 파일을 저장소에 덮어쓴다 (firebase-config.js는 그대로 둔다)
#  3) setup-cloudshell.sh로 보안 규칙 게시 · 설정값 확인 · GitHub 올리기
# 사용법: Cloud Shell에 zip을 올린 뒤
#   unzip -o closegate-v23.zip && bash closegate-firebase/deploy.sh
# ─────────────────────────────────────────────────────────────
set -uo pipefail
REPO="https://github.com/CLOSEGATE/closegate.github.io.git"
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/closegate.github.io"

printf '\n\033[1;36m▶ 저장소 준비\033[0m\n'
if [ -d "$DST/.git" ]; then git -C "$DST" pull -q --ff-only || true; else git clone -q "$REPO" "$DST" || { echo "저장소를 받지 못했다."; exit 1; }; fi

printf '\n\033[1;36m▶ 새 파일 복사\033[0m\n'
for f in index.html firebase-adapter.js firestore.rules README.md setup-cloudshell.sh deploy.sh; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DST/$f" && echo "  ✔ $f"
done
[ -f "$DST/firebase-config.js" ] || cp "$SRC/firebase-config.js" "$DST/firebase-config.js"

cd "$DST" && bash setup-cloudshell.sh "${1:-}"
