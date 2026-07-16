# beento

Backend API and recommendation engine for Beento. Node.js + TypeScript + Express + PostgreSQL (via Prisma). See `../docs/superpowers/specs/` (in the workspace root) for the design docs this implements.

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d       # starts local Postgres
npx prisma migrate dev     # applies schema
npm run dev                # starts API on :3000
```

## Testing

```bash
npm test
```

Integration tests run against the same local Postgres (docker-compose), not mocks — bring it up first.
