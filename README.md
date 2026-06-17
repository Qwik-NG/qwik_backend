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
FRONTEND_URL="http://localhost:5173"
APP_ORIGINS="http://localhost:5173,https://your-frontend.vercel.app"
SOCKET_ORIGINS="http://localhost:5173,https://your-frontend.vercel.app"
PUBLIC_URL="https://api.your-domain.com"
BACKEND_URL="https://api.your-domain.com"
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
- Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` from your Cloudinary dashboard. Cloudinary is required for production image uploads.
- Optionally set `CLOUDINARY_FOLDER` if you want uploads grouped under a custom folder path.

## Cloudinary Setup
1. Create or sign in to your Cloudinary account.
2. Open the Dashboard and copy:
	- Cloud name
	- API Key
	- API Secret
3. Paste those values into your backend `.env`.
4. Restart the backend server after updating env vars.

Uploaded ad images are stored in Cloudinary, while the database stores only the returned image URLs.
