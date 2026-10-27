#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 클로즈 게이트 Firebase 한 번에 설정 (Google Cloud Shell 전용)
#  1) 필요한 API 켜기
#  2) Firestore 데이터베이스 만들기 (없을 때만, 서울 리전)
#  3) 로그인 켜기: 이메일/비밀번호(익명은 끈다), 승인된 도메인 추가
#  4) Firestore 보안 규칙 게시 (firestore.rules)
#  5) 웹 앱 설정값을 받아 firebase-config.js 자동 작성
#  6) GitHub 저장소에 올리기 (토큰을 넣었을 때)
# 사용법: 저장소를 받은 폴더에서  bash setup-cloudshell.sh [프로젝트ID]
# ─────────────────────────────────────────────────────────────
set -uo pipefail
REPO_PATH="CLOSEGATE/closegate.github.io"
SITE_DOMAIN="closegate.github.io"
LOCATION="asia-northeast3"

say(){ printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok(){ printf '  \033[1;32m✔ %s\033[0m\n' "$*"; }
warn(){ printf '  \033[1;33m! %s\033[0m\n' "$*"; }
die(){ printf '  \033[1;31m✘ %s\033[0m\n' "$*"; exit 1; }

cd "$(dirname "$0")"
[ -f firestore.rules ] || die "firestore.rules가 없다. 저장소 폴더 안에서 실행해야 한다."

# ── 0. 프로젝트 고르기
say "Firebase 프로젝트 확인"
P="${1:-$(gcloud config get-value project 2>/dev/null)}"
if [ -z "$P" ] || [ "$P" = "(unset)" ]; then
  gcloud projects list --format="table(projectId,name)"
  read -rp "  위 목록에서 PROJECT_ID를 입력: " P
fi
gcloud config set project "$P" >/dev/null 2>&1 || die "프로젝트 $P 에 접근할 수 없다."
ok "프로젝트: $P"
TOKEN=$(gcloud auth print-access-token) || die "gcloud 로그인 정보가 없다."
api(){ curl -sS -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $P" -H "Content-Type: application/json" "$@"; }
jget(){ python3 -c "import sys,json
try: d=json.load(sys.stdin)
except Exception: d={}
$1"; }

# ── 1. API 켜기
say "필요한 API 켜기 (처음이면 1~2분 걸린다)"
gcloud services enable firestore.googleapis.com identitytoolkit.googleapis.com \
  firebaserules.googleapis.com firebase.googleapis.com --project "$P" && ok "API 준비 완료"

# ── 2. Firestore
say "Firestore 데이터베이스"
if gcloud firestore databases describe --database='(default)' --project "$P" >/dev/null 2>&1; then
  ok "이미 있다"
else
  gcloud firestore databases create --location="$LOCATION" --project "$P" >/dev/null && ok "서울 리전에 만들었다" || die "Firestore를 만들지 못했다."
fi

# ── 3. 로그인 방법 · 승인된 도메인
say "로그인 켜기 (이메일/비밀번호만)"
CUR=$(api "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config")
if echo "$CUR" | grep -q '"error"'; then
  warn "Authentication이 아직 시작되지 않았다. Firebase 콘솔 → Authentication → 시작하기를 한 번 누른 뒤 다시 실행한다."
  echo "$CUR" | head -5; exit 1
fi
BODY=$(echo "$CUR" | jget "
doms=d.get('authorizedDomains',[])
for x in ['localhost','$P.firebaseapp.com','$P.web.app','$SITE_DOMAIN']:
    if x not in doms: doms.append(x)
print(json.dumps({'signIn':{'email':{'enabled':True,'passwordRequired':True},'anonymous':{'enabled':False}},'authorizedDomains':doms}))")
R=$(api -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired,signIn.anonymous.enabled,authorizedDomains" -d "$BODY")
if echo "$R" | grep -q '"signIn"'; then ok "이메일/비밀번호 사용 설정(익명 끔), 승인된 도메인에 $SITE_DOMAIN 추가"; else warn "로그인 설정 실패"; echo "$R" | head -8; fi

# ── 4. 보안 규칙
say "Firestore 보안 규칙 게시"
RULES=$(python3 -c 'import json;print(json.dumps({"source":{"files":[{"name":"firestore.rules","content":open("firestore.rules",encoding="utf-8").read()}]}}))')
RS=$(api -X POST "https://firebaserules.googleapis.com/v1/projects/$P/rulesets" -d "$RULES" | jget "print(d.get('name',''))")
[ -n "$RS" ] || die "규칙 파일을 올리지 못했다. firestore.rules 문법을 확인한다."
REL="projects/$P/releases/cloud.firestore"
R=$(api -X PATCH "https://firebaserules.googleapis.com/v1/$REL" -d "{\"release\":{\"name\":\"$REL\",\"rulesetName\":\"$RS\"}}")
if ! echo "$R" | grep -q rulesetName; then
  R=$(api -X POST "https://firebaserules.googleapis.com/v1/projects/$P/releases" -d "{\"name\":\"$REL\",\"rulesetName\":\"$RS\"}")
fi
echo "$R" | grep -q rulesetName && ok "규칙 게시 완료" || { warn "규칙 게시 실패"; echo "$R" | head -8; }

# ── 4-2. Realtime Database 규칙 (접속 신호용, v35.58)
RTDB="https://${P}-default-rtdb.asia-southeast1.firebasedatabase.app"
RTRULES='{"rules":{".read":false,".write":false,"presence":{".read":"auth != null","$uid":{".write":"auth != null && auth.uid === $uid",".validate":"!newData.exists() || (newData.hasChildren([\"t\"]) && newData.child(\"t\").isNumber())"}}}}'
RTTOKEN=$(gcloud auth print-access-token --scopes=https://www.googleapis.com/auth/firebase.database,https://www.googleapis.com/auth/userinfo.email 2>/dev/null || echo "$TOKEN")
RR=$(curl -sS -X PUT -H "Authorization: Bearer $RTTOKEN" -H "Content-Type: application/json" "$RTDB/.settings/rules.json" -d "$RTRULES" 2>&1)
if echo "$RR" | grep -q '"status" *: *"ok"'; then ok "실시간 데이터베이스 규칙 게시 완료"
else
  warn "실시간 데이터베이스 규칙을 자동으로 올리지 못했다. 처음 한 번만 직접 붙여 넣으면 된다."
  echo "   Firebase 콘솔 → Realtime Database → 규칙 탭에 아래 내용을 붙여 넣고 [게시]를 누른다."
  echo "$RTRULES" | python3 -m json.tool
  echo "   (그 전까지는 게임이 자동으로 예전 방식(Firestore)으로 접속 신호를 보낸다.)"
fi

# ── 5. 웹 앱 설정값
say "웹 앱 설정값 받기"
APP=$(api "https://firebase.googleapis.com/v1beta1/projects/$P/webApps" | jget "a=d.get('apps',[]);print(a[0]['appId'] if a else '')")
if [ -z "$APP" ]; then
  OP=$(api -X POST "https://firebase.googleapis.com/v1beta1/projects/$P/webApps" -d '{"displayName":"closegate"}' | jget "print(d.get('name',''))")
  [ -n "$OP" ] || die "웹 앱을 만들지 못했다."
  for i in $(seq 1 40); do
    R=$(api "https://firebase.googleapis.com/v1beta1/$OP")
    APP=$(echo "$R" | jget "print(d.get('response',{}).get('appId','') if d.get('done') else '')")
    [ -n "$APP" ] && break; sleep 2
  done
  [ -n "$APP" ] || die "웹 앱 생성이 끝나지 않았다. 잠시 뒤 다시 실행한다."
  ok "웹 앱을 새로 등록했다"
fi
CFG=$(api "https://firebase.googleapis.com/v1beta1/projects/$P/webApps/$APP/config")
echo "$CFG" | jget "
keys=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId']
if not d.get('apiKey'): sys.exit(1)
print('/* Cloud Shell 설정 스크립트가 자동으로 채운 값이다. 웹에 공개되어도 괜찮은 값이며, 데이터는 firestore.rules가 지킨다. */')
print('window.FIREBASE_CONFIG = '+json.dumps({k:d.get(k,'') for k in keys},indent=2,ensure_ascii=False)+';')" > firebase-config.js.new \
  && mv firebase-config.js.new firebase-config.js && ok "firebase-config.js 작성 완료" || die "설정값을 받지 못했다."
cat firebase-config.js

# ── 6. GitHub에 올리기
say "GitHub 저장소에 올리기"
git config user.name  >/dev/null 2>&1 || git config user.name  "closegate-setup"
git config user.email >/dev/null 2>&1 || git config user.email "setup@closegate.game"
git add -A
if git diff --cached --quiet; then
  ok "올릴 변경 사항이 없다"
else
  git commit -qm "클로즈 게이트 업데이트 $(date +%Y-%m-%d)" && ok "커밋 완료"
  echo "  GitHub 토큰을 붙여 넣습니다. 입력한 글자는 *로 표시됩니다. 그냥 Enter를 누르면 건너뜁니다."
  GT=""; printf "  GitHub 토큰: "
  while IFS= read -rsn1 ch; do
    [[ -z "$ch" ]] && break                                   # Enter
    if [[ "$ch" == $'\x7f' || "$ch" == $'\b' ]]; then          # 지우기
      [[ -n "$GT" ]] && { GT="${GT%?}"; printf '\b \b'; }
    else GT+="$ch"; printf '*'; fi
  done; echo
  if [[ -n "$GT" ]]; then
    printf "  \033[1;32m✔ 토큰 입력됨\033[0m: %s…%s (%d자)\n" "${GT:0:4}" "${GT: -4}" "${#GT}"
  else echo "  토큰을 넣지 않아 GitHub 올리기를 건너뜁니다."; fi
  if [ -n "$GT" ]; then
    if git push -q "https://x-access-token:${GT}@github.com/${REPO_PATH}.git" HEAD:main; then
      ok "올리기 완료. 1~2분 뒤 https://${SITE_DOMAIN}/ 을 새로고침한다."
    else
      warn "올리지 못했다. 토큰 권한(repo 또는 Contents 쓰기)을 확인한다."
    fi
  else
    warn "건너뛰었다. 위에 나온 firebase-config.js 내용을 GitHub에서 직접 붙여 넣으면 된다."
  fi
fi
say "끝"
