import os from "os";
import path from "path";
import fs from "fs/promises";
import { describe, expect, test, beforeAll, afterAll } from "@jest/globals";
import { generateProject } from "../src/generator.js";

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "microservice-generator-"));

async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

describe("generateProject", () => {
  let workDir;

  beforeAll(async () => {
    workDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workDir);
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("creates project skeleton with express and postgres", async () => {
    const options = {
      serviceName: "orders-service",
      framework: "express",
      awsTarget: "ecs",
      ciCd: "github",
      addons: ["postgres"],
      targetDir: workDir,
    };

    await generateProject(options);

    const projectDir = path.join(workDir, "orders-service");
    const pkg = await readJson(path.join(projectDir, "package.json"));

    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.dependencies.pg).toBeDefined();
    expect(pkg.devDependencies.jest).toBeDefined();

    const compose = await fs.readFile(path.join(projectDir, "docker-compose.yml"), "utf8");
    expect(compose).toContain("postgres");

    const workflow = await fs.readFile(
      path.join(projectDir, ".github/workflows/deploy.yml"),
      "utf8"
    );
    expect(workflow).toContain("deploy:ecs");
  });
});
