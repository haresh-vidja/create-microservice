export const FRAMEWORK_CHOICES = [
  { name: "Express", value: "express" },
  { name: "Fastify", value: "fastify" },
];

export const AWS_TARGET_CHOICES = [
  { name: "ECS Fargate", value: "ecs" },
  { name: "AWS Lambda", value: "lambda" },
  { name: "EC2 with PM2", value: "ec2" },
];

export const CICD_CHOICES = [
  { name: "GitHub Actions", value: "github" },
  { name: "GitLab CI", value: "gitlab" },
];

export const ADDON_CHOICES = [
  { name: "PostgreSQL (includes docker-compose service)", value: "postgres" },
  { name: "MongoDB (includes docker-compose service)", value: "mongo" },
  { name: "Redis cache", value: "redis" },
  { name: "SQS consumer scaffold", value: "sqs" },
];

function buildServiceNamePrompt(currentValue) {
  return {
    type: "input",
    name: "serviceName",
    message: "Enter microservice name",
    default: currentValue,
    validate: (input) => {
      if (!input || !input.trim()) {
        return "Service name cannot be empty.";
      }
      if (!/^[a-z0-9-]+$/.test(input.trim())) {
        return "Use lowercase letters, numbers, and hyphens only.";
      }
      return true;
    },
    filter: (input) => input.trim(),
  };
}

function promptIfMissing(condition, prompt) {
  return condition ? prompt : null;
}

export function buildPrompts(defaults, selections) {
  const prompts = [
    promptIfMissing(!selections.name, buildServiceNamePrompt(selections.name)),
    promptIfMissing(!selections.framework, {
      type: "list",
      name: "framework",
      message: "Choose framework",
      choices: FRAMEWORK_CHOICES,
      default: defaults.defaultFramework,
    }),
    promptIfMissing(!selections.awsTarget, {
      type: "list",
      name: "awsTarget",
      message: "Choose AWS target",
      choices: AWS_TARGET_CHOICES,
      default: defaults.defaultAWS,
    }),
    promptIfMissing(!selections.ciCd, {
      type: "list",
      name: "ciCd",
      message: "Choose CI/CD pipeline",
      choices: CICD_CHOICES,
      default: defaults.defaultCICD,
    }),
    promptIfMissing(!selections.addons, {
      type: "checkbox",
      name: "addons",
      message: "Select optional add-ons",
      choices: ADDON_CHOICES,
    }),
  ];

  return prompts.filter(Boolean);
}
