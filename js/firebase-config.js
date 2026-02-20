import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRzC-QDE0-UXd-XL0i3iqayFiKcc6wmvc",
  authDomain: "fantasyasapp.firebaseapp.com",
  projectId: "fantasyasapp",
  storageBucket: "fantasyasapp.appspot.com",
  messagingSenderId: "721763921060",
  appId: "1:721763921060:web:3d61044ea2424e8176ca31"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
