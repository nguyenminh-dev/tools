const { spawn } = require("child_process");
const path = require("path");

const electronPath = require("electron");
const appPath = __dirname;

console.log("Starting electron...", { electronPath, appPath });

const child = spawn(electronPath, [appPath], {
  stdio: "inherit",
  cwd: appPath,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: 1 },
  shell: true
});

child.on("error", (err) => console.error("Failed to start:", err));
child.on("close", (code) => process.exit(code));
