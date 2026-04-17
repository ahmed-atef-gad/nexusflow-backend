# NexusFlow Backend - System Architecture

## High-Level Architecture

```mermaid
graph TD
    Web[Web/Mobile Client]
    IoT[ESP32/IoT Devices]
    SMTP[SMTP Provider]
    DB[(MongoDB)]

    subgraph API[NexusFlow NestJS Application]
        direction TB

        REST[HTTP API + Swagger]
        Broker[Embedded MQTT Broker<br/>TCP 8883 + WS 8884]
        Guards[AuthGuard + RolesGuard + OwnerGuard + DeviceAuthGuard]

        subgraph Modules[Feature Modules]
            Auth[Auth]
            Users[Users]
            Verification[Verification]
            Devices[Devices]
            Flows[Flows: flow/setup/logic/ui]
            Templates[Flow Templates]
            Catalog[Modules Catalog]
            Firmware[Firmware OTA]
            Mqtt[Mqtt Service/Handlers]
        end
    end

    Web -->|HTTPS + jwt cookie| REST
    IoT -->|HTTPS + device token| REST
    IoT -->|MQTT/MQTTS| Broker
    Web -->|MQTT over WS/WSS| Broker

    REST --> Guards
    Guards --> Modules

    Verification -->|OTP email| SMTP
    Modules <-->|read/write| DB

    Broker --> Mqtt
    Mqtt --> Devices
    Mqtt --> Flows
```

## Runtime Composition

- Bootstrap: `src/main.ts`
- Root module wiring: `src/app.module.ts`
- Global config: `ConfigModule.forRoot({ isGlobal: true })`
- Persistence: `MongooseModule.forRootAsync(...)` with `MONGO_URI`
- HTTP concerns:
  - CORS is required and validated from `CORS_ORIGINS`
  - global `ValidationPipe`
  - cookie parser
  - Swagger at `/api`
- Embedded MQTT broker:
  - configured in `src/mqtt/mqtt.module.ts`
  - TCP on `8883`
  - WS on `MQTT_WS_PORT` (default `8884`) and `MQTT_WS_PATH` (default `/mqtt-ws`)
  - optional TLS/WSS cert material from env

## Security Model

- User auth: HttpOnly cookie `jwt` (`src/gaurds/auth/auth.guard.ts`)
- Device auth: Bearer token `tokenId.secret` (`src/gaurds/device-auth.guard.ts`)
- Role checks: `RolesGuard` with owner as super-role
- Ownership checks: `OwnerGuard` for flow/device/deviceToken resources
- Important behavior:
  - `POST /auth/register` logs user in immediately (sets cookie + returns MQTT creds)
  - unverified users are blocked from most endpoints by `AuthGuard` with HTTP `428`
  - allowed while unverified: `/auth/*`, `/verification/*`, `/users/profile`

## Main Domain Flows

### 1) Registration + Email Verification

```mermaid
sequenceDiagram
    participant Client as Web/Mobile
    participant Auth as /auth/register
    participant Verify as VerificationService
    participant Mail as SMTP
    participant DB as MongoDB

    Client->>Auth: POST /auth/register
    Auth->>DB: Create user (email normalized, password hashed)
    Auth->>Verify: generateOtpForEmail
    Verify->>DB: Save OTP hash + expiry
    Verify->>Mail: Send verification OTP
    Auth-->>Client: Set jwt cookie + MQTT credentials

    Client->>Auth: Call protected endpoint
    Auth-->>Client: 428 if email not verified

    Client->>Verify: POST /verification/verify
    Verify->>DB: Validate OTP, mark email_verified=true
    Verify-->>Client: Email verified
```

### 2) Device Provisioning

```mermaid
sequenceDiagram
    participant User as Authenticated User
    participant API as Devices API
    participant Device as ESP32
    participant DB as MongoDB

    User->>API: GET /devices/registration-code
    API->>DB: Create short-lived code (8-char hex, ~10 min)
    API-->>User: code + expiry

    User->>Device: Enter code on device
    Device->>API: POST /devices/verify-registration-code
    API->>DB: Validate code + owner email_verified
    API->>DB: Create/update device + generate long-lived device token
    API-->>Device: device data + tokenId.secret
```

### 3) Flow Build and Runtime Execution

```mermaid
sequenceDiagram
    participant UI as Flow Editor
    participant Flows as /flows
    participant Builder as FlowBuilderService
    participant DB as MongoDB
    participant Broker as MQTT Broker
    participant Handler as MqttHandlers
    participant ESP as Device

    UI->>Flows: Create/Update flow graph (nodes + edges)
    Flows->>Builder: Build setup + logic + ui documents
    Builder->>DB: Persist setup/logic/ui by flowId

    ESP->>Broker: Publish telemetry to logic/input/<nodeId>
    Broker->>Handler: on publish
    Handler->>DB: Resolve linked flow logic
    Handler->>Handler: Optional function-node VM execution
    Handler->>Broker: Publish GPIO command to esp/<MAC>/cmd
    Broker-->>ESP: Execute command
```

## Feature Modules (Current)

- `auth`: register/login/logout, forgot/reset password, JWT issuing
- `users`: profile, MQTT OTP, admin user management, default owner seed
- `verification`: OTP generation/verification + password reset OTP via SMTP
- `devices`: registration code flow, device CRUD, token lifecycle, flow linking, status
- `flows`: flow CRUD + derived setup/logic/ui generation
- `flow-templates`: admin template management + user forking
- `modules`: admin catalog for hardware/module metadata
- `firmware`: admin upload/delete, device update check, device binary download (rate-limited)
- `mqtt`: broker integration, authz/authn hooks, active-client visibility, runtime flow execution

## Data Stores (MongoDB)

Main collections represented by Mongoose schemas:

- users, email verification OTPs
- devices, device tokens, device audits, registration codes
- flows, setups, logics, UIs
- flow templates
- module catalog
- firmware metadata

## Notes

- MQTT is part of this backend deployment (not an external broker in this repo).
- MQTT auth supports both user clients and ESP clients with different auth paths.
- Function nodes are statically validated and executed in a restricted VM context.
