# NexusFlow Backend - Repository Mind Map

```mermaid
mindmap
  root((NexusFlow Backend))
    Runtime and Boot
      src/main.ts
        CORS from CORS_ORIGINS
        Global ValidationPipe
        Cookie parser
        Swagger at /api
      src/app.module.ts
        ConfigModule global
        Mongoose connection via MONGO_URI
        Feature modules wired at root

    Feature Modules
      Auth
        src/auth/auth.module.ts
          JWT + Passport wiring
          Depends on Users + Verification
        src/auth/auth.controller.ts
          register, login, logout
          forgot-password, reset-password
        src/auth/auth.service.ts
          JWT issuance
          MQTT password rotation on login
          token_version invalidation support

      Users
        src/users/users.module.ts
          Includes default-owner seeding
        src/users/users.controller.ts
          profile + mqtt-otp
          admin user CRUD/list
        src/users/users.service.ts
        src/users/schemas/user.schema.ts

      Verification
        src/verification/verification.module.ts
          RateLimiter module
          OTP schema + SMTP service
        src/verification/verification.controller.ts
          /verification/generate
          /verification/verify
        src/verification/verification.service.ts
          email verification OTP flow
          password-reset OTP flow

      Devices
        src/devices/devices.module.ts
          DeviceAuthGuard provider/export
          registration code schema included
        src/devices/device-registration.controller.ts
          /devices/registration-code
          /devices/verify-registration-code
        src/devices/devices.controller.ts
          device CRUD
          token issuance/revocation
          flow linking + status
        src/devices/devices.service.ts

      Flows
        src/flows/flows.module.ts
          Depends on Auth + Devices + Users
        Controllers
          flows.controller.ts
          setup.controller.ts
          logic.controller.ts
          ui.controller.ts
        Services
          flows.service.ts
          flow-builder.service.ts
          setup.service.ts
          logic.service.ts
          ui.service.ts
        Schemas
          flow, setup, logic, ui
          node, edge, viewport, uiItem
        Security utility
          function-node-security.util.ts

      Flow Templates
        src/flow-templates/flow-templates.module.ts
        src/flow-templates/flow-templates.controller.ts
          admin template CRUD
          user fork endpoint
        src/flow-templates/flow-templates.service.ts

      Modules Catalog
        src/modules/modules.module.ts
        src/modules/modules.controller.ts
          admin-only module catalog CRUD
        src/modules/modules.service.ts
        src/modules/schemas/module.schema.ts

      Firmware
        src/firmware/firmware.module.ts
          RateLimiter module
        src/firmware/firmware.controller.ts
          /firmware/admin/upload
          /firmware/admin/:id
          /firmware/device/check
          /firmware/device/download
        src/firmware/firmware.service.ts

      MQTT
        src/mqtt/mqtt.module.ts
          Global module
          Embedded broker via PigeonModule
          Imports NotificationsModule for runtime alerts
        src/mqtt/mqtt.controller.ts
          test publish endpoint
          admin active-clients endpoints
        src/mqtt/mqtt.service.ts
        src/mqtt/mqtt.handlers.ts
          broker auth/authz hooks
          server-side flow runtime execution
          evaluates alert rules on incoming sensor readings

      Notifications
        src/notifications/notifications.module.ts
          controllers
            notifications.controller.ts
            notifications-internal.controller.ts
            project-alert-config.controller.ts
            project-alert-history.controller.ts
          service
            notifications.service.ts
              FCM initialization and send
              dead token cleanup on UNREGISTERED
              alert history pagination
              policy and preference enforcement
              rule evaluation and cooldown
          schemas
            notification-device-token.schema.ts
            alert-event.schema.ts
            notification-preference.schema.ts
            alert-policy.schema.ts
            alert-rule.schema.ts
          dto
            register-notification-device.dto.ts
            trigger-alert.dto.ts
            alert-history-query.dto.ts
            update-notification-preferences.dto.ts
            upsert-alert-policies.dto.ts
            create-alert-rule.dto.ts
            update-alert-rule.dto.ts

      Pigeon MQTT Infra
        src/pigeon-mqtt
          custom transport abstraction
          decorators/providers/validators

    Cross-Cutting
      Guards (src/gaurds)
        auth/auth.guard.ts
        auth/roles.guard.ts
        auth/owner.guard.ts
        device-auth.guard.ts
      Persistence
        MongoDB with Mongoose schemas per domain
      Security
        JWT cookie auth
        Role + ownership authorization
        device token authentication
        Internal alerts key via INTERNAL_ALERTS_API_KEY

    Docs and Tooling
      docs/arch.md
      docs/repo-mind-map.md
      docs/mind-map.md
      docs/notifications-system.md
      docs/NexusFlow.postman_collection.json
      Testing
        unit specs under src/**/*.spec.ts
        e2e in test/app.e2e-spec.ts
      Config
        package.json scripts
        eslint.config.mjs
        tsconfig*.json
        nest-cli.json
```

## Suggested Reading Order

1. `src/main.ts` -> runtime bootstrap and global middleware
2. `src/app.module.ts` -> dependency and module composition
3. `src/auth` + `src/users` + `src/verification` -> identity and access model
4. `src/devices` + `src/mqtt` + `src/pigeon-mqtt` -> device connectivity and broker behavior
5. `src/flows` + `src/flow-templates` + `src/modules` -> domain logic and flow orchestration
6. `src/notifications` -> push pipeline, rules, preferences, and history
7. `src/firmware` -> OTA firmware lifecycle
