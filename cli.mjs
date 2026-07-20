#!/usr/bin/env node

import {stringify as stringifyYaml} from "yaml";
import {CLI_ARGUMENT, CLI_COMMAND, CLI_MESSAGE, DEFAULT, PROCESS_EXIT_CODE, PRODUCT, SERVER_VERSION} from "./protocol.mjs";

const HELP = `Usage: ${PRODUCT.NAME} [command] [options]

Commands:
  ${CLI_COMMAND.SERVE}       Start the MCP server over stdio (default)
  ${CLI_COMMAND.DOCTOR}      Verify the installed runtime and semantic providers

Options:
  ${CLI_ARGUMENT.YAML}       Render doctor output as YAML instead of JSON
  ${CLI_ARGUMENT.HELP}, ${CLI_ARGUMENT.HELP_SHORT}   Show this help
  ${CLI_ARGUMENT.VERSION}, ${CLI_ARGUMENT.VERSION_SHORT}   Show the installed version
`;

const args = process.argv.slice(DEFAULT.PROCESS_ARGUMENT_OFFSET);
const commandIndex = args.findIndex((argument) => !argument.startsWith("-"));
const command = commandIndex >= 0 ? args[commandIndex] : CLI_COMMAND.SERVE;
const commandArguments = args.filter((_, index) => index !== commandIndex);
const acceptedArguments = command === CLI_COMMAND.DOCTOR ? new Set([CLI_ARGUMENT.YAML]) : new Set();
const unknownArguments = commandArguments.filter((argument) => !acceptedArguments.has(argument));

if (args.includes(CLI_ARGUMENT.HELP) || args.includes(CLI_ARGUMENT.HELP_SHORT) || command === CLI_COMMAND.HELP) {
  process.stdout.write(HELP);
} else if (args.includes(CLI_ARGUMENT.VERSION) || args.includes(CLI_ARGUMENT.VERSION_SHORT) || command === CLI_COMMAND.VERSION) {
  process.stdout.write(`${SERVER_VERSION}\n`);
} else if (args.length > 0 && commandIndex < 0) {
  process.stderr.write(`${CLI_MESSAGE.UNKNOWN_OPTION}: ${args[0]}\n\n${HELP}`);
  process.exitCode = PROCESS_EXIT_CODE.FAILURE;
} else if (unknownArguments.length > 0) {
  process.stderr.write(`${CLI_MESSAGE.UNKNOWN_ARGUMENT}: ${unknownArguments[0]}\n\n${HELP}`);
  process.exitCode = PROCESS_EXIT_CODE.FAILURE;
} else if (command === CLI_COMMAND.SERVE) {
  await import("./server.mjs");
} else if (command === CLI_COMMAND.DOCTOR) {
  const {runDoctor} = await import("./lib/doctor.mjs");
  const result = await runDoctor();
  process.stdout.write(args.includes(CLI_ARGUMENT.YAML) ? stringifyYaml(result, {lineWidth: 0}) : `${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.exitCode;
} else {
  process.stderr.write(`${CLI_MESSAGE.UNKNOWN_COMMAND}: ${command}\n\n${HELP}`);
  process.exitCode = PROCESS_EXIT_CODE.FAILURE;
}
