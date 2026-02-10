# NexusFlow Backend

Minimal NestJS backend for the NexusFlow project.  
Key pieces:

- Entry: [`src/main.ts`](src/main.ts) (bootstrap + Swagger at `/api`)  
- App wiring: [`AppModule`](src/app.module.ts)  
- Auth: [`AuthController`](src/auth/auth.controller.ts) and [`AuthService`](src/auth/auth.service.ts) using [`LoginUserDto`](src/auth/dto/login-user.dto.ts) and [`RegisterUserDto`](src/auth/dto/register-user.dto.ts)  
- Users: [`UsersService`](src/users/users.service.ts) and the [`User` schema](src/users/schemas/user.schema.ts)  
- Scripts and deps: [package.json](package.json)  
- Environment: [.env]

## Requirements

- Node.js 18+ (or a recent LTS)
- npm 9+ (or yarn)
- A MongoDB instance (connection string in `MONGO_URI`)

## Install

1. Clone the repository (if you haven't already)

```sh
git clone <repo-url>
cd nexusflow-backend
```

2. Install dependencies

```sh
npm install
```

3. Configure environment variables

Create a `.env` file in the project root (or edit the existing one). Required variables:

```
MONGO_URI=<your MongoDB connection string>
JWT_SECRET=<a secure secret for JWT signing>
```

## Run (development)

Start the app in watch mode:

```sh
npm run start:dev
```

- Swagger UI will be available at: <http://localhost:3000/api> (configured in [`src/main.ts`](src/main.ts))
- AppModule and providers are defined in [`src/app.module.ts`](src/app.module.ts)

## Build / Run (production)

Build:

```sh
npm run build
```

Run:

```sh
npm run start:prod
```

## Tests

Run unit tests:

```sh
npm test
```

Run e2e tests:

```sh
npm run test:e2e
```

## Repository mind map

- See [`docs/repo-mind-map.md`](docs/repo-mind-map.md) for a visual Mermaid mind map of the project structure and dependencies.

## Important files & symbols

- Application bootstrap: [`src/main.ts`](src/main.ts) (`bootstrap`)  
- Module: [`AppModule`](src/app.module.ts)  
- Auth controller/service: [`AuthController`](src/auth/auth.controller.ts), [`AuthService`](src/auth/auth.service.ts)  
- DTOs: [`LoginUserDto`](src/auth/dto/login-user.dto.ts), [`RegisterUserDto`](src/auth/dto/register-user.dto.ts)  
- Users service & schema: [`UsersService`](src/users/users.service.ts), [`User` schema](src/users/schemas/user.schema.ts)  
- Scripts & metadata: [package.json](package.json)

## Notes

- Passwords are hashed via `bcrypt` in [`AuthService`](src/auth/auth.service.ts).
- JWT configuration uses `@nestjs/jwt` and reads `JWT_SECRET` from the environment (configured in [`src/auth/auth.module.ts`](src/auth/auth.module.ts)).
- Ensure unique indexes for `email`/`username` in the database to match schema constraints in [`src/users/schemas/user.schema.ts`](src/users/schemas/user.schema.ts).