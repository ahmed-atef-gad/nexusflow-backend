# NexusFlow Backend

The NexusFlow backend is the control plane of the project. It exposes the HTTP API used by the frontend, persists users/devices/flows in MongoDB, handles authentication and verification, serves firmware metadata and binaries, and runs the MQTT infrastructure used for real-time communication with ESP32 devices and web clients.

This service is not just a CRUD API. In the current architecture it is responsible for:

- User authentication, authorization, and role-aware access control
- Email verification and password-reset OTP delivery
- Device onboarding through one-time registration codes
- Device token issuance and device-authenticated endpoints
- Flow persistence and transformation into firmware-consumable setup/logic structures
- Flow UI metadata generation for the frontend
- Firmware upload, version tracking, update checks, and binary download
- Embedded MQTT broker startup plus backend-side MQTT event handling
- Admin-facing visibility into active MQTT connections
- Notification policy/rule evaluation, alert history persistence, and FCM push dispatch

## Tech Stack

- NestJS 11
- TypeScript
- MongoDB + Mongoose
- JWT + Passport
- Swagger / OpenAPI
- MQTT + WebSocket MQTT
- Jest + Supertest
- Docker

## Rate limiting

This project uses `@nestjs/throttler` to protect sensitive endpoints (login, OTP, password-reset, firmware download, etc.). Notes for this repository:

- Install: `npm i --save @nestjs/throttler` (already a dependency here).
- Module config: `ThrottlerModule.forRoot([...])` is used in [src/app.module.ts](src/app.module.ts#L1-L240). The options are defined as an array of throttler sets and the repo uses TTL values in seconds (not milliseconds).
- Global guard: the `ThrottlerGuard` is registered via the `APP_GUARD` provider in [src/app.module.ts](src/app.module.ts#L1-L240). Do not additionally call `app.useGlobalGuards(...)` in [src/main.ts](src/main.ts#L1-L120).
- Per-route overrides: use the decorator form `@Throttle({ default: { limit: <n>, ttl: <seconds> } })` on controllers or routes. Examples exist in:
  - [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L1-L260)
  - [src/verification/verification.controller.ts](src/verification/verification.controller.ts#L1-L200)
- Skip certain routes with `@SkipThrottle()` when needed.
- If running behind a proxy, enable `trust proxy` for the HTTP adapter and/or implement a custom tracker (see NestJS docs) so the guard can extract the real client IP from `X-Forwarded-For`.

Tuning advice:

- Use stricter limits for login attempts (e.g. 5 attempts / 60s) and OTP sends (e.g. 3 sends / 1h).
- Add named throttlers when you need multiple layered rules (short/medium/long windows).

## Architecture Summary

The application boots from [`src/main.ts`](src/main.ts) and composes feature modules in [`src/app.module.ts`](src/app.module.ts).

At startup, the backend:

1. Loads environment variables through `ConfigModule`
2. Connects to MongoDB
3. Enables validated CORS from `CORS_ORIGINS`
4. Registers a global `ValidationPipe`
5. Enables cookie parsing
6. Builds Swagger docs at `/api`
7. Starts Nest microservices (if any are configured)
8. Starts the HTTP server

The backend serves two communication layers:

- HTTP API for the web app, firmware setup sync, registration, verification, and firmware operations
- MQTT broker services for telemetry, commands, online/offline presence, and real-time control

## Module Breakdown

### `auth`

Files: [`src/auth`](src/auth)

Responsibilities:

- User registration and login
- JWT issuance
- Password reset entry points
- Shared auth guard wiring

Notes:

- JWT secret is loaded from `JWT_SECRET`
- Tokens are currently signed with a `1d` expiration window

### `users`

Files: [`src/users`](src/users)

Responsibilities:

- User persistence
- Roles and account activation state
- Default owner seeding

Related seed logic:

- [`src/users/default-owner.seed.ts`](src/users/default-owner.seed.ts)

### `verification`

Files: [`src/verification`](src/verification)

Responsibilities:

- Email OTP generation and verification
- Password reset OTP flow
- SMTP-based email delivery

Related mailer:

- [`src/verification/smtp-mail.service.ts`](src/verification/smtp-mail.service.ts)

This service supports both real SMTP delivery and a fallback `SMTP_LOG_ONLY=true` mode for development.

### `devices`

Files: [`src/devices`](src/devices)

Responsibilities:

- Device registration by user
- One-time registration code generation
- Device self-registration with registration code
- Device token generation and revocation
- Device-to-flow linking
- Device status lookup
- Device ownership enforcement

Important controllers:

- [`src/devices/devices.controller.ts`](src/devices/devices.controller.ts)
- [`src/devices/device-registration.controller.ts`](src/devices/device-registration.controller.ts)

### `flows`

Files: [`src/flows`](src/flows)

Responsibilities:

- Flow CRUD
- Setup document generation for firmware
- Logic extraction from node/edge graphs
- UI document generation for the frontend

Key implementation:

- [`src/flows/flows.controller.ts`](src/flows/flows.controller.ts)
- [`src/flows/flow-builder.service.ts`](src/flows/flow-builder.service.ts)
- [`src/flows/setup.service.ts`](src/flows/setup.service.ts)
- [`src/flows/logic.service.ts`](src/flows/logic.service.ts)
- [`src/flows/ui.service.ts`](src/flows/ui.service.ts)

The flow builder converts visual graph nodes into:

- `setup`: low-level pin/mode configuration for firmware startup
- `tasks`: periodic runtime tasks for sensor polling and GPIO operations
- `ui`: frontend-facing module/topic metadata
- logic runtime paths from input nodes through optional function nodes to output nodes

### Function Node Runtime

The backend now supports a `logic-function` node in flow logic.

High-level behavior:

- Flow graphs can now compile paths like `input -> function -> output`
- Multiple function nodes can be chained in one path
- Function code is stored on the flow node under `data.variables.code`
- Runtime execution happens server-side inside [`src/mqtt/mqtt.handlers.ts`](src/mqtt/mqtt.handlers.ts)

Compilation details:

- [`src/flows/flow-builder.service.ts`](src/flows/flow-builder.service.ts) now compiles logic into ordered runtime steps:
  - `input`
  - `function`
  - `output`
- Cycles are detected and skipped with warnings
- Function nodes without valid downstream outputs are skipped with warnings

Runtime message contract:

- For paths that include a function node, `msg.payload` starts as the raw MQTT task/telemetry packet
- For direct non-function paths, behavior remains compatible with the old normalized scalar flow
- `msg` currently includes:
  - `msg.payload`
  - `msg.value`
  - `msg.topic`
  - `msg.nodeId`
  - `msg.moduleId`
  - `msg.flowId`
  - `msg.device.macAddress`
  - `msg.input.payload`
  - `msg.input.normalized`
  - `msg.input.topic`
  - `msg.metadata.timestamp`

Function return contract:

- `return msg;`
- `return { payload: ... };`
- `return <primitive>;`
- `return null;` to stop the path

Important runtime note:

- Function code is statically validated (AST checks) at compile time and again before runtime execution
- Runtime execution uses a strict VM context with dynamic code generation disabled, payload-size guardrails, and execution timeout limits
- Function code that violates validation/security rules is rejected and the logic path is stopped safely

### `flow-templates`

Files: [`src/flow-templates`](src/flow-templates)

Responsibilities:

- Reusable starter flows
- Template creation, update, and forking workflows

### `modules`

Files: [`src/modules`](src/modules)

Responsibilities:

- Central catalog of supported modules
- Metadata used by the frontend flow editor and flow-builder pipeline

### `firmware`

Files: [`src/firmware`](src/firmware)

Responsibilities:

- Admin firmware upload
- Firmware metadata persistence
- Device update checks
- Secure-ish download endpoint with rate limiting

Key controller:

- [`src/firmware/firmware.controller.ts`](src/firmware/firmware.controller.ts)

Behavior:

- Accepts `.bin` firmware uploads
- Stores metadata such as version, checksum, and size
- Exposes `/firmware/device/check` for device-side version checks
- Exposes `/firmware/device/download` for binary delivery

### `mqtt`

Files: [`src/mqtt`](src/mqtt)

Responsibilities:

- MQTT broker bootstrapping
- WebSocket MQTT support
- Real-time publish helpers
- Tracking and exposing active MQTT client state
- Wiring handlers that react to live MQTT events

Key files:

- [`src/mqtt/mqtt.module.ts`](src/mqtt/mqtt.module.ts)
- [`src/mqtt/mqtt.service.ts`](src/mqtt/mqtt.service.ts)
- [`src/mqtt/mqtt.handlers.ts`](src/mqtt/mqtt.handlers.ts)
- [`src/mqtt/mqtt.controller.ts`](src/mqtt/mqtt.controller.ts)

The MQTT module currently configures:

- TCP broker on `8883`
- MQTT over WebSocket on `8884` by default
- optional TLS/WSS material via environment variables

### `notifications`

Files: [`src/notifications`](src/notifications)

Responsibilities:

- Mobile FCM device-token registration and token lifecycle management
- Alert policy management (`alert_policies`)
- User notification preference management (`notification_preferences`)
- Alert rule CRUD and runtime rule evaluation (`alert_rules`)
- Alert history persistence with cursor pagination (`alert_events`)
- Alert history defaults to the last 24 hours and supports `since` (hours)
- Firebase push dispatch and dead-token cleanup on `UNREGISTERED`
- MQ2 gas alerts use exponential backoff to reduce repeated spam while condition remains active
- Internal alert trigger endpoint for backend services

Key files:

- [`src/notifications/notifications.service.ts`](src/notifications/notifications.service.ts)
- [`src/notifications/notifications.controller.ts`](src/notifications/notifications.controller.ts)
- [`src/notifications/project-alert-config.controller.ts`](src/notifications/project-alert-config.controller.ts)
- [`src/notifications/project-alert-history.controller.ts`](src/notifications/project-alert-history.controller.ts)
- [`src/notifications/notifications-internal.controller.ts`](src/notifications/notifications-internal.controller.ts)

## Request / Data Flow

Typical user-side path:

1. User authenticates through the frontend
2. Frontend creates or edits a visual flow
3. Backend stores the flow and derives setup/logic/UI data
4. User links a device to that flow
5. Device syncs setup from backend
6. Device publishes telemetry over MQTT
7. Backend may execute server-side function/runtime logic for linked flows
8. Frontend subscribes to real-time updates through MQTT over WebSocket
9. Backend evaluates configured alert rules and persists alert history
10. Backend dispatches push notifications through FCM for matched alerts

Typical device-side onboarding path:

1. Authenticated user generates a one-time registration code
2. ESP32 firmware submits the code and its device metadata
3. Backend verifies the code and owner state
4. Backend creates the device record and issues a long-lived device token
5. Firmware stores the token and later uses it for authenticated device endpoints
6. Firmware checks for updates and fetches its setup document

## Environment Variables

The project reads configuration from `.env` through Nest `ConfigModule`.

### Required

```env
MONGO_URI=mongodb://localhost:27017/nexusflow
JWT_SECRET=replace-with-a-strong-secret
CORS_ORIGINS=http://localhost:8080,http://localhost:4173
```

### Common Core Variables

```env
PORT=3000
```

### MQTT / Broker

```env
MQTT_WS_PORT=8884
MQTT_WS_PATH=/mqtt-ws
MQTT_TLS_KEY=
MQTT_TLS_CERT=
MQTT_TLS_CA=
MQTT_TLS_PASSPHRASE=
MQTT_WSS_KEY=
MQTT_WSS_CERT=
MQTT_WSS_CA=
MQTT_WSS_PASSPHRASE=
```

### SMTP / Verification

```env
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=
SMTP_SECURE=true
SMTP_LOG_ONLY=false
SMTP_EMAIL_LOGO_PATH=
SMTP_EMAIL_LOGO_BASE64=
SMTP_EMAIL_LOGO_MIME_TYPE=
SMTP_EMAIL_LOGO_FILENAME=
```

### Default Owner Seed

```env
DEFAULT_OWNER_EMAIL=
DEFAULT_OWNER_USERNAME=owner
DEFAULT_OWNER_PASSWORD=
```

### Flow Builder Tuning

```env
MIN_INTERVAL_MS=250
MAX_INTERVAL_MS=60000
DEFAULT_GPIO_INTERVAL_MS=1000
DEFAULT_GPIO_OUTPUT_INTERVAL_MS=10000
DEFAULT_SENSOR_INTERVAL_MS=5000
DEFAULT_PIR_INTERVAL_MS=1000
FUNCTION_NODE_MAX_CODE_LENGTH=2000
FUNCTION_NODE_MAX_AST_NODES=300
FUNCTION_NODE_EXECUTION_TIMEOUT_MS=100
FUNCTION_NODE_MAX_PAYLOAD_BYTES=8192
MQTT_LOGIC_CACHE_TTL_MS=3000
MQTT_LOGIC_CACHE_MAX_ENTRIES=1000
MQTT_LOGIC_CACHE_SWEEP_INTERVAL_MS=30000
```

### Notifications / FCM

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
INTERNAL_ALERTS_API_KEY=
ALERT_RULE_COOLDOWN_MS=60000
ALERT_RULE_MAX_BACKOFF_MS=900000
```

Notes:

- `MONGO_URI` is mandatory. The app throws if it is missing.
- `CORS_ORIGINS` must contain valid `http` or `https` origins.
- `JWT_SECRET` should always be explicitly set.
- SMTP can be left unconfigured only if you accept mail delivery failure or use `SMTP_LOG_ONLY=true`.
- MQTT WebSocket defaults are defined in [`src/mqtt/mqtt.module.ts`](src/mqtt/mqtt.module.ts).

## Installation

```sh
npm install
```

## Running Locally

Development mode:

```sh
npm run start:dev
```

Useful local endpoints:

- HTTP API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/api`
- MQTT over WebSocket default path: `ws://localhost:8884/mqtt-ws`

Build:

```sh
npm run build
```

Production run:

```sh
npm run start:prod
```

## Docker

The included [`Dockerfile`](Dockerfile) builds the app in a multi-stage image and exposes:

- `3000` for HTTP API
- `1883`
- `8883`
- `8884`

Example:

```sh
docker build -t nexusflow-backend .
docker run --env-file .env -p 3000:3000 -p 8883:8883 -p 8884:8884 nexusflow-backend
```

## API Surface Overview

This README is not a full API reference. Swagger at `/api` is the source of truth. The main route groups are:

- `/auth`: login, register, forgot password, reset password
- `/verification`: OTP generation and verification flows
- `/users`: user/admin operations
- `/devices`: device CRUD, tokens, status, flow linking
- `/devices/registration-code`: one-time code generation
- `/devices/verify-registration-code`: firmware/device self-registration
- `/flows`: flow CRUD
- `/setups` and related flow-derived endpoints: firmware sync/setup material
- `/ui`: frontend-facing flow UI representation
- `/modules`: available editor modules
- `/flow-templates`: reusable template management
- `/firmware/admin/*`: admin firmware management
- `/firmware/device/*`: device firmware update endpoints
- `/mqtt/*`: MQTT test/admin visibility endpoints
- `/v1/notifications/devices/register`: register or refresh mobile FCM token (device-level, no `flowId` in payload)
- `/v1/alert-policies`: global policy catalog per `moduleId + readingKey`
- `/v1/flows/:flowId/notification-preferences`: per-user flow notification settings
- `/v1/flows/:flowId/alert-rules`: alert rule CRUD for specific flow nodes
- `/v1/flows/:flowId/alert-history`: missed/previous alerts with cursor pagination
- `/v1/internal/alerts/trigger`: internal alert ingestion endpoint

## MQTT Role In The System

MQTT is part of the backend deployment, not a separate external broker in this repo's current architecture.

It is used for:

- Device telemetry
- Device online/offline state
- Device metrics
- Real-time command dispatch
- Flow-triggered output control
- Admin visibility into connected clients

From the device/controller code and flow-builder output, common topic patterns include:

- `esp/<MAC>/cmd`
- `esp/<MAC>/resetwifi`
- `esp/<MAC>/instant`
- `client/<MAC>/online`
- `client/<MAC>/metrics`
- `logic/input/<nodeId>`
- `esp/<nodeId>/response`

Function-node payload note:

- Sensor/task packets published to `logic/input/<nodeId>` are preserved as raw payload objects when a flow path contains a function node
- Direct input-to-output paths still use the existing normalized scalar behavior for compatibility with GPIO output control

## Testing

Unit tests:

```sh
npm test
```

Coverage:

```sh
npm run test:cov
```

End-to-end tests:

```sh
npm run test:e2e
```

Current test coverage in the repo includes:

- auth
- users
- modules
- flows
- guards
- app bootstrap
- e2e smoke path

## Project References

- [`src/main.ts`](src/main.ts): app bootstrap
- [`src/app.module.ts`](src/app.module.ts): root wiring
- [`src/flows/flow-builder.service.ts`](src/flows/flow-builder.service.ts): graph-to-setup/logic translation
- [`src/devices/devices.controller.ts`](src/devices/devices.controller.ts): user device operations
- [`src/devices/device-registration.controller.ts`](src/devices/device-registration.controller.ts): firmware onboarding flow
- [`src/firmware/firmware.controller.ts`](src/firmware/firmware.controller.ts): firmware lifecycle endpoints
- [`src/mqtt/mqtt.module.ts`](src/mqtt/mqtt.module.ts): broker configuration
- [`src/notifications/notifications.service.ts`](src/notifications/notifications.service.ts): notification pipeline logic
- [`src/verification/smtp-mail.service.ts`](src/verification/smtp-mail.service.ts): SMTP integration
- [`docs/repo-mind-map.md`](docs/repo-mind-map.md): repository-level overview
- [`docs/notifications-system.md`](docs/notifications-system.md): notifications deep-dive and mobile contract
- [`docs/NexusFlow.postman_collection.json`](docs/NexusFlow.postman_collection.json): Postman collection

## Integration Notes

- The frontend depends on this backend for auth, flow persistence, admin data, device management, verification, and firmware workflows.
- The ESP32 firmware depends on this backend for registration verification, device token provisioning, setup synchronization, and firmware update checks.
- Because the MQTT broker is started by the backend itself, HTTP and MQTT availability are coupled in the current deployment model.
