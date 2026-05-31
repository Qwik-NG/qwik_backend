# Qwik Backend

## Local Setup
1. Copy `.env.example` to `.env` and set real values.
2. Install dependencies:
```bash
npm install
```
3. Push schema to database:
```bash
npx prisma db push
```
4. (Optional) Seed demo data:
```bash
npm run seed
```
5. Start dev server:
```bash
npm run dev
```

## Required Environment Variables
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/qwik_database?schema=public"
JWT_SECRET="replace_with_a_long_random_secret"
FRONTEND_URL="http://localhost:5173"
PORT=4000
```

## Production (Render)
- Set `DATABASE_URL` to your production Postgres URL.
- Set a strong random `JWT_SECRET`.
- Set `FRONTEND_URL` to your deployed frontend domain.
