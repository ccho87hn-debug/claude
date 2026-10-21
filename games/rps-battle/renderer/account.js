// Player accounts on Firebase: sign up / log in with a nickname and password, and keep coins and
// the win/loss record in the Realtime Database (users/{uid}) so they follow the player to any computer.
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyCL5Da4204mDC2M4xB7ebVZg89jvKwp5D0",
    authDomain: "gawi-bawi-bo.firebaseapp.com",
    projectId: "gawi-bawi-bo",
    storageBucket: "gawi-bawi-bo.firebasestorage.app",
    messagingSenderId: "80984345707",
    appId: "1:80984345707:web:1ff0137522815c6c5b752e",
    databaseURL: "https://gawi-bawi-bo-default-rtdb.asia-southeast1.firebasedatabase.app",
  };
  const START_COINS = 1000;
  // Firebase signs people in by email, so each nickname maps to a made-up address nobody receives mail at.
  // Hex-encoding keeps Korean nicknames valid and makes them case-insensitive.
  const EMAIL_DOMAIN = "players.gawi-bawi-bo.app";
  const NAME_RULE = /^[가-힣a-zA-Z0-9_]{2,10}$/;

  let auth = null;
  let db = null;
  let uid = null;
  function init() {
    if (auth) return;
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();
  }

  function toEmail(name) {
    const hex = [...new TextEncoder().encode(name.toLowerCase())].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `u${hex}@${EMAIL_DOMAIN}`;
  }

  const ERRORS = {
    "auth/email-already-in-use": "이미 있는 아이디예요. 다른 아이디를 써 주세요.",
    "auth/invalid-credential": "아이디나 비밀번호가 틀렸어요.",
    "auth/invalid-login-credentials": "아이디나 비밀번호가 틀렸어요.",
    "auth/wrong-password": "아이디나 비밀번호가 틀렸어요.",
    "auth/user-not-found": "아이디나 비밀번호가 틀렸어요.",
    "auth/weak-password": "비밀번호는 6자 이상으로 해 주세요.",
    "auth/too-many-requests": "너무 많이 시도했어요. 잠시 후 다시 해 주세요.",
    "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
    "auth/operation-not-allowed": "Firebase에서 이메일/비밀번호 로그인이 꺼져 있어요.",
    "auth/configuration-not-found": "Firebase에서 Authentication이 아직 켜지지 않았어요.",
    timeout: "기록 서버에 접속하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.",
    PERMISSION_DENIED: "Firebase Realtime Database 규칙이 아직 설정되지 않았어요.",
  };
  const friendly = (err) => new Error(ERRORS[err && err.code] || "로그인 서버에 문제가 생겼어요. 잠시 후 다시 해 주세요.");

  function checkInput(name, password) {
    if (!NAME_RULE.test(name)) return "아이디는 한글, 영어, 숫자로 2~10자예요.";
    if (!password || password.length < 6) return "비밀번호는 6자 이상이에요.";
    return "";
  }

  const userRef = () => db.ref(`users/${uid}`);

  // The database waits quietly while offline, so give up after a while instead of spinning forever.
  function withTimeout(promise, ms = 12000) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject({ code: "timeout" }), ms))]);
  }

  // Reads the signed-in player's profile, creating it on first sign-in.
  async function loadProfile(name) {
    const ref = userRef();
    const snap = await withTimeout(ref.get());
    if (snap.exists()) return snap.val();
    const profile = { name, coins: START_COINS, wins: 0, losses: 0, best: 0 };
    await withTimeout(ref.set({ ...profile, created: firebase.database.ServerValue.TIMESTAMP }));
    return profile;
  }

  async function signUp(name, password) {
    init();
    const bad = checkInput(name, password);
    if (bad) throw new Error(bad);
    try {
      const cred = await auth.createUserWithEmailAndPassword(toEmail(name), password);
      await cred.user.updateProfile({ displayName: name });
      uid = cred.user.uid;
      return await loadProfile(name);
    } catch (e) {
      throw friendly(e);
    }
  }

  async function logIn(name, password) {
    init();
    const bad = checkInput(name, password);
    if (bad) throw new Error(bad);
    try {
      const cred = await auth.signInWithEmailAndPassword(toEmail(name), password);
      uid = cred.user.uid;
      return await loadProfile(cred.user.displayName || name);
    } catch (e) {
      throw friendly(e);
    }
  }

  // Resolves with the profile of whoever is still signed in from last time, or null.
  function restore() {
    init();
    return new Promise((resolve) => {
      const stop = auth.onAuthStateChanged(async (user) => {
        stop();
        if (!user) return resolve(null);
        uid = user.uid;
        try {
          resolve(await loadProfile(user.displayName || "손님"));
        } catch {
          resolve(null);
        }
      });
    });
  }

  async function logOut() {
    uid = null;
    if (auth) await auth.signOut();
  }

  // Saves coins and record. Writes are queued so a quick burst of saves lands in order.
  let pending = Promise.resolve();
  function save({ coins, wins, losses, best }) {
    if (!uid) return pending;
    const ref = userRef();
    pending = pending.then(() => ref.update({ coins, wins, losses, best })).catch((e) => console.error("save failed", e));
    return pending;
  }

  window.Account = { signUp, logIn, logOut, restore, save, checkInput, signedIn: () => !!uid };
})();
