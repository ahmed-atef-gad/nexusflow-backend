# NexusFlow Backend — Repository Mind Map

```mermaid
mindmap
  root((NexusFlow Backend))
    Runtime & Boot
      src/main.ts
        HTTP API server
        MQTT microservice connector
        Global validation + CORS + cookies
        Swagger at /api
      src/app.module.ts
        ConfigModule (global)
        MongoDB connection (MONGO_URI)
        Feature module composition
    Feature Modules
      Auth
        src/auth/auth.module.ts
          JWT + Passport setup
          Exports AuthService + JwtModule
        src/auth/auth.controller.ts
          Register/Login endpoints
        src/auth/auth.service.ts
          Password hashing
          JWT issuing
        src/auth/dto
          login-user.dto.ts
          register-user.dto.ts
        src/auth/decorators
          owner.decorator.ts
          roles.decorator.ts
      Users
        src/users/users.module.ts
        src/users/users.controller.ts
        src/users/users.service.ts
        src/users/schemas/user.schema.ts
        src/users/enums/role.enum.ts
      Modules
        src/modules/modules.module.ts
        src/modules/modules.controller.ts
        src/modules/modules.service.ts
        src/modules/schemas/module.schema.ts
      Flows
        src/flows/flows.module.ts
          Depends on AuthModule + DevicesModule
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
          flow.schema.ts
          setup.schema.ts
          logic.schema.ts
          ui.schema.ts
          node.schema.ts
          edge.schema.ts
          viewport.schema.ts
          uiItem.schema.ts
        Types
          types/flow.types.ts
      Devices
        src/devices/devices.module.ts
          DeviceAuthGuard provider/export
        src/devices/devices.controller.ts
        src/devices/devices.service.ts
        src/devices/schemas
          device.schema.ts
          device-token.schema.ts
          device-audit.schema.ts
      MQTT
        src/mqtt/mqtt.module.ts
          Global module
          MQTT client registration
        src/mqtt/mqtt.controller.ts
        src/mqtt/mqtt.service.ts
    Cross-Cutting
      Guards (src/gaurds)
        auth/auth.guard.ts
        auth/roles.guard.ts
        auth/owner.guard.ts
        device-auth.guard.ts
      Persistence
        Mongoose schemas per feature
      Security
        JWT auth
        Role/owner decorators
        Device token guard
    Quality & Tooling
      Tests
        Unit specs in src/**/**.spec.ts
        E2E in test/app.e2e-spec.ts
      Config
        package.json scripts
        eslint.config.mjs
        tsconfig*.json
        nest-cli.json
```

## Suggested reading order

1. `src/main.ts` → understand runtime setup.
2. `src/app.module.ts` → understand dependency wiring.
3. `src/auth` + `src/users` → baseline identity model.
4. `src/devices` + `src/mqtt` → device connectivity.
5. `src/flows` → domain-specific orchestration logic.
