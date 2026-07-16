#!/usr/bin/env node

import {CI_STATUS} from "../protocol.mjs";
import {AGENT_EVALUATION_CASES, evaluationPrompt, gradeAgentAnswers} from "./agent-evaluation-contract.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const prompt = evaluationPrompt();
assert(prompt.cases.length === AGENT_EVALUATION_CASES.length, "Evaluation prompt omitted cases");
assert(
  prompt.cases.every((item) => !("expected" in item)),
  "Evaluation prompt exposed expected answers",
);

const correctAnswers = {
  answers: AGENT_EVALUATION_CASES.map((evaluationCase) => ({id: evaluationCase.id, ...evaluationCase.expected})),
};
const passing = gradeAgentAnswers(correctAnswers);
assert(passing.status === CI_STATUS.PASS, "Correct agent answers did not pass");
assert(passing.correctCases === AGENT_EVALUATION_CASES.length, "Correct answer count was wrong");

const incorrectAnswers = {
  answers: correctAnswers.answers.map((answer, index) =>
    index === 0 ? {...answer, nextTool: AGENT_EVALUATION_CASES[1].expected.nextTool} : answer,
  ),
};
const failing = gradeAgentAnswers(incorrectAnswers);
assert(failing.status === CI_STATUS.FAIL, "Incorrect agent answer did not fail");
assert(failing.correctCases === AGENT_EVALUATION_CASES.length - 1, "Incorrect answer count was wrong");

process.stdout.write(
  `${JSON.stringify(
    {
      evaluationCases: AGENT_EVALUATION_CASES.length,
      hiddenExpectedAnswers: "ok",
      deterministicGrading: "ok",
      incorrectDecisionRejected: "ok",
    },
    null,
    2,
  )}\n`,
);
