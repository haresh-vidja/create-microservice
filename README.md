# microservice-generator

`microservice-generator` scaffolds a production-ready Node.js microservice with Docker, AWS deployment scripts, CI/CD pipelines, testing harness, and optional add-ons. The CLI is opinionated but configurable, helping teams spin up consistent services in seconds.

## Quick start

```bash
npx microservice-generator
```

Answer the interactive prompts or pass options up front:

```bash
npx microservice-generator \
  --name orders-service \
  --framework express \
  --aws ecs \
  --cicd github \
  --addons postgres,redis \
  --yes
```

## Features

- Interactive CLI with defaults driven by `~/.microservicegeneratorrc.json`.
- Express or Fastify service skeleton with health check, logging, and graceful shutdown.
- Dockerfile, docker-compose, and environment templates for local development.
- Deployment scripts plus AWS samples for ECS, Lambda, and EC2.
- CI/CD pipelines for GitHub Actions and GitLab CI.
- Optional add-ons for PostgreSQL, MongoDB, Redis, and SQS.
- Prewired Jest tests, ESLint, Prettier, and Husky pre-commit hook.
- Support for custom user templates under `~/.microservice-generator/templates/<framework>`.

## CLI options

| Option           | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `--name`         | Service name (kebab-case recommended).                       |
| `--framework`    | `express` or `fastify`.                                      |
| `--aws`          | `ecs`, `lambda`, or `ec2`.                                   |
| `--cicd`         | `github` or `gitlab`.                                        |
| `--addons`       | Comma separated add-ons: `postgres`, `mongo`, `redis`, `sqs`. |
| `--target`       | Output directory (defaults to current working directory).    |
| `--config`       | Path to config file (defaults to `~/.microservicegeneratorrc.json`). |
| `--yes`          | Skip confirmation prompt.                                    |
| `--version`      | Print CLI version.                                           |
| `--help`         | Display usage details.                                       |

## Defaults file

Define preferred answers in `~/.microservicegeneratorrc.json`:

```json
{
  "defaultFramework": "express",
  "defaultAWS": "ecs",
  "defaultCICD": "github"
}
```

## Custom templates

Override the generated files by providing a template directory:

```
~/.microservice-generator/
└── templates/
    ├── express/
    │   └── src/
    │       └── server.js
    └── fastify/
        └── README.md
```

When present, files in the framework-specific template directory are copied over the generated scaffold.

## Development

Install dependencies and run the test suite:

```bash
npm install
npm test
```

Lint the project:

```bash
npm run lint
```

## License

MIT © Haresh Vidja
