<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
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
