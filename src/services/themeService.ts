import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

const THEME_KEY = "weelend-theme-cache";

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
}

export async function initTheme(userId: string) {
  // 1️⃣ Apply cached theme instantly
  const cached = localStorage.getItem(THEME_KEY);
  if (cached) {
    applyTheme(cached);
  }

  // 2️⃣ Load Firestore theme
  try {
    const snap = await getDoc(doc(db, "users", userId));
    const theme = snap.data()?.theme || "purple";

    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    console.error("Theme load failed:", err);
  }
}

export async function saveTheme(userId: string, theme: string) {
  try {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);

    await updateDoc(doc(db, "users", userId), { theme });
  } catch (err) {
    console.error("Theme save failed:", err);
  }
}