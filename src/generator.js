import fs from "fs/promises";
import path from "path";
import os from "os";
import fsExtra from "fs-extra";
import { ADDON_CHOICES, CICD_CHOICES, FRAMEWORK_CHOICES } from "./questions.js";

const DEFAULT_PORT = 3000;

const FRAMEWORK_LABELS = FRAMEWORK_CHOICES.reduce((acc, item) => {
  acc[item.value] = item.name;
  return acc;
}, {});

const CICD_LABELS = CICD_CHOICES.reduce((acc, item) => {
  acc[item.value] = item.name;
  return acc;
}, {});

const ADDON_LABELS = ADDON_CHOICES.reduce((acc, item) => {
  acc[item.value] = item.name;
  return acc;
}, {});

const BASE_DEPENDENCIES = {
  dotenv: "^16.4.5",
  pino: "^9.3.1",
  "pino-pretty": "^11.2.2",
};

const BASE_DEV_DEPENDENCIES = {
  "@eslint/js": "^9.9.0",
  eslint: "^9.9.0",
  "eslint-config-prettier": "^9.1.0",
  "eslint-plugin-import": "^2.29.1",
  prettier: "^3.3.3",
  jest: "^29.7.0",
  husky: "^9.1.4",
  "lint-staged": "^15.2.7",
  "cross-env": "^7.0.3",
};

const FRAMEWORK_RECIPES = {
  express: {
    dependencies: {
      express: "^4.19.2",
      cors: "^2.8.5",
    },
    devDependencies: {
      supertest: "^6.3.4",
    },
    createServerFile: createExpressServerSource,
    createTestFile: createExpressTestSource,
  },
  fastify: {
    dependencies: {
      fastify: "^4.26.2",
      "@fastify/cors": "^9.0.1",
    },
    devDependencies: {},
    createServerFile: createFastifyServerSource,
    createTestFile: createFastifyTestSource,
  },
};

const ADDON_RECIPES = {
  postgres: {
    dependencies: {
      pg: "^8.11.5",
    },
    dockerServiceName: "postgres",
    dockerService: (context) => `
  postgres:
    image: postgres:16-alpine
    container_name: ${context.serviceName}-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ${context.serviceName.replace(/[^a-z0-9]/gi, "")}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
`,
    env: (context) => [
      `DATABASE_URL=postgres://postgres:postgres@postgres:5432/${context.serviceName.replace(
        /[^a-z0-9]/gi,
        ""
      )}`,
      "POSTGRES_POOL_MAX=10",
      "POSTGRES_SSL=false",
    ],
    files: [
      {
        path: "src/integrations/postgres.js",
        createContent: createPostgresIntegrationSource,
      },
    ],
    readmeSection: createPostgresReadmeSection,
  },
  mongo: {
    dependencies: {
      mongodb: "^6.7.0",
    },
    dockerServiceName: "mongo",
    dockerService: (context) => `
  mongo:
    image: mongo:7.0
    container_name: ${context.serviceName}-mongo
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
`,
    env: (context) => [
      `MONGO_URI=mongodb://mongo:27017/${context.serviceName.replace(/[^a-z0-9]/gi, "")}`,
    ],
    files: [
      {
        path: "src/integrations/mongo.js",
        createContent: createMongoIntegrationSource,
      },
    ],
    readmeSection: createMongoReadmeSection,
  },
  redis: {
    dependencies: {
      redis: "^4.6.12",
    },
    dockerServiceName: "redis",
    dockerService: (context) => `
  redis:
    image: redis:7-alpine
    container_name: ${context.serviceName}-redis
    ports:
      - "6379:6379"
`,
    env: () => ["REDIS_URL=redis://redis:6379"],
    files: [
      {
        path: "src/integrations/redis.js",
        createContent: createRedisIntegrationSource,
      },
    ],
    readmeSection: createRedisReadmeSection,
  },
  sqs: {
    dependencies: {
      "@aws-sdk/client-sqs": "^3.609.0",
    },
    dockerServiceName: "localstack",
    dockerService: (context) => `
  localstack:
    image: localstack/localstack:3.6
    container_name: ${context.serviceName}-localstack
    ports:
      - "4566:4566"
    environment:
      SERVICES: sqs
      AWS_DEFAULT_REGION: ${context.awsRegion}
    volumes:
      - "${context.serviceName}-localstack:/var/lib/localstack"
`,
    env: (context) => [
      `AWS_REGION=${context.awsRegion}`,
      `SQS_QUEUE_URL=http://localhost:4566/000000000000/${context.serviceName}`,
    ],
    files: [
      {
        path: "src/queues/sqs-consumer.js",
        createContent: createSqsConsumerSource,
      },
      {
        path: "scripts/setup-localstack.sh",
        createContent: createLocalstackSetupScript,
        mode: 0o755,
      },
    ],
    readmeSection: createSqsReadmeSection,
  },
};

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toDisplayName(serviceName) {
  return serviceName
    .split("-")
    .filter(Boolean)
    .map((segment) => capitalize(segment))
    .join(" ");
}

async function ensureDirectoryAvailable(projectDir) {
  const exists = await fsExtra.pathExists(projectDir);
  if (!exists) {
    await fsExtra.ensureDir(projectDir);
    return;
  }

  const contents = await fs.readdir(projectDir);
  if (contents.length > 0) {
    throw new Error(
      `Target directory "${projectDir}" is not empty. Choose a different service name or clean the directory.`
    );
  }
}

function buildContext(options) {
  const serviceName = options.serviceName;
  const displayName = toDisplayName(serviceName);
  const framework = options.framework;
  const awsTarget = options.awsTarget;
  const ciCd = options.ciCd;
  const addons = [...new Set(options.addons ?? [])];
  const awsRegion = process.env.AWS_REGION ?? "us-east-1";

  return {
    serviceName,
    displayName,
    framework,
    frameworkLabel: FRAMEWORK_LABELS[framework],
    awsTarget,
    awsLabel: CICD_LABELS[awsTarget] ?? awsTarget,
    ciCd,
    ciCdLabel: CICD_LABELS[ciCd],
    addons,
    targetDir: options.targetDir,
    projectDir: path.join(options.targetDir, serviceName),
    port: DEFAULT_PORT,
    dockerImage: serviceName.replace(/[^a-z0-9]/gi, "").toLowerCase(),
    awsRegion,
  };
}

async function writeJsonFile(dest, data) {
  await fsExtra.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeFile(dest, content, mode) {
  await fsExtra.ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, { encoding: "utf8", mode });
  if (mode === 0o755) {
    await fs.chmod(dest, mode);
  }
}

function createServicePackageJson(context) {
  const frameworkRecipe = FRAMEWORK_RECIPES[context.framework];
  const dependencies = { ...BASE_DEPENDENCIES, ...frameworkRecipe.dependencies };
  const devDependencies = { ...BASE_DEV_DEPENDENCIES, ...frameworkRecipe.devDependencies };

  for (const addon of context.addons) {
    const recipe = ADDON_RECIPES[addon];
    if (!recipe) continue;
    Object.assign(dependencies, recipe.dependencies);
  }

  const packageJson = {
    name: context.serviceName,
    version: "0.1.0",
    private: true,
    type: "module",
    description: `${context.displayName} microservice generated by microservice-generator.`,
    scripts: {
      dev: "cross-env NODE_ENV=development node src/index.js",
      start: "cross-env NODE_ENV=production node src/index.js",
      lint: "eslint .",
      "lint:fix": "eslint . --fix",
      format: "prettier --check .",
      "format:write": "prettier --write .",
      test: "cross-env NODE_OPTIONS=--experimental-vm-modules jest",
      "test:watch": "cross-env NODE_OPTIONS=--experimental-vm-modules jest --watch",
      "docker:build": `docker build -t ${context.dockerImage}:latest .`,
      "docker:run": `docker run --rm -p ${context.port}:${context.port} ${context.dockerImage}:latest`,
      "deploy:ecs": "./scripts/deploy-ecs.sh",
      "deploy:lambda": "./scripts/deploy-lambda.sh",
      "deploy:ec2": "./scripts/deploy-ec2.sh",
      prepare: "husky install",
    },
    engines: {
      node: ">=18.0.0",
    },
    dependencies,
    devDependencies,
    "lint-staged": {
      "*.{js,json,yml,yaml,md}": "prettier --write",
      "src/**/*.js": "eslint --fix",
    },
  };

  if (context.addons.includes("sqs")) {
    packageJson.scripts["worker:sqs"] = "node src/queues/sqs-consumer.js";
  }

  return packageJson;
}

function createGitignore() {
  return `node_modules
.env
.DS_Store
coverage
dist
.husky/_*
`;
}

function createDockerignore() {
  return `node_modules
npm-debug.log
.git
.github
coverage
dist
.env
`;
}

function createEnvExample(context) {
  const lines = [
    "NODE_ENV=development",
    `PORT=${context.port}`,
    "LOG_LEVEL=info",
  ];

  for (const addon of context.addons) {
    const recipe = ADDON_RECIPES[addon];
    if (!recipe || !recipe.env) continue;
    lines.push(...recipe.env(context));
  }

  return `${lines.join("\n")}\n`;
}

function createDockerfile(context) {
  return `FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE ${context.port}
CMD ["node", "src/index.js"]
`;
}

function createDockerCompose(context) {
  const addonServices = [];
  const dependsOn = [];

  for (const addon of context.addons) {
    const recipe = ADDON_RECIPES[addon];
    if (!recipe || !recipe.dockerService) continue;
    addonServices.push(recipe.dockerService(context));
    dependsOn.push(recipe.dockerServiceName);
  }

  const dependsOnBlock =
    dependsOn.length > 0
      ? `    depends_on:\n${dependsOn.map((item) => `      - ${item}`).join("\n")}\n`
      : "";

  const services = [
    `  app:
    build: .
    container_name: ${context.serviceName}
    image: ${context.dockerImage}:latest
    ports:
      - "${context.port}:${context.port}"
    environment:
      NODE_ENV: development
      PORT: ${context.port}
    env_file:
      - .env
    volumes:
      - ./:/usr/src/app
${dependsOnBlock}`,
    ...addonServices,
  ]
    .filter(Boolean)
    .join("");

  const volumes = context.addons
    .map((addon) => ADDON_RECIPES[addon]?.dockerServiceName)
    .filter(Boolean)
    .map((name) => `  ${name}_data:\n`)
    .join("");

  const extraVolumeForLocalstack = context.addons.includes("sqs")
    ? `  ${context.serviceName}-localstack:\n`
    : "";

  const volumesBlock = volumes || extraVolumeForLocalstack ? `\nvolumes:\n${volumes}${extraVolumeForLocalstack}` : "";

  return `version: "3.9"
services:
${services}${volumesBlock}`;
}

function createJestConfig() {
  return `export default {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  transform: {},
};
`;
}

function createPrettierConfig() {
  return `export default {
  singleQuote: true,
  trailingComma: "es5",
  printWidth: 100,
};
`;
}

function createEslintConfig() {
  return `import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
    },
    rules: {
      "no-console": "off",
    },
  },
];
`;
}

function createLoggerSource() {
  return `import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

const transport =
  process.env.NODE_ENV === "production"
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      };

export const logger = pino({
  level,
  transport,
});
`;
}

function createEnvConfigSource() {
  return `import dotenv from "dotenv";

dotenv.config();

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? "info",
};
`;
}

function createIndexSource(context) {
  return `import { startServer } from "./server.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";

const signals = ["SIGINT", "SIGTERM"];

async function bootstrap() {
  try {
    const controller = await startServer({ port: config.port });

    signals.forEach((signal) => {
      process.on(signal, async () => {
        logger.info({ signal }, "Received shutdown signal");
        try {
          if (typeof controller?.close === "function") {
            await controller.close();
          }
        } catch (error) {
          logger.error({ err: error }, "Error during graceful shutdown");
        } finally {
          process.exit(0);
        }
      });
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start ${context.displayName}");
    process.exit(1);
  }
}

bootstrap();
`;
}

function createExpressServerSource(context) {
  return `import express from "express";
import cors from "cors";
import { logger } from "./utils/logger.js";

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      service: "${context.displayName}",
    });
  });

  return app;
}

export async function startServer({ port } = {}) {
  const app = createServer();
  const listenPort = port ?? Number(process.env.PORT ?? 3000);

  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, () => {
      logger.info({ port: listenPort }, "${context.displayName} ready");
      resolve({
        app,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) {
                closeReject(err);
              } else {
                closeResolve();
              }
            });
          }),
      });
    });

    server.on("error", (error) => {
      logger.error({ err: error }, "HTTP server error");
      reject(error);
    });
  });
}
`;
}

function createFastifyServerSource(context) {
  return `import Fastify from "fastify";
import cors from "@fastify/cors";
import { logger } from "./utils/logger.js";

export function createServer() {
  const app = Fastify({
    logger: false,
  });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    service: "${context.displayName}",
  }));

  return app;
}

export async function startServer({ port } = {}) {
  const app = createServer();
  const listenPort = port ?? Number(process.env.PORT ?? 3000);
  await app.listen({ port: listenPort, host: "0.0.0.0" });
  logger.info({ port: listenPort }, "${context.displayName} ready");
  return {
    app,
    close: () => app.close(),
  };
}
`;
}

function createExpressTestSource() {
  return `import request from "supertest";
import { createServer } from "../src/server.js";

describe("GET /health", () => {
  it("returns service status", async () => {
    const app = createServer();
    const response = await request(app).get("/health");
    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe("ok");
  });
});
`;
}

function createFastifyTestSource() {
  return `import { createServer } from "../src/server.js";

describe("GET /health", () => {
  it("returns service status", async () => {
    const app = createServer();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
  });
});
`;
}

function createPostgresIntegrationSource() {
  return `import pg from "pg";

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured");
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.POSTGRES_POOL_MAX ?? 10),
      ssl: process.env.POSTGRES_SSL === "true",
    });
  }

  return pool;
}

export async function withClient(callback) {
  const client = await getPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}
`;
}

function createMongoIntegrationSource() {
  return `import { MongoClient } from "mongodb";

let client;

export async function connectMongo() {
  if (client) return client;
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  return client;
}

export async function getDatabase(name) {
  const mongo = await connectMongo();
  return mongo.db(name);
}
`;
}

function createRedisIntegrationSource() {
  return `import { createClient } from "redis";

let client;

export async function connectRedis() {
  if (!client) {
    if (!process.env.REDIS_URL) {
      throw new Error("REDIS_URL is not configured");
    }

    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (error) => {
      console.error("Redis error:", error);
    });
    await client.connect();
  }

  return client;
}
`;
}

function createSqsConsumerSource(context) {
  return `import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { logger } from "../utils/logger.js";

const client = new SQSClient({ region: process.env.AWS_REGION ?? "${context.awsRegion}" });

const QUEUE_URL = process.env.SQS_QUEUE_URL;

if (!QUEUE_URL) {
  throw new Error("SQS_QUEUE_URL must be set in environment variables");
}

async function handleMessage(message) {
  logger.info({ messageId: message.MessageId }, "Processing SQS message");
  // Add business logic here
}

async function poll() {
  const command = new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    WaitTimeSeconds: 5,
    MaxNumberOfMessages: 5,
  });

  const response = await client.send(command);
  if (!response.Messages?.length) {
    return;
  }

  for (const message of response.Messages) {
    await handleMessage(message);
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
      })
    );
  }
}

async function main() {
  logger.info("Starting SQS polling loop");
  while (true) {
    try {
      await poll();
    } catch (error) {
      logger.error({ err: error }, "Failed to poll SQS");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

main().catch((error) => {
  logger.error({ err: error }, "SQS worker failed");
  process.exit(1);
});
`;
}

function createLocalstackSetupScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

QUEUE_NAME=\${1:-sample-queue}

aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name "$QUEUE_NAME"
echo "Created queue $QUEUE_NAME in LocalStack"
`;
}

function createHuskyScript() {
  return `#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run lint
npm run test -- --bail --findRelatedTests
`;
}

function createReadme(context) {
  const addonsSummary =
    context.addons.length > 0
      ? context.addons.map((addon) => `  - ${ADDON_LABELS[addon]}`).join("\n")
      : "  - None";

  const workerScriptLine = context.addons.includes("sqs")
    ? "- `npm run worker:sqs` - Run the SQS worker.\n"
    : "";

  const addonSections = context.addons
    .map((addon) => {
      const recipe = ADDON_RECIPES[addon];
      return recipe?.readmeSection ? recipe.readmeSection(context) : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `# ${context.displayName}

Generated with [microservice-generator](https://www.npmjs.com/package/microservice-generator).

## Overview

- Framework: ${context.frameworkLabel}
- AWS Target: ${context.awsTarget.toUpperCase()}
- CI/CD: ${context.ciCdLabel}
- Add-ons:
${addonsSummary}

## Getting Started

1. Install dependencies
   \`\`\`bash
   npm install
   \`\`\`
2. Copy environment template
   \`\`\`bash
   cp .env.example .env
   \`\`\`
3. Run the service locally
   \`\`\`bash
   npm run dev
   \`\`\`

The service exposes a health endpoint at \`http://localhost:${context.port}/health\`.

## Available Scripts

- \`npm run dev\` - Start the service in development mode.
- \`npm run start\` - Start the service in production mode.
- \`npm test\` - Run the Jest test suite.
- \`npm run lint\` - Lint the project using ESLint.
- \`npm run format\` - Verify Prettier formatting.
- \`npm run docker:build\` - Build a Docker image.
- \`npm run docker:run\` - Run the Docker image locally.
- \`npm run deploy:${context.awsTarget}\` - Run the deployment script for the selected AWS target.
${workerScriptLine}
## Project Structure

\`\`\`
.
|-- aws/
|-- scripts/
|-- src/
|   |-- config/
|   '-- utils/
'-- tests/
\`\`\`

## Deployment

Ensure that AWS CLI credentials are configured prior to running deployment scripts.
Update the placeholders under \`aws/${context.awsTarget}\` and \`scripts/deploy-${context.awsTarget}.sh\` with your infrastructure details.

## Docker

Use \`docker-compose up\` to start the service with its dependencies. The compose file includes optional services generated from your selections.

${addonSections}
`;
}

function createPostgresReadmeSection(context) {
  return `## PostgreSQL Integration

- Connection URL is defined using \`DATABASE_URL\`.
- Docker Compose provisions a PostgreSQL instance exposed on port 5432.
- Use \`src/integrations/postgres.js\` to obtain a pooled client.`;
}

function createMongoReadmeSection(context) {
  return `## MongoDB Integration

- Connection string is read from \`MONGO_URI\`.
- Docker Compose provisions MongoDB on port 27017.
- The helper in \`src/integrations/mongo.js\` returns a connected client.`;
}

function createRedisReadmeSection() {
  return `## Redis Integration

- Redis connection URL is defined via \`REDIS_URL\`.
- Docker Compose provisions Redis on port 6379.
- Use \`src/integrations/redis.js\` to obtain a connected client.`;
}

function createSqsReadmeSection(context) {
  return `## SQS Consumer

- AWS region defaults to \`${context.awsRegion}\`. Override with \`AWS_REGION\`.
- Local development uses LocalStack, exposed on port 4566.
- Run \`scripts/setup-localstack.sh <queue-name>\` to create a queue for testing.
- The worker at \`src/queues/sqs-consumer.js\` demonstrates long polling and message deletion.`;
}

function createAwsConfigs(context) {
  return {
    ecs: {
      path: "aws/ecs/task-definition.json",
      content: `{
  "family": "${context.serviceName}",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [
    {
      "name": "${context.serviceName}",
      "image": "ACCOUNT_ID.dkr.ecr.${context.awsRegion}.amazonaws.com/${context.serviceName}:latest",
      "portMappings": [
        {
          "containerPort": ${context.port},
          "hostPort": ${context.port},
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" }
      ]
    }
  ]
}
`,
    },
    lambda: {
      path: "aws/lambda/template.yaml",
      content: `AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: ${context.displayName} Lambda deployment

Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: ${context.serviceName}-handler
      CodeUri: .
      Handler: src/index.handler
      Runtime: nodejs18.x
      MemorySize: 512
      Timeout: 30
      Events:
        ApiProxy:
          Type: Api
          Properties:
            Path: /{proxy+}
            Method: ANY
`,
    },
    ec2: {
      path: "aws/ec2/user-data.sh",
      content: `#!/usr/bin/env bash
set -euo pipefail

cd /opt/${context.serviceName}
npm install --production
npm run start
`,
    },
  };
}

function createDeployScript(context, target) {
  const header = `#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required for deployment scripts"
  exit 1
fi
`;

  switch (target) {
    case "ecs":
      return `${header}
# Build and push Docker image to ECR before running this script.
echo "Updating ECS service for ${context.serviceName}..."
# Placeholder for aws ecs update-service command
`;
    case "lambda":
      return `${header}
echo "Packaging Lambda function..."
# Placeholder for aws cloudformation package/deploy commands
`;
    case "ec2":
      return `${header}
echo "Deploying to EC2..."
# Placeholder for scp/ssh deployment commands
`;
    default:
      return `${header}
echo "Deployment target not implemented."
`;
  }
}

function createGithubWorkflow(context) {
  return `name: CI and Deploy

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm install
      - run: npm run lint
      - run: npm test
      - run: npm run docker:build
      - run: npm run deploy:${context.awsTarget}
`;
}

function createGitlabPipeline(context) {
  return `stages:
  - test
  - deploy

variables:
  NODE_ENV: test

cache:
  paths:
    - node_modules/

test:
  stage: test
  image: node:18
  script:
    - npm install
    - npm run lint
    - npm test

deploy:
  stage: deploy
  image: node:18
  script:
    - npm run docker:build
    - npm run deploy:${context.awsTarget}
  only:
    - main
`;
}

async function applyCustomTemplate(projectDir, context) {
  const customTemplatePath = path.join(
    os.homedir(),
    ".microservice-generator",
    "templates",
    context.framework
  );

  const exists = await fsExtra.pathExists(customTemplatePath);
  if (!exists) return;

  await fsExtra.copy(customTemplatePath, projectDir, { overwrite: true, recursive: true });
}

export async function generateProject(options) {
  const context = buildContext(options);
  await ensureDirectoryAvailable(context.projectDir);

  // root files
  await writeJsonFile(path.join(context.projectDir, "package.json"), createServicePackageJson(context));
  await writeFile(path.join(context.projectDir, ".gitignore"), createGitignore());
  await writeFile(path.join(context.projectDir, ".dockerignore"), createDockerignore());
  await writeFile(path.join(context.projectDir, ".env.example"), createEnvExample(context));
  await writeFile(path.join(context.projectDir, "Dockerfile"), createDockerfile(context));
  await writeFile(path.join(context.projectDir, "docker-compose.yml"), createDockerCompose(context));
  await writeFile(path.join(context.projectDir, "README.md"), createReadme(context));

  // configs
  await writeFile(path.join(context.projectDir, "jest.config.js"), createJestConfig());
  await writeFile(path.join(context.projectDir, "prettier.config.mjs"), createPrettierConfig());
  await writeFile(path.join(context.projectDir, "eslint.config.mjs"), createEslintConfig());

  // src files
  await writeFile(path.join(context.projectDir, "src/index.js"), createIndexSource(context));
  await writeFile(path.join(context.projectDir, "src/config/env.js"), createEnvConfigSource());
  await writeFile(path.join(context.projectDir, "src/utils/logger.js"), createLoggerSource());

  const frameworkRecipe = FRAMEWORK_RECIPES[context.framework];
  await writeFile(
    path.join(context.projectDir, "src/server.js"),
    frameworkRecipe.createServerFile(context)
  );

  // tests
  await writeFile(
    path.join(context.projectDir, "tests/health.test.js"),
    frameworkRecipe.createTestFile(context)
  );

  // husky
  await writeFile(
    path.join(context.projectDir, ".husky/pre-commit"),
    createHuskyScript(),
    0o755
  );
  await fsExtra.ensureDir(path.join(context.projectDir, ".husky/_"));

  // scripts
  const deployTargets = ["ecs", "lambda", "ec2"];
  for (const target of deployTargets) {
    await writeFile(
      path.join(context.projectDir, `scripts/deploy-${target}.sh`),
      createDeployScript(context, target),
      0o755
    );
  }

  // AWS configs
  const awsConfigs = createAwsConfigs(context);
  await writeFile(
    path.join(context.projectDir, awsConfigs[context.awsTarget].path),
    awsConfigs[context.awsTarget].content
  );

  // Always provide other AWS templates for convenience
  for (const [key, value] of Object.entries(awsConfigs)) {
    if (key === context.awsTarget) continue;
    await writeFile(path.join(context.projectDir, value.path), value.content);
  }

  // CI/CD
  if (context.ciCd === "github") {
    await writeFile(
      path.join(context.projectDir, ".github/workflows/deploy.yml"),
      createGithubWorkflow(context)
    );
  } else if (context.ciCd === "gitlab") {
    await writeFile(
      path.join(context.projectDir, ".gitlab-ci.yml"),
      createGitlabPipeline(context)
    );
  }

  // Add-ons
  for (const addon of context.addons) {
    const recipe = ADDON_RECIPES[addon];
    if (!recipe) continue;
    for (const file of recipe.files ?? []) {
      await writeFile(
        path.join(context.projectDir, file.path),
        file.createContent(context),
        file.mode
      );
    }
  }

  // apply custom templates last
  await applyCustomTemplate(context.projectDir, context);
}
