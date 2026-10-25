# 클로즈 게이트 — GitHub Pages + Firebase 배포 안내

게임 화면은 **GitHub Pages**에 올리고, 함께 닫는 게이트·레이드·접속 요원·계정 기록은 **Firebase**에 저장한다.
모두 같은 주소(`https://아이디.github.io/저장소이름/`)로 접속하면 같은 게이트와 레이드를 함께 진행한다.

## 폴더 구성

| 파일 | 하는 일 |
|---|---|
| `index.html` | 게임 본체 |
| `firebase-config.js` | 내 Firebase 프로젝트 정보. **직접 채워 넣어야 하는 유일한 파일** |
| `firebase-adapter.js` | 게임과 Firebase를 이어 주는 파일. 고칠 필요 없음 |
| `firestore.rules` | Firestore 보안 규칙. Firebase 콘솔에 붙여 넣는다 |

## 1. Firebase 프로젝트 만들기

1. <https://console.firebase.google.com> 에서 **프로젝트 추가**를 누른다. 이름은 자유(예: `closegate`). 애널리틱스는 꺼도 된다.
2. 프로젝트 첫 화면에서 웹 아이콘 **`</>`** 을 눌러 웹 앱을 등록한다. "Firebase 호스팅 설정"은 체크하지 않는다.
3. 화면에 나오는 `firebaseConfig = { ... }` 값을 `firebase-config.js`의 `window.FIREBASE_CONFIG = { ... }` 안에 그대로 옮겨 적는다.
   (나중에 다시 보려면: 톱니바퀴 → 프로젝트 설정 → 일반 → 내 앱)

## 2. 로그인 켜기 (Authentication)

1. 왼쪽 메뉴 **보안 → Authentication → 시작하기**.
2. **로그인 방법** 탭에서 두 가지를 사용 설정한다.
   - **이메일/비밀번호**: 첫 번째 스위치(이메일/비밀번호)만 켜고, 아래 "이메일 링크(비밀번호가 없는 로그인)"는 끈 채로 저장한다.
     게임에서는 이메일 대신 **아이디**를 입력한다. 내부적으로 `아이디@closegate.game`으로 저장되며 메일은 보내지 않는다.
   - **익명**: 계정 없이 들어온 게스트도 게이트와 레이드에 참여하려면 필요하다.
3. 아이디는 영문 소문자·숫자·밑줄(_) 4~16자, 비밀번호는 6자 이상이다.
4. 이메일이 없으므로 **비밀번호 찾기는 안 된다.** 잊은 사람이 생기면 Authentication → 사용자에서 그 계정을 삭제하고 다시 만들게 해야 한다(저장 기록은 사라진다).

## 3. 데이터베이스 만들기 (Firestore)

1. **빌드 → Firestore Database → 데이터베이스 만들기**.
2. 위치는 `asia-northeast3 (서울)`을 고르고, **프로덕션 모드**로 시작한다.
3. **규칙** 탭을 열어 기존 내용을 지우고 `firestore.rules` 파일 내용을 통째로 붙여 넣은 뒤 **게시**한다.

## 4. GitHub Pages에 올리기

1. GitHub에서 새 저장소를 만든다(예: `closegate`, **Public**).
2. **Add file → Upload files**로 이 폴더의 파일을 모두 올리고 Commit 한다. (`index.html`이 저장소 맨 위에 있어야 한다.)
3. 저장소의 **Settings → Pages**에서 Source를 `Deploy from a branch`, Branch를 `main` / `/ (root)`로 정하고 Save.
4. 1~2분 뒤 `https://아이디.github.io/closegate/` 주소가 열린다.

## 5. 승인된 도메인 추가 (권장)

Firebase 콘솔 **Authentication → 설정 → 승인된 도메인 → 도메인 추가**에 `아이디.github.io`를 넣어 둔다.

## 6. 확인

- 주소를 열고 오른쪽 위에 **온라인 · N명 접속**이 보이면 연결 성공이다. "혼자 플레이"로 보이면 `firebase-config.js` 값을 다시 확인한다.
- 다른 기기(또는 시크릿 창)에서 같은 주소를 열고 같은 게이트에 출동하면, 요원 탭과 게이트 위 숫자에 서로가 보인다.

## 알아 두면 좋은 점

- **비용**: 무료 요금제(Spark)로 충분하다. 접속한 사람마다 40초에 한 번 접속 신호를 쓰므로, 수십 명이 동시에 오래 켜 두지 않는 한 무료 한도(하루 쓰기 2만 회, 읽기 5만 회) 안에 든다.
- **config 공개**: `firebase-config.js`의 값은 공개되어도 괜찮다. 데이터는 `firestore.rules`가 지킨다. 개인 기록은 본인만 읽고 쓸 수 있다.
- **치트**: 게이트·레이드 진행도는 로그인한 사람 누구나 쓸 수 있게 열어 두었다. 친구끼리 하기에는 충분하지만, 불특정 다수에게 공개하려면 서버 검증(Cloud Functions)이 필요하다.
- **업데이트**: 게임을 고친 뒤에는 `index.html`만 새 파일로 바꿔 올리면 된다. 기록과 진행 중인 게이트는 Firebase에 그대로 남는다.
- **claude.ai 판과는 데이터가 따로**다. claude.ai에서 하던 기록은 그쪽에만 남는다.
