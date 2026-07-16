# Security Policy

[English](SECURITY.md) | [한국어](SECURITY.ko.md)

LoopGauge executes coding agents and project commands, so treat every configuration and benchmark as executable code.

## Supported versions

Security fixes are applied to the latest release and the `main` branch while the project is experimental.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/josephuk77/LoopGauge/security/advisories/new). Do not open a public issue for credential exposure, command injection, path traversal, provider-policy bypass, or unintended network access.

Please include a minimal sanitized reproduction. Never include a real API key, proprietary prompt, private repository content, or customer data.

## Operational boundaries

- Run optimization only in repositories and environments you are authorized to test.
- Review `loop.yaml` commands before execution.
- Use restricted API keys and explicit provider budgets.
- Keep network access disabled unless the task requires it.
- Treat generated patches and model output as untrusted until reviewed and tested.
