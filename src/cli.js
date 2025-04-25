#!/usr/bin/env node
import chalk from "chalk";
import path from "path";
import { createRequire } from "module";
import inquirer from "inquirer";
import minimist from "minimist";
import { loadUserConfig } from "./config.js";
import {
  buildPrompts,
  FRAMEWORK_CHOICES,
  AWS_TARGET_CHOICES,
  CICD_CHOICES,
  ADDON_CHOICES,
} from "./questions.js";
import { generateProject } from "./generator.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

function printHelp() {
  console.log(`
${chalk.bold("microsvc-template")} v${pkg.version}

Usage:
  microsvc-template [options]

Options:
  --name <value>         Service name (kebab-case recommended)
  --framework <value>    Framework (${FRAMEWORK_CHOICES.map((c) => c.value).join(", ")})
  --aws <value>          AWS target (${AWS_TARGET_CHOICES.map((c) => c.value).join(", ")})
  --cicd <value>         CI/CD pipeline (${CICD_CHOICES.map((c) => c.value).join(", ")})
  --addons <list>        Comma separated add-ons (${ADDON_CHOICES.map((c) => c.value).join(", ")})
  --target <path>        Output directory (defaults to current working dir)
  --config <path>        Custom path to defaults file
  --yes                  Skip interactive confirmation
  --version              Print version
  --help                 Show this help message
`);
}

function validateChoice(value, choices, label) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase();
  const match = choices.find((item) => item.value === normalized);
  if (!match) {
    console.error(
      chalk.red(
        `Invalid ${label} "${value}". Allowed values: ${choices
          .map((item) => item.value)
          .join(", ")}.`
      )
    );
    process.exit(1);
  }
  return normalized;
}

async function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv.help) {
    printHelp();
    return;

  }

  if (argv.version) {
    console.log(pkg.version);
    return;
  }

  const cliSelections = {
    name: argv.name,
    framework: validateChoice(argv.framework, FRAMEWORK_CHOICES, "framework"),
    awsTarget: validateChoice(argv.aws, AWS_TARGET_CHOICES, "AWS target"),
    ciCd: validateChoice(argv.cicd, CICD_CHOICES, "CI/CD pipeline"),
    addons: argv.addons
      ? String(argv.addons)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined,
    targetDir: argv.target ? path.resolve(process.cwd(), argv.target) : process.cwd(),
    skipConfirm: Boolean(argv.yes),
  };

  if (cliSelections.addons) {
    cliSelections.addons = cliSelections.addons.map((addon) =>
      validateChoice(addon, ADDON_CHOICES, "add-on")
    );
  }

  const defaults = await loadUserConfig(argv.config);

  const prompts = buildPrompts(defaults, cliSelections);

  const answers = prompts.length > 0 ? await inquirer.prompt(prompts) : {};

  const options = {
    serviceName: cliSelections.name ?? answers.serviceName,
    framework: cliSelections.framework ?? answers.framework,
    awsTarget: cliSelections.awsTarget ?? answers.awsTarget ?? defaults.defaultAWS,
    ciCd: cliSelections.ciCd ?? answers.ciCd ?? defaults.defaultCICD,
    addons: cliSelections.addons ?? answers.addons ?? [],
    targetDir: cliSelections.targetDir,
  };

  if (!options.serviceName) {
    console.error(chalk.red("A service name is required to proceed."));
    process.exit(1);
  }

  const summary = [
    ["Service name", options.serviceName],
    ["Framework", options.framework],
    ["AWS target", options.awsTarget],
    ["CI/CD", options.ciCd],
    ["Add-ons", options.addons.length > 0 ? options.addons.join(", ") : "none"],
    ["Output directory", path.join(options.targetDir, options.serviceName)],
  ];

  if (!cliSelections.skipConfirm) {
    console.log("");
    console.log(chalk.bold("Summary"));
    summary.forEach(([label, value]) => {
      console.log(`${chalk.gray(" - ")}${chalk.bold(label)}: ${value}`);
    });
    console.log("");

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Generate microservice with these settings?",
        default: true,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow("Aborting. No files were created."));
      return;
    }
  }

  await generateProject(options);

  const outputDir = path.join(options.targetDir, options.serviceName);
  console.log("");
  console.log(chalk.green("Success! Microservice scaffold created."));
  console.log(`Navigate to ${chalk.bold(outputDir)} and run ${chalk.cyan("npm install")}.`);
  console.log(`Use ${chalk.cyan("npm test")} to run the health check test suite.`);
}

main().catch((error) => {
  console.error(chalk.red("Failed to generate microservice."));
  console.error(error);
  process.exit(1);
});
