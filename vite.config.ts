import { defineConfig } from "vite";

export default defineConfig({
  base: "/",   // Required for Firebase Hosting

  define: {
    __DEFINES__: {},   // ✅ This fixes the runtime crash
  },
});
