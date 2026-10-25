/* Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹 앱) → "SDK 설정 및 구성"에 나오는 값을 그대로 붙여 넣는다.
   이 값은 웹페이지에 공개되어도 괜찮은 값이다. 데이터 보호는 firestore.rules가 맡는다. */
window.FIREBASE_CONFIG = {
  apiKey: "여기에_apiKey",
  authDomain: "여기에_프로젝트ID.firebaseapp.com",
  projectId: "여기에_프로젝트ID",
  storageBucket: "여기에_프로젝트ID.appspot.com",
  messagingSenderId: "여기에_숫자",
  appId: "여기에_appId"
};
