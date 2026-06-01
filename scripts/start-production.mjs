import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

await run("npx", ["prisma", "migrate", "deploy"]);

const port = process.env.PORT ?? "8080";
const server = spawn(
  "npx",
  ["remix-serve", "./build/server/index.js"],
  {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, HOST: "0.0.0.0", PORT: port },
  },
);

server.on("exit", (code) => process.exit(code ?? 0));
