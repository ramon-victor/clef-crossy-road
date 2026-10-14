import { resolve } from "node:path";
import {
  diagnoseCommand,
  exportCommand,
  planCommand,
  reportCommand,
  runCommand,
} from "./commands.ts";
import { type CliValues, parseCli, USAGE } from "./options.ts";

const COMMANDS: Readonly<
  Record<string, (root: string, values: CliValues) => void | Promise<void>>
> = {
  run: runCommand,
  report: reportCommand,
  plan: planCommand,
  diagnose: diagnoseCommand,
  export: exportCommand,
};

async function main(): Promise<void> {
  const { command, values } = parseCli(process.argv.slice(2));
  const handler = command ? COMMANDS[command] : undefined;
  if (!handler) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
  await handler(resolve(values.root ?? "."), values);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
