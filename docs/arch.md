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
        Broker[Embedded Aedes MQTT Broker<br/>TCP or TLS 8883 + WS 8884]
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
            Perf[MQTT Performance Sessions]
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
    Mqtt --> Perf
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
  - TCP on `8883`; switches to TLS on the same port when valid TLS key/cert material is configured
  - WS on `MQTT_WS_PORT` (default `8884`) and `MQTT_WS_PATH` (default `/mqtt-ws`)
  - optional TLS/WSS cert material from env
  - Aedes broker is created by `src/pigeon-mqtt/pigeon.provider.ts`
  - broker auth, topic authorization, publish handling, disconnect handling, and performance hooks are installed by `src/mqtt/mqtt.handlers.ts`
- Notifications runtime:
  - configured in `src/notifications/notifications.module.ts`
  - Firebase Admin credentials via:
    - `FIREBASE_PROJECT_ID`
    - `FIREBASE_CLIENT_EMAIL`
    - `FIREBASE_PRIVATE_KEY`
  - optional internal trigger key: `INTERNAL_ALERTS_API_KEY`
  - rule cooldown tuning: `ALERT_RULE_COOLDOWN_MS`
  - gas alert max backoff tuning: `ALERT_RULE_MAX_BACKOFF_MS`

## MQTT Server Internals

```mermaid
flowchart TD
    ESP[ESP32 device MQTT client<br/>clientId = MAC address]
    AppClient[Web or mobile MQTT client<br/>user MQTT credentials]
    TCP[TCP or TLS listener<br/>port 8883]
    WS[WebSocket listener<br/>port 8884 path /mqtt-ws]

    subgraph Nest[NexusFlow NestJS process]
        direction TB

        subgraph Pigeon[Pigeon MQTT module]
            Provider[Pigeon provider<br/>creates Aedes broker]
            Broker[Aedes broker<br/>clients + subscriptions + packet routing]
        end

        subgraph Hooks[MqttHandlers broker hooks]
            Auth[authenticate]
            PubAuth[authorizePublish]
            SubAuth[authorizeSubscribe]
            ForwardAuth[authorizeForward]
            Publish[on publish]
            Disconnect[on clientDisconnect]
        end

        MqttService[MqttService<br/>server-side publish + active connection views]
        Perf[MqttPerformanceService<br/>sessions, latency, logic timing]
        Devices[DevicesService<br/>device credentials, owner, active flow]
        Users[UsersService<br/>user MQTT credentials]
        Logic[LogicService<br/>compiled runtime paths + cache]
        Notify[NotificationsService<br/>alert rules, incidents, push]
    end

    DB[(MongoDB)]
    FCM[Firebase Cloud Messaging]

    ESP --> TCP
    AppClient --> WS
    TCP --> Broker
    WS --> Broker
    Provider --> Broker

    Broker --> Auth
    Broker --> PubAuth
    Broker --> SubAuth
    Broker --> ForwardAuth
    Broker --> Publish
    Broker --> Disconnect

    Auth --> Devices
    Auth --> Users
    Auth --> Perf
    PubAuth --> Devices
    SubAuth --> Devices
    ForwardAuth --> Devices

    Publish --> Logic
    Publish --> MqttService
    Publish --> Notify
    Publish --> Perf
    Disconnect --> MqttService
    Disconnect --> Devices
    Disconnect --> Logic
    Disconnect --> Perf

    Devices <--> DB
    Users <--> DB
    Logic <--> DB
    Notify <--> DB
    Perf <--> DB
    Notify --> FCM
```

### MQTT Connection and Authorization

- **ESP clients** identify themselves with a MAC-address `clientId`.
  - Optional MQTT username must match the MAC address.
  - Password is checked by `DevicesService.authenticateByMacAndPassword`.
  - Revoked devices are rejected.
  - Only one live MQTT session is reserved per device MAC.
  - The broker client object is enriched with `deviceMac`, `deviceId`, `ownerId`, `ownerUsername`, `linkedFlowId`, and `connectedAt`.
  - A performance session starts when authentication succeeds.

- **User clients** authenticate with user MQTT username/password.
  - User account must be active.
  - A user can have at most 5 active MQTT sessions.
  - The broker client object is enriched with `userId`, `mqttUsername`, `authorizedDeviceMacs`, and `connectedAt`.

- **Protected topic authorization**:
  - `/devices/{mac}/...` and `devices/{mac}/...` are scoped to the matching ESP device or to a user who owns that device.
  - `esp/{mac}/...` is scoped to the matching ESP device or to a user who owns that device.
  - Wildcard subscriptions on protected topic families are accepted only when the filter still resolves to an authorized MAC.
  - Other topics are passed through the broker without custom ownership checks.

### MQTT Publish Runtime

```mermaid
sequenceDiagram
    participant ESP as ESP32
    participant Broker as Aedes Broker
    participant H as MqttHandlers
    participant Perf as MqttPerformanceService
    participant Logic as LogicService
    participant MS as MqttService
    participant NS as NotificationsService
    participant Device as Target Device

    ESP->>Broker: PUBLISH logic/input/{flowId}/{nodeId}<br/>or logic/input/{nodeId}
    Broker->>H: authorizePublish + publish event
    H->>Perf: recordInboundMessage(topic, receivedAt, publishedAt?)
    H->>H: Validate scoped flowId against client.linkedFlowId
    H->>Logic: getLogicFlowsForFlowId(flowId, deviceMac)

    alt node participates in compiled runtime path
        H->>H: Parse payload into raw readings and normalized byte value
        loop Each matching runtime path
            H->>H: Build runtime message
            opt Function step
                H->>H: Validate code at runtime and execute in restricted VM
                alt Function fails or returns null
                    H->>MS: Publish /devices/{MAC}/logic/error/{nodeId}<br/>and /devices/{MAC}/logic/debug/{nodeId}
                    H->>Perf: recordLogicPath(stopped=true)
                end
            end
            alt GPIO output step
                H->>MS: Publish command to esp/{MAC}/cmd
                Broker-->>Device: Deliver GPIO command
                H->>NS: Evaluate output alert rules
            else Flow Bridge Out step
                H->>H: Resolve target active device by targetFlowId
                H->>H: Block if target flow owner differs
                H->>H: Re-enter runtime as logic/input/{targetFlowId}/{channel}
                opt Matching Flow Bridge In node
                    H->>MS: Publish nexusflow/ui/mqtt-in/{targetFlowId}/{nodeId}
                end
            end
            H->>Perf: recordLogicPath(duration, publishedCommands)
        end
        H->>NS: Evaluate input alert rules
        H->>Perf: recordLogicPipeline(duration, matchedPaths, publishedCommands)
    else node is not part of runtime path
        H->>NS: Evaluate input alert rules only
    end

    opt ESP publishes nexusflow/output/{flowId}/{nodeId}
        Broker->>H: publish event
        H->>Logic: Check whether output node belongs to runtime path
        alt output node is not runtime-controlled
            H->>NS: Evaluate output-topic alert rules
        end
    end

    opt Flow metadata update
        MS->>Broker: Publish /devices/{MAC}/flowupdated or flowchanged
        Broker->>H: publish event
        H->>Logic: Evict compiled logic cache for device MAC
    end
```

### MQTT Operational Topics

- Device flow-cache notifications:
  - `/devices/{MAC}/flowupdated`
  - `/devices/{MAC}/flowchanged`
- Runtime input topics:
  - `logic/input/{nodeId}` legacy shape
  - `logic/input/{flowId}/{nodeId}` scoped shape
- Runtime output observation topics:
  - `nexusflow/output/{nodeId}` legacy shape
  - `nexusflow/output/{flowId}/{nodeId}` scoped shape
- Server command topic:
  - `esp/{MAC}/cmd`
- Performance clock sync:
  - ESP publishes an `.../online` topic
  - server publishes `esp/{MAC}/sync`
  - ESP responds on an `.../sync-resp` topic
- Function-node diagnostics:
  - `/devices/{MAC}/logic/error/{nodeId}`
  - `/devices/{MAC}/logic/debug/{nodeId}`
- Flow Bridge In UI fanout:
  - `nexusflow/ui/mqtt-in/{flowId}/{nodeId}`

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
    participant Logic as LogicService
    participant Notify as NotificationsService
    participant ESP as Device

    UI->>Flows: Create or update flow graph (nodes + edges)
    Flows->>Builder: Build setup + logic + ui documents
    Builder->>DB: Persist setup, logic, and ui by flowId
    Flows->>Broker: Publish /devices/{MAC}/flowupdated or flowchanged
    Broker->>Handler: publish event
    Handler->>Logic: Evict compiled logic cache for device MAC

    ESP->>Broker: Publish telemetry to logic/input/{flowId}/{nodeId}
    Broker->>Handler: authorizePublish + publish event
    Handler->>Logic: Load compiled runtime paths for active flow
    Handler->>Handler: Normalize payload and run matching paths
    Handler->>Handler: Optional function-node VM execution
    Handler->>Broker: Publish GPIO command to esp/<MAC>/cmd
    Broker-->>ESP: Execute command
    Handler->>Notify: Evaluate input/output alert rules
```

### 3.1) Cross-Flow Bridge Routing

The runtime also supports routing one flow into one or more other flows:

- `mqtt-out` nodes (UI label: Flow Bridge Out) can publish to multiple `targetFlowIds`.
- `mqtt-in` nodes (UI label: Flow Bridge In) consume forwarded messages when `channel` matches.
- Forwarding is owner-scoped; cross-owner routing is blocked.
- Bridge loops are blocked by validation: runtime paths cannot start with `mqtt-in` and terminate at `mqtt-out`.

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

### 5) Notification Pipeline (Rules + History + Push)

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
