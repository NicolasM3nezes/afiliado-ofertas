import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const failures = [];
const allowedEnvFiles = new Set([".env.example"]);

for (const file of tracked) {
  const normalized = file.replaceAll("\\", "/");
  const base = normalized.split("/").at(-1) || "";

  if (
    (base.startsWith(".env") || /\.env(?:\.|$)/i.test(base))
    && !allowedEnvFiles.has(normalized)
  ) {
    failures.push(`${normalized}: arquivo de ambiente nao pode ser versionado.`);
    continue;
  }

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 1024 * 1024) continue;

  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const checks = [
    {
      name: "APP_ENCRYPTION_KEY real",
      regex: /^APP_ENCRYPTION_KEY=(?!GERADA_AUTOMATICAMENTE_NO_LOCALHOST\s*$)(?!\s*$)(?!\$)[^\r\n]+/m,
    },
    {
      name: "APP_ENCRYPTION_KEY_PREVIOUS preenchida",
      regex: /^APP_ENCRYPTION_KEY_PREVIOUS=(?!\$)\S+/m,
    },
    {
      name: "Supabase secret key",
      regex: /\bsb_secret_[A-Za-z0-9_-]{12,}\b/,
    },
    {
      name: "chave privada",
      regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    },
  ];

  for (const check of checks) {
    if (check.regex.test(content)) {
      failures.push(`${normalized}: possivel segredo detectado (${check.name}).`);
    }
  }
}

if (failures.length) {
  console.error("\nSECURITY CHECK FALHOU\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nRemova o segredo do Git e rotacione a credencial exposta antes de continuar.\n");
  process.exit(1);
}

console.log(`Security check OK: ${tracked.length} arquivos versionados verificados.`);
