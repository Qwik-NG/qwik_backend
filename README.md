# Qwik Backend

## Local Setup

1. Copy `.env.example` to `.env` and set real values.
2. Install dependencies:

```bash
npm install
```

3. Create a Cloudinary account and copy your cloud name, API key, and API secret into `.env`.
4. Push schema to database:

```bash
npx prisma db push
```

5. (Optional) Seed demo data:

```bash
npm run seed
```

6. Start dev server:

```bash
npm run dev
```

## Required Environment Variables

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/qwik_database?schema=public"
JWT_SECRET="replace_with_a_long_random_secret"
FRONTEND_URL="https://qwik.ng"
APP_ORIGINS="http://localhost:5173,https://your-frontend.vercel.app"
SOCKET_ORIGINS="http://localhost:5173,https://your-frontend.vercel.app"
PUBLIC_URL="https://api.your-domain.com"
BACKEND_URL="https://api.your-domain.com"
RESEND_API_KEY=""
RESEND_FROM_EMAIL="Qwik.ng <no-reply@mail.qwik.ng>"
PORT=4000
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
CLOUDINARY_FOLDER="qwik/ads"
```

## Production (Render)

- Set `DATABASE_URL` to your production Postgres URL.
- Set a strong random `JWT_SECRET`.
- Set `FRONTEND_URL` to your primary deployed frontend domain.
- Set `APP_ORIGINS` and `SOCKET_ORIGINS` as comma-separated allowed origins, for example `http://localhost:5173,https://your-frontend.vercel.app`.
- Set `PUBLIC_URL` and `BACKEND_URL` to your deployed backend URL, for example `https://api.qwik.ng`.
- Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for password reset email delivery in production.
- Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` from your Cloudinary dashboard. Cloudinary is required for production image uploads.
- Optionally set `CLOUDINARY_FOLDER` if you want uploads grouped under a custom folder path.

## Resend Password Reset Setup

1. Verify a sending domain in Resend using either `qwik.ng` or a mail subdomain such as `mail.qwik.ng`.
2. Add all DNS records provided by Resend (SPF, DKIM, and any required return-path records) in your DNS provider.
3. In Render, set:
   - `RESEND_API_KEY` to your live Resend API key
   - `RESEND_FROM_EMAIL` to a verified sender, for example `Qwik.ng <no-reply@mail.qwik.ng>`
   - `FRONTEND_URL=https://qwik.ng`
4. Restart the backend service after saving env vars.
5. Test end-to-end by requesting forgot password, opening the received link, and completing reset on `/create-password?token=...`.

## Cloudinary Setup

1. Create or sign in to your Cloudinary account.
2. Open the Dashboard and copy:
   - Cloud name
   - API Key
   - API Secret
3. Paste those values into your backend `.env`.
4. Restart the backend server after updating env vars.

Uploaded ad images are stored in Cloudinary, while the database stores only the returned image URLs.
