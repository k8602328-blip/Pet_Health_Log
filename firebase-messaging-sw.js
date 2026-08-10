// ③投薬リマインダー用のFCM Service Worker。
// サイトのルート直下に置く必要がある(プッシュ通知のスコープがそこになるため)。
// ここに書くfirebaseConfigはクライアント側のindex.htmlと同じ値(公開情報なので問題ない)。

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAXekz_f6TKwi-fgiTm856ZfQsEtadR6UA",
  authDomain: "pet-health-log-8dba7.firebaseapp.com",
  projectId: "pet-health-log-8dba7",
  storageBucket: "pet-health-log-8dba7.firebasestorage.app",
  messagingSenderId: "594019463341",
  appId: "1:594019463341:web:dd13840661b6d083add624",
});

// notificationペイロード付きで送信しているため、バックグラウンド時はSDKが自動で
// OS通知を表示する。ここでは追加のハンドラは不要。
firebase.messaging();
