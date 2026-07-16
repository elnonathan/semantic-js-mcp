#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import {parse as parseYaml, stringify as stringifyYaml} from "yaml";
import {CI_EXIT_CODE, CI_STATUS, CLI_ARGUMENT} from "../protocol.mjs";
import {AGENT_EVALUATION_ARGUMENT, AGENT_EVALUATION_REASON, evaluationPrompt, gradeAgentAnswers} from "./agent-evaluation-contract.mjs";

const answersArgumentIndex = process.argv.indexOf(AGENT_EVALUATION_ARGUMENT.ANSWERS);
const answersFile = answersArgumentIndex >= 0 ? process.argv[answersArgumentIndex + 1] : undefined;
const useYaml = process.argv.includes(CLI_ARGUMENT.YAML);

let output;
if (!answersFile) {
  output = evaluationPrompt();
} else {
  try {
    const text = await readFile(answersFile, "utf8");
    let answers;
    try {
      answers = JSON.parse(text);
    } catch {
      answers = parseYaml(text);
    }
    output = gradeAgentAnswers(answers);
    process.exitCode = output.exitCode;
  } catch (error) {
    output = {
      status: CI_STATUS.BLOCKED,
      exitCode: CI_EXIT_CODE.BLOCKED,
      reason: AGENT_EVALUATION_REASON.ANSWERS_INVALID,
      message: error instanceof Error ? error.message : String(error),
    };
    process.exitCode = output.exitCode;
  }
}

process.stdout.write(useYaml ? stringifyYaml(output, {lineWidth: 0}) : `${JSON.stringify(output, null, 2)}\n`);
