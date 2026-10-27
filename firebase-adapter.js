/* 클로즈 게이트 ↔ Firebase 연결 파일
   게임 코드는 claude.ai의 window.claude.use('db' | 'user' | 'room')를 부르도록 만들어져 있다.
   이 파일은 같은 모양의 함수를 Firebase(Authentication + Firestore)로 만들어 넘겨준다.
   - db   : Firestore 문서 읽기·쓰기·실시간 구독, 짧은 잠금(acquire)
   - user : 로그인한 사람의 uid (로그인 전에는 null)
   - room : 지금 접속한 요원 목록(presence 컬렉션. 바뀔 때만 신호, 목록은 2분마다 읽기, 같은 게이트는 실시간) */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut}
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {getFirestore,initializeFirestore,persistentLocalCache,persistentMultipleTabManager,doc,getDoc,getDocs,setDoc,deleteDoc,onSnapshot,collection,query,where,runTransaction}
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const done=v=>{if(window.__fbResolve){window.__fbResolve(v);window.__fbResolve=null}};
const cfg=window.FIREBASE_CONFIG;
if(!cfg||!cfg.apiKey||/여기|YOUR_/i.test(cfg.apiKey)){
  console.warn('[클로즈 게이트] firebase-config.js가 비어 있어 혼자 플레이로 실행한다.');done(null);
}else{
  try{boot()}catch(e){console.error(e);done(null)}
}

function boot(){
  const app=initializeApp(cfg),auth=getAuth(app);
  /* 오프라인 저장소: 쓰기를 기기 안 데이터베이스(IndexedDB)에 먼저 기록하고 서버 전송은 뒤에서 이어 갑니다.
     여러 탭을 열어도 함께 쓸 수 있게 합니다. 사생활 보호 모드처럼 기기 저장소를 못 쓰면 예전 방식으로 돌아갑니다. */
  let fs;
  try{fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}
  catch(e){console.warn('[클로즈 게이트] 오프라인 저장소를 쓸 수 없어 기본 방식으로 연결합니다.',e);fs=getFirestore(app)}
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
    /* 트랜잭션: 읽기를 먼저 모두 한 뒤 쓰기. 다른 곳에서 그 사이에 바꾸면 Firestore가 자동으로 다시 시도한다 */
    tx:fn=>runTransaction(fs,async t=>fn({get:async p=>wrap(await t.get(ref(p))),set:(p,v)=>{t.set(ref(p),v)}})),
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
  const STALE=330000;/* v35.55: 접속 신호를 2분마다만 보내므로, 5분 넘게 신호가 없을 때만 나간 것으로 봅니다 */
  /* v35.58 접속 신호는 Realtime Database(횟수 제한 없음)에 둡니다. 쓸 수 없으면(데이터베이스 · 규칙 미설정) Firestore 방식으로 돌아갑니다 */
  const RT_URL=cfg.databaseURL||'https://close-gate-kr-default-rtdb.asia-southeast1.firebasedatabase.app';
  let RT=null,rtMode='pending',rtSub=null,rtDisc=false;
  const rtOff=()=>{rtMode='off';if(rtSub){try{rtSub()}catch(e){}rtSub=null}if(peersCb){poll();if(!pollT)pollT=setInterval(poll,120000)}};
  const rtListen=()=>{if(!RT||!peersCb||rtSub||rtMode==='off')return;
    rtSub=RT.m.onValue(RT.m.ref(RT.db,'presence'),snap=>{if(rtMode!=='on'){rtMode='on';if(pollT){clearInterval(pollT);pollT=null}if(gateSub){gateSub();gateSub=null}gateId=null}
      const v=snap.val()||{};peerDocs=Object.keys(v).map(id=>({id,...v[id]}));emit()},()=>rtOff())};
  import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js').then(m=>{RT={m,db:m.getDatabase(app,RT_URL)};rtListen()}).catch(()=>rtOff());
  /* v35.59 채팅 등 게임이 쓰는 실시간 데이터베이스 기능. 접속 신호가 실시간 데이터베이스로 잘 돌 때만 ready()가 참입니다 */
  db.rt={
    ready:()=>!!RT&&rtMode==='on',
    listen:(path,n,cb)=>{if(!RT)return()=>{};const q=RT.m.query(RT.m.ref(RT.db,path),RT.m.orderByChild('t'),RT.m.limitToLast(n||60));
      return RT.m.onValue(q,s=>{const v=s.val()||{};cb(Object.keys(v).map(k=>({id:k,...v[k]})))},()=>cb(null))},
    push:(path,v)=>RT?RT.m.push(RT.m.ref(RT.db,path),v):Promise.reject(new Error('rt')),
    update:(path,v)=>RT?RT.m.update(RT.m.ref(RT.db,path),v):Promise.reject(new Error('rt')),
    set:(path,v)=>RT?RT.m.set(RT.m.ref(RT.db,path),v):Promise.reject(new Error('rt'))
  };
  const emit=()=>{if(!peersCb)return;const now=Date.now(),me=uid();
    peersCb({peers:peerDocs.filter(d=>now-(d.t||0)<(rtMode==='on'?600000:STALE)).map(d=>({kind:'viewer',isMe:d.id===me,presence:d.p,peer:d.id}))})};
  /* v35.55 사용량 절약: 내용이 바뀌었을 때만, 그리고 15초에 한 번까지만 씁니다. 바뀐 게 없으면 2분마다 살아 있다는 신호만 보냅니다 */
  let lastSent='',lastAt=0,pend=null;
  const write=()=>{const me=uid();if(!me||!lastP)return Promise.resolve();myDoc=me;lastSent=JSON.stringify(lastP);lastAt=Date.now();const v={p:lastP,t:lastAt,g:lastP.gate||null};
    if(RT&&rtMode!=='off'){const r=RT.m.ref(RT.db,'presence/'+me);if(!rtDisc){rtDisc=true;try{RT.m.onDisconnect(r).remove()}catch(e){}}
      return RT.m.set(r,JSON.parse(JSON.stringify(v))).catch(()=>{rtOff();return setDoc(doc(fs,'presence',me),v).catch(()=>{})})}
    return setDoc(doc(fs,'presence',me),v).catch(()=>{})};
  const beat=()=>{const k=JSON.stringify(lastP);if(k===lastSent&&Date.now()-lastAt<110000)return Promise.resolve();
    const wait=15000-(Date.now()-lastAt);if(wait>0){if(!pend)pend=setTimeout(()=>{pend=null;write()},wait);return Promise.resolve()}return write()};
  setInterval(()=>{if(Date.now()-lastAt>=110000)write()},120000);setInterval(emit,15000);
  addEventListener('pagehide',()=>{if(!myDoc)return;if(RT&&rtMode==='on')RT.m.remove(RT.m.ref(RT.db,'presence/'+myDoc)).catch(()=>{});else deleteDoc(doc(fs,'presence',myDoc)).catch(()=>{})});
  /* v35.57 사용량 절약: 접속자 전체 목록은 2분마다 한 번 읽고(실시간 구독 안 함),
     내가 게이트를 공략 중일 때만 같은 게이트에 있는 요원을 실시간으로 받습니다. 읽기가 접속자 수의 제곱으로 늘던 문제를 줄입니다 */
  let allDocs=[],gateDocs=[],gateSub=null,gateId=null,pollT=null;
  const mergeDocs=()=>{const m=new Map(allDocs.filter(d=>!(gateSub&&d.g===gateId)).map(d=>[d.id,d]));gateDocs.forEach(d=>m.set(d.id,d));peerDocs=[...m.values()];emit()};
  const poll=()=>{if(document.hidden&&allDocs.length)return;getDocs(query(collection(fs,'presence'),where('t','>',Date.now()-STALE))).then(s=>{allDocs=s.docs.map(d=>({id:d.id,...d.data()}));mergeDocs()}).catch(()=>{})};
  const watchGate=id=>{if(rtMode==='on'||id===gateId)return;gateId=id;if(gateSub){gateSub();gateSub=null}gateDocs=[];
    if(id)gateSub=onSnapshot(query(collection(fs,'presence'),where('g','==',id)),s=>{gateDocs=s.docs.map(d=>({id:d.id,...d.data()}));mergeDocs()},()=>{});else mergeDocs()};
  const room={
    presence:p=>{lastP=JSON.parse(JSON.stringify(p));watchGate(lastP.gate||null);return beat()},
    onPeers:cb=>{peersCb=cb;if(rtMode!=='on'){poll();if(!pollT)pollT=setInterval(poll,120000)}rtListen();document.addEventListener('visibilitychange',()=>{if(!document.hidden&&rtMode!=='on')poll()});return()=>{}}
  };

  /* ── 아이디 · 비밀번호 계정 (이메일 대신 아이디@closegate.game을 쓴다. 메일은 보내지 않는다) ── */
  window.closeGateAuth={
    isMember:()=>!!(auth.currentUser&&auth.currentUser.providerData.some(p=>p.providerId==='password')),
    name:()=>{const e=auth.currentUser&&auth.currentUser.email||'';return e.endsWith(MAIL)?e.slice(0,-MAIL.length):e},
    createAccount:async(id,pw)=>(await createUserWithEmailAndPassword(auth,toMail(id),pw)).user.uid,
    signIn:async(id,pw)=>(await signInWithEmailAndPassword(auth,toMail(id),pw)).user.uid,
    signOut:async()=>{const me=uid();if(me){await deleteDoc(doc(fs,'presence',me)).catch(()=>{});if(RT)await RT.m.remove(RT.m.ref(RT.db,'presence/'+me)).catch(()=>{})}await signOut(auth)}
  };

  /* 로그인 상태가 정해지면 게임에 넘긴다. 로그인하지 않은 사람은 게임이 계정 화면에서 멈춰 둔다. */
  let first=true;
  onAuthStateChanged(auth,()=>{if(first){first=false;done({db,user,room})}});
}
