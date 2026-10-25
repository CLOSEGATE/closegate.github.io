/* 클로즈 게이트 ↔ Firebase 연결 파일
   게임 코드는 claude.ai의 window.claude.use('db' | 'user' | 'room')를 부르도록 만들어져 있다.
   이 파일은 같은 모양의 함수를 Firebase(Authentication + Firestore)로 만들어 넘겨준다.
   - db   : Firestore 문서 읽기·쓰기·실시간 구독, 짧은 잠금(acquire)
   - user : 로그인한 사람의 uid (로그인 전에는 null)
   - room : 지금 접속한 요원 목록(presence 컬렉션에 40초마다 신호를 남긴다) */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut}
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,deleteDoc,onSnapshot,collection,query,where,runTransaction}
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const done=v=>{if(window.__fbResolve){window.__fbResolve(v);window.__fbResolve=null}};
const cfg=window.FIREBASE_CONFIG;
if(!cfg||!cfg.apiKey||/여기|YOUR_/i.test(cfg.apiKey)){
  console.warn('[클로즈 게이트] firebase-config.js가 비어 있어 혼자 플레이로 실행한다.');done(null);
}else{
  try{boot()}catch(e){console.error(e);done(null)}
}

function boot(){
  const app=initializeApp(cfg),auth=getAuth(app),fs=getFirestore(app);
  const MAIL='@closegate.game',toMail=id=>String(id).toLowerCase()+MAIL;
  const uid=()=>auth.currentUser?auth.currentUser.uid:null;

  /* ── db ── */
  const ref=p=>doc(fs,...p.split('/'));
  const wrap=s=>({id:s.id,exists:s.exists(),data:()=>s.data(),metadata:{fromCache:s.metadata.fromCache}});
  async function acquire(p,{holder,ttlMs}){
    const lr=doc(fs,'locks',p.replace(/\//g,'__'));
    try{return await runTransaction(fs,async tx=>{
      const s=await tx.get(lr),now=Date.now(),d=s.exists()?s.data():null;
      if(d&&d.until>now&&d.holder!==holder)return {acquired:false};
      tx.set(lr,{holder,until:now+(ttlMs||6000)});return {acquired:true};
    })}catch(e){return {acquired:false}}
  }
  const db={
    doc:p=>{const r=ref(p);return {
      get:async()=>wrap(await getDoc(r)),
      set:v=>setDoc(r,v),
      update:v=>setDoc(r,v,{merge:true}),           // 중첩된 맵(contrib 등)은 합쳐서 저장
      onSnapshot:(cb,err)=>onSnapshot(r,s=>cb(wrap(s)),err),
      acquire:o=>acquire(p,o||{})}},
    collection:name=>{const qs=[];const api={
      where:(f,op,v)=>{qs.push(where(f,op,v));return api},
      onSnapshot:(cb,err)=>onSnapshot(query(collection(fs,name),...qs),s=>cb({docs:s.docs.map(d=>({id:d.id,data:()=>d.data()})),metadata:{fromCache:s.metadata.fromCache}}),err)};
      return api}
  };

  /* ── user ── */
  const user={id:async()=>uid(),can:()=>true,canEdit:()=>false,isOwner:()=>false};

  /* ── room: 접속 중인 요원 ── */
  let lastP=null,peersCb=null,peerDocs=[],myDoc=null;
  const STALE=90000;
  const emit=()=>{if(!peersCb)return;const now=Date.now(),me=uid();
    peersCb({peers:peerDocs.filter(d=>now-(d.t||0)<STALE).map(d=>({kind:'viewer',isMe:d.id===me,presence:d.p,peer:d.id}))})};
  const beat=()=>{const me=uid();if(!me||!lastP)return Promise.resolve();myDoc=me;return setDoc(doc(fs,'presence',me),{p:lastP,t:Date.now()}).catch(()=>{})};
  setInterval(beat,40000);setInterval(emit,15000);
  addEventListener('pagehide',()=>{if(myDoc)deleteDoc(doc(fs,'presence',myDoc)).catch(()=>{})});
  const room={
    presence:p=>{lastP=JSON.parse(JSON.stringify(p));return beat()},
    onPeers:cb=>{peersCb=cb;return onSnapshot(collection(fs,'presence'),s=>{peerDocs=s.docs.map(d=>({id:d.id,...d.data()}));emit()},()=>{})}
  };

  /* ── 아이디 · 비밀번호 계정 (이메일 대신 아이디@closegate.game을 쓴다. 메일은 보내지 않는다) ── */
  window.closeGateAuth={
    isMember:()=>!!(auth.currentUser&&auth.currentUser.providerData.some(p=>p.providerId==='password')),
    name:()=>{const e=auth.currentUser&&auth.currentUser.email||'';return e.endsWith(MAIL)?e.slice(0,-MAIL.length):e},
    createAccount:async(id,pw)=>(await createUserWithEmailAndPassword(auth,toMail(id),pw)).user.uid,
    signIn:async(id,pw)=>(await signInWithEmailAndPassword(auth,toMail(id),pw)).user.uid,
    signOut:async()=>{const me=uid();if(me)await deleteDoc(doc(fs,'presence',me)).catch(()=>{});await signOut(auth)}
  };

  /* 로그인 상태가 정해지면 게임에 넘긴다. 로그인하지 않은 사람은 게임이 계정 화면에서 멈춰 둔다. */
  let first=true;
  onAuthStateChanged(auth,()=>{if(first){first=false;done({db,user,room})}});
}
