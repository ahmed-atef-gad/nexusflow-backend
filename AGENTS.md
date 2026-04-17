# AGENTS.md

## Scope

This file guides AI coding agents working in `nexusflow-backend`.

## Quick Start

- Install: `npm install`
- Dev server: `npm run start:dev`
- Build: `npm run build`
- Lint/fix: `npm run lint`
- Unit tests: `npm run test`
- E2E tests: `npm run test:e2e`

## Stack

- NestJS 11 + TypeScript
- MongoDB + Mongoose
- JWT + Passport guards
- Swagger/OpenAPI
- Embedded MQTT broker + WS support
- Jest + Supertest

## Architecture Map

- Bootstrap and app wiring: [src/main.ts](src/main.ts), [src/app.module.ts](src/app.module.ts)
- Auth and identity: [src/auth](src/auth), [src/users](src/users), [src/verification](src/verification)
- Device domain: [src/devices](src/devices)
- Flow domain and compilation/runtime docs: [src/flows](src/flows)
- MQTT runtime and handlers: [src/mqtt](src/mqtt), [src/pigeon-mqtt](src/pigeon-mqtt)
- Firmware and templates: [src/firmware](src/firmware), [src/flow-templates](src/flow-templates)

## Conventions

- Follow Nest module layout: `*.module.ts`, `*.controller.ts`, `*.service.ts`, DTOs, schemas.
- Validate request DTOs with `class-validator` decorators.
- Keep auth/role protection explicit via guards and `@Roles(...)` where required.
- Use typed exceptions from `@nestjs/common` (`BadRequestException`, `UnauthorizedException`, etc.).
- Keep business logic in services, controllers thin.

## Critical Pitfalls

- App startup requires valid `MONGO_URI` and `JWT_SECRET`.
- Several modules rely on `forwardRef` to resolve circular dependencies; preserve import patterns when refactoring.
- MQTT behavior is embedded in this service; changes in flow/device/auth can affect broker runtime paths.
- Verification and firmware routes include rate limiting; keep limits and error paths consistent when editing.

## Environment Variables

Common required variables:

- `MONGO_URI`
- `JWT_SECRET`
- `CORS_ORIGINS`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` or `SMTP_LOG_ONLY=true`
- MQTT settings (`MQTT_HOST`, `MQTT_PORT`, `MQTT_WS_PORT`, optional TLS/WSS cert vars)

## High-Value References

- Architecture doc: [docs/arch.md](docs/arch.md)
- Repository map: [docs/repo-mind-map.md](docs/repo-mind-map.md)
- API and module behavior: [README.md](README.md)
- Flow compilation/security hot spots: [src/flows/flow-builder.service.ts](src/flows/flow-builder.service.ts), [src/flows/function-node-security.util.ts](src/flows/function-node-security.util.ts)
- MQTT execution path: [src/mqtt/mqtt.handlers.ts](src/mqtt/mqtt.handlers.ts)

## Working Style

- Make minimal, focused edits inside the relevant module.
- Keep DTO/schema/controller/service changes aligned (do not update one layer in isolation).
- Run lint/tests for touched domains when practical.
- Preserve backward compatibility of public routes and payload shapes unless task explicitly requires API changes.
