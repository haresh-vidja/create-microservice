import fs from "fs/promises";
import os from "os";
import path from "path";
import { FRAMEWORK_CHOICES, AWS_TARGET_CHOICES, CICD_CHOICES } from "./questions.js";

const DEFAULT_CONFIG_FILENAME = ".microservicegeneratorrc.json";

const FALLBACK_DEFAULTS = {
  defaultFramework: FRAMEWORK_CHOICES[0].value,
  defaultAWS: AWS_TARGET_CHOICES[0].value,
  defaultCICD: CICD_CHOICES[0].value,
};

function isValidChoice(value, choices) {
  return choices.some((choice) => choice.value === value);
}

function normalizeConfig(config) {
  const normalized = { ...FALLBACK_DEFAULTS };

  if (config && typeof config === "object") {
    if (isValidChoice(config.defaultFramework, FRAMEWORK_CHOICES)) {
      normalized.defaultFramework = config.defaultFramework;
    }

    if (isValidChoice(config.defaultAWS, AWS_TARGET_CHOICES)) {
      normalized.defaultAWS = config.defaultAWS;
    }

    if (isValidChoice(config.defaultCICD, CICD_CHOICES)) {
      normalized.defaultCICD = config.defaultCICD;
    }
  }

  return normalized;
}

export async function loadUserConfig(customPath) {
  const resolvedPath = customPath
    ? path.resolve(process.cwd(), customPath)
    : path.join(os.homedir(), DEFAULT_CONFIG_FILENAME);

  try {
    const fileContent = await fs.readFile(resolvedPath, "utf8");
    const parsed = JSON.parse(fileContent);
    return normalizeConfig(parsed);
  } catch (error) {
    return FALLBACK_DEFAULTS;
  }
}
