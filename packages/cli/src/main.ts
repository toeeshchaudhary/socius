#!/usr/bin/env bun
/**
 * `socius` entrypoint. For M0 this wires config + logging and reports status via
 * a minimal `doctor`; the connect-or-spawn daemon path and streaming inference
 * land in M1.
 */
import { defaultConfig, resolvePaths } from "@socius/config";
import { ConsoleLogger } from "@socius/logging";
import { readStdin, stdoutIsTty } from "./index.ts";

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];
  const paths = resolvePaths();
  const config = defaultConfig(paths);
  const log = new ConsoleLogger({ level: config.logging.level, subsystem: "cli" });

  if (command === "doctor") {
    // M1 will probe: socket alive? model present? GPU? config valid?
    process.stdout.write("socius doctor\n");
    process.stdout.write(`  config dir : ${paths.configDir}\n`);
    process.stdout.write(`  data dir   : ${paths.dataDir}\n`);
    process.stdout.write(`  socket     : ${paths.socketPath}\n`);
    process.stdout.write(`  model id   : ${config.model.id}\n`);
    process.stdout.write(`  llama-server: ${config.inference.llamaServerBin}\n`);
    process.stdout.write("  status     : scaffolding (M0) — inference lands in M1\n");
    return 0;
  }

  const input = args.join(" ").trim();
  const stdin = await readStdin();
  if (!input && !stdin) {
    process.stderr.write("usage: socius <question>   |   <cmd> | socius <question>\n");
    return 2;
  }

  log.info("received request", { hasStdin: stdin !== undefined, tty: stdoutIsTty() });
  process.stderr.write(
    "socius: the reasoning path is not wired yet (M1). Run `socius doctor` for status.\n",
  );
  return 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`socius: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
