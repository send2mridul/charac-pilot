/* Remove stale Next.js output (fixes missing webpack chunks like ./191.js). */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "apps", "web", ".next");
try {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("[clean-web-next] removed", dir);
} catch (e) {
  console.warn("[clean-web-next]", e.message);
}
