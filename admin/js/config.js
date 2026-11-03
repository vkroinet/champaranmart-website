// Public Firebase web config (this is not a secret: access is protected by the Firestore and Storage rules).
// apiKey: replace with the key of the "Champaran Mart Web" app (Firebase console > Project settings > Your apps)
// appId:  same place. Auth, Firestore, Storage and Functions work without it, but fill it in once you have it.
export const firebaseConfig = {
  apiKey: "AIzaSyBLevODuKeqYkWCrQv-NXcnJRDykPNr5PA",
  authDomain: "fatafat-mart.firebaseapp.com",
  projectId: "fatafat-mart",
  storageBucket: "fatafat-mart.firebasestorage.app",
  messagingSenderId: "434577442563",
  appId: ""
};

export const FUNCTIONS_REGION = "asia-south2";
