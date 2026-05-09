# NexusFlow Backend - System Architecture

## High-Level Architecture

```mermaid
graph TD
    Web[Web or Mobile App]
    IoT[ESP32 and IoT Devices]
    SMTP[SMTP Provider]
    FCM[Firebase Cloud Messaging]
    DB[(MongoDB)]

    subgraph API[NexusFlow NestJS Application]
        direction TB

        REST[HTTP API and Swagger]
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
            Mqtt[Mqtt Service and Handlers]
            Notifications[Notifications]
        end
    end

    Web -->|HTTPS + Bearer token| REST
    IoT -->|HTTPS + device token| REST
    IoT -->|MQTT/MQTTS| Broker
    Web -->|MQTT over WS/WSS| Broker

    REST --> Guards
    Guards --> Modules

    Verification -->|OTP email| SMTP
    Notifications -->|push dispatch| FCM
    Modules <-->|read and write| DB

    Broker --> Mqtt
    Mqtt --> Devices
    Mqtt --> Flows
    Mqtt --> Notifications
```

## Runtime Composition

- Bootstrap: `src/main.ts`
- Root module wiring: `src/app.module.ts`
- Global config: `ConfigModule.forRoot({ isGlobal: true })`
- Persistence: `MongooseModule.forRootAsync(...)` with `MONGO_URI`
- HTTP concerns:
  - CORS required and validated from `CORS_ORIGINS`
  - global `ValidationPipe`
  - cookie parser
  - Swagger at `/api`
- Embedded MQTT broker:
  - configured in `src/mqtt/mqtt.module.ts`
  - TCP on `8883`
  - WS on `MQTT_WS_PORT` (default `8884`) and `MQTT_WS_PATH` (default `/mqtt-ws`)
  - optional TLS/WSS cert material from env
- Notifications runtime:
  - configured in `src/notifications/notifications.module.ts`
  - Firebase Admin credentials via:
    - `FIREBASE_PROJECT_ID`
    - `FIREBASE_CLIENT_EMAIL`
    - `FIREBASE_PRIVATE_KEY`
  - optional internal trigger key: `INTERNAL_ALERTS_API_KEY`
  - rule cooldown tuning: `ALERT_RULE_COOLDOWN_MS`
  - gas alert max backoff tuning: `ALERT_RULE_MAX_BACKOFF_MS`

## Security Model

- **User auth** (OAuth 2.0-style token rotation):
  - Access tokens: Short-lived (15m default), sent in `Authorization: Bearer` header, validated by `AuthGuard` (`src/guards/auth/auth.guard.ts`)
  - Refresh tokens: Long-lived (7d default), stored as HttpOnly cookie, hashed with bcrypt before DB storage
  - Token versioning: Invalidates all refresh tokens on logout or password reset
  - Refresh endpoint (`POST /auth/refresh`) rotates both tokens atomically
  - Refresh token only sent to `/auth/refresh` endpoint (selective credential sending)

- **Device auth**: Bearer token `tokenId.secret` (`src/guards/device-auth.guard.ts`)

- **Role checks**: `RolesGuard` with owner as super-role

- **Ownership checks**: `OwnerGuard` plus flow ownership checks in notifications service

- **Internal alerts endpoint guard**:
  - `POST /v1/internal/alerts/trigger` checks `x-internal-key`
  - validation enabled only when `INTERNAL_ALERTS_API_KEY` is configured

- **Important behavior**:
  - `POST /auth/register` logs user in immediately (issues tokens + sets refresh cookie + returns MQTT creds)
  - `POST /auth/login` issues tokens + sets refresh cookie on successful authentication
  - `POST /auth/refresh` rotates both tokens (access + refresh) on valid refresh token
  - `POST /auth/logout` invalidates all tokens by incrementing token version
  - Unverified users are blocked from most endpoints by `AuthGuard` with HTTP `428`
  - Allowed while unverified: `/auth/*`, `/verification/*`, `/users/profile`

  ### Recent security updates
  - The backend now _enforces JSON-only_ for state-changing requests (POST/PUT/PATCH/DELETE). Requests with a `Content-Type` other than `application/json` will receive `415 Unsupported Media Type` unless an endpoint is explicitly exempted (e.g., file uploads).
  - We rely on CORS preflight for cross-origin protection: browsers must pass an OPTIONS preflight before sending `application/json` mutation requests from another origin. This, combined with requiring `Authorization: Bearer` headers, blocks form-based CSRF vectors.
  - Helmet middleware is enabled at boot (`src/main.ts`) to set common security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.). CSP is disabled by default to avoid breaking Swagger during development but can be enabled in production.
  - Refresh tokens remain as HttpOnly cookies for browser clients. Native mobile apps should either use an embedded WebView for refresh (cookie semantics) or store refresh tokens securely (Keychain/Keystore) and call `/auth/refresh` with JSON (this requires a backend route change if chosen).

## Main Domain Flows

### 1) Registration + Email Verification

```mermaid
sequenceDiagram
    participant Client as Web or Mobile
    participant Auth as /auth/register
    participant Verify as VerificationService
    participant Mail as SMTP
    participant DB as MongoDB

    Client->>Auth: POST /auth/register
    Auth->>DB: Create user (email normalized, password hashed)
    Auth->>Verify: generateOtpForEmail
    Verify->>DB: Save OTP hash + expiry
    Verify->>Mail: Send verification OTP
    Auth->>Auth: Issue access token + refresh token
    Auth->>DB: Store hashed refresh token
    Auth-->>Client: Set refresh_token HttpOnly cookie + access_token in body + MQTT credentials

    Client->>Auth: Call protected endpoint with Authorization: Bearer access_token
    Auth-->>Client: 401 if access token invalid/expired, 428 if email not verified

    Client->>Verify: POST /verification/verify
    Verify->>DB: Validate OTP, mark email_verified=true
    Verify-->>Client: Email verified

    Note over Client,DB: On access token expiry:
    Client->>Auth: POST /auth/refresh (with refresh_token cookie)
    Auth->>DB: Validate refresh token hash + token version
    Auth->>Auth: Issue new access token + refresh token pair
    Auth->>DB: Store new hashed refresh token
    Auth-->>Client: Set new refresh_token cookie + new access_token in body
```

### 2) Device Provisioning

```mermaid
sequenceDiagram
    participant User as Authenticated User
    participant API as Devices API
    participant Device as ESP32
    participant DB as MongoDB

    User->>API: GET /devices/registration-code
    API->>DB: Create short-lived code (8-char hex, about 10 min)
    API-->>User: code + expiry

    User->>Device: Enter code on device
    Device->>API: POST /devices/verify-registration-code
    API->>DB: Validate code + owner email_verified
    API->>DB: Create or update device + generate long-lived device token
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

    UI->>Flows: Create or update flow graph (nodes + edges)
    Flows->>Builder: Build setup + logic + ui documents
    Builder->>DB: Persist setup/logic/ui by flowId

    ESP->>Broker: Publish telemetry to logic/input/<nodeId>
    Broker->>Handler: on publish
    Handler->>DB: Resolve linked flow logic
    Handler->>Handler: Optional function-node VM execution
    Handler->>Broker: Publish GPIO command to esp/<MAC>/cmd
    Broker-->>ESP: Execute command
```

### 3.1) Cross-Flow Bridge Routing

The runtime also supports routing one flow into one or more other flows:

- `mqtt-out` nodes (UI label: Flow Bridge Out) can publish to multiple `targetFlowIds`.
- `mqtt-in` nodes (UI label: Flow Bridge In) consume forwarded messages when `channel` matches.
- Forwarding is owner-scoped; cross-owner routing is blocked.
- A max internal hop limit is applied to prevent forwarding loops.

Practical effect: one source flow can fan-out the same processed message to multiple target flows, each continuing execution from matching Flow Bridge In nodes.

### 4) Alert Rule Evaluation and Notifications

```mermaid
sequenceDiagram
    participant ESP as Device
    participant Broker as MQTT Broker
    participant Handler as MqttHandlers
    participant NS as NotificationsService
    participant DB as MongoDB
    participant FCM as Firebase
    participant Mobile as Mobile App

    ESP->>Broker: Publish sensor readings
    Broker->>Handler: on publish
    Handler->>NS: processSensorReading(flowId, nodeId, readings)
    NS->>DB: Load enabled alert rules for flow
    NS->>NS: Evaluate rule operators (>, <, between, etc.)
    NS->>DB: Find existing open incident<br/>(user+flow+device+rule+node+module+readingKey)
    alt Rule matched && open incident exists
        NS->>NS: Check cool-off (5 min base, 15 min if acknowledged)
        alt Within cool-off window
            NS-->>Handler: Suppressed (cool-off active)
        else Cool-off expired
            NS->>DB: Update incident notification count
            NS->>NS: Build alert notification payload
            NS->>FCM: Send push to user's active devices
            FCM-->>NS: Per-token response
            NS->>DB: Mark dead tokens as inactive
        end
    else Rule matched && no open incident
        NS->>DB: Create new incident
        NS->>NS: Build alert notification payload
        NS->>FCM: Send push to user's active devices
        NS->>DB: Create notification + incident records
    else Rule not matched && open incident exists
        NS->>DB: Close incident
        NS->>NS: Build resolved notification
        NS->>FCM: Send resolution push
        NS->>DB: Create resolved notification record
    end

    Mobile->>NS: POST /v1/notifications/.../handled
    NS->>DB: Mark notification handled
    NS->>DB: Auto-mark all other pending notifications<br/>for same incident as handled
    NS->>DB: Update incident acknowledged timestamp
```

#### 4.1) Cool-off and Incident Matching

The system prevents notification spam through an **incident-based cool-off** mechanism:

- **Incident Identity**: Defined by the unique combination of `user + flow + device + rule + node + module + reading_key`.
  - When a rule fires with identical fields, it targets the **same incident**.
  - If any field differs, it's a **different incident**.

- **Cool-off Timing**:
  - **Base cool-off**: 5 minutes between notifications for the same open incident.
  - **Acknowledged cool-off**: 15 minutes if the user has already acknowledged the incident.
  - When cool-off expires, the next matching rule evaluation immediately sends a notification.

- **When cool-off does NOT apply**:
  - If the incident was already closed (resolved).
  - If a different incident opens (different rule/node/module/reading_key).
  - If this is the first notification for an incident.

#### 4.2) Auto-Handling Related Notifications

When a user handles (acknowledges) one notification for an incident, the system **automatically marks all other pending unhandled notifications for the same incident as handled** with the same timestamp.

This ensures consistency: acknowledging a single alert from an incident resolves all related notifications in that incident.

### 4) Notification Pipeline (Rules + History + Push)

```mermaid
sequenceDiagram
    participant ESP as Device
    participant MQTT as MqttHandlers
    participant N as NotificationsService
    participant DB as MongoDB
    participant FCM as Firebase
    participant App as Mobile App

    ESP->>MQTT: Sensor payload publish
    MQTT->>N: processSensorReading(flowId, nodeId, readings)
    N->>DB: Load enabled alert_rules for flow+node and evaluate operators
    N->>N: Apply cooldown/backoff and policy checks
    N->>DB: Insert alert_events
    N->>FCM: Send multicast push to active device_tokens
    FCM-->>N: Delivery result per token
    N->>DB: Mark dead tokens inactive on UNREGISTERED

    App->>N: GET /v1/flows/:flowId/alert-history?since=<hours>
    N-->>App: Last alerts + nextCursor
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
- `notifications`: FCM token registry, policies/preferences/rules, history, internal trigger endpoint, dead-token cleanup

## Data Stores (MongoDB)

Main collections represented by Mongoose schemas:

- users, email verification OTPs
- devices, device tokens, device audits, registration codes
- flows, setups, logics, UIs
- flow templates
- module catalog
- firmware metadata
- notifications:
  - `device_tokens`
  - `alert_events`
  - `notification_preferences`
  - `alert_policies`
  - `alert_rules`

## Notes

- MQTT is part of this backend deployment (not an external broker in this repo).
- MQTT auth supports both user clients and ESP clients with different auth paths.
- Function nodes are statically validated and executed in a restricted VM context.
- Notifications APIs use `flowId` in routes for flow-scoped resources.
- Device token registration is user/device-scoped and does not include `flowId`.
