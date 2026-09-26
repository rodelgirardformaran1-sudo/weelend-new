import { defineConfig } from "vite";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 🔄 One build ID per `npm run build`, baked into the JS bundle AND
// written to dist/version.json. The app polls version.json at runtime
// (see src/utils/updateNudge.ts) and shows an "Update available" banner
// when the two no longer match — this is what catches a stale iOS PWA
// home-screen icon that's still running yesterday's build.
const buildId = String(Date.now());

export default defineConfig({
  base: "/",   // Required for Firebase Hosting

  define: {
    __DEFINES__: {},   // ✅ This fixes the runtime crash
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },

  plugins: [
    {
      name: "write-version-json",
      closeBundle() {
        writeFileSync(
          resolve(__dirname, "dist/version.json"),
          JSON.stringify({ buildId })
        );
      },
    },
  ],
});
