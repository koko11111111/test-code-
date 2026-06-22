// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDklnZRCFnxxHLP_MV6j4_ZR5vykY1LQ0E",
  authDomain: "relay-8a807.firebaseapp.com",
  projectId: "relay-8a807",
  storageBucket: "relay-8a807.firebasestorage.app",
  messagingSenderId: "219719482946",
  appId: "1:219719482946:web:967caac406eb31131df7db",
  measurementId: "G-B5WEX4SY8S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
