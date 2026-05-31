## Qwik Full-Stack V1 Plan (UI to Working Marketplace)

### Summary
Build `qwik_backend` as a Node/Express + Prisma API on PostgreSQL, then connect the existing React UI to real endpoints in phases.  
V1 scope: Marketplace Core only (auth, profiles, ads, search/filter, saved items, image upload), with chat and payments deferred to Phase 2.

### Key Changes
1. **Backend foundation**
- Initialize backend service with Express, TypeScript, Prisma, and PostgreSQL.
- Add core modules: `auth`, `users`, `ads`, `categories`, `saved`, `uploads`.
- Add shared middleware: auth guard (JWT), validation, error handler, request logging, CORS.
- Add environment/config setup (`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, storage keys).

2. **Data model (Prisma)**
- Core entities: `User`, `UserProfile`, `Category`, `Ad`, `AdImage`, `SavedAd`.
- Include ad lifecycle fields (`status`, `isPromoted`, `createdAt`, `updatedAt`) and owner relations.
- Add indexes for search and listing performance (`categoryId`, `location`, `createdAt`, `status`).

3. **Public API/interfaces**
- `POST /auth/register`, `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/me`
- `GET /categories`
- `GET /ads`, `GET /ads/:id`, `POST /ads`, `PATCH /ads/:id`, `DELETE /ads/:id`
- `POST /ads/:id/save`, `DELETE /ads/:id/save`, `GET /users/me/saved`
- `POST /uploads/images` (multi-image upload for new advert flow)
- `GET /users/me`, `PATCH /users/me`
- Response convention: `{ success, data, message?, meta? }`; paginated list endpoints include `meta.page`, `meta.pageSize`, `meta.total`.

4. **Frontend integration**
- Add API client layer and auth token storage.
- Replace hardcoded seed/static data in key pages with backend calls:
  - Auth screens (`LoginPage`, `SignUpPage`, password recovery screens)
  - Home/search/product details (real ads and categories)
  - Post/new advert flow (create ad + upload images)
  - Saved page (save/unsave + list)
  - Profile/account settings (read/update user profile)
- Keep existing UI design intact; only wire behaviors/data.

5. **Delivery sequence**
- Milestone 1: Backend bootstrap + schema + auth endpoints.
- Milestone 2: Ads/categories/search + product detail wiring.
- Milestone 3: Create advert + image upload + saved items.
- Milestone 4: Profile endpoints + frontend cleanup + deploy.
- Milestone 5: Production hardening (rate limiting, basic monitoring, docs).

### Test Plan
- Backend unit/integration tests:
  - Auth: register/login, invalid credentials, protected route access.
  - Ads: create/update/delete ownership checks, list/filter/pagination.
  - Saved: save/unsave idempotency, per-user isolation.
  - Uploads: file type/size validation and storage success path.
- Frontend functional checks:
  - Sign up/login/logout flow persists session and protects authenticated actions.
  - Home/search/product details load live data and handle empty/error states.
  - Post advert creates item and shows on listing/detail pages.
  - Save/unsave reflects immediately and persists after refresh.
- Deployment smoke tests:
  - Health check endpoint, DB connectivity, CORS from deployed frontend, env vars validated at startup.

### Assumptions and Defaults
- Stack locked: **Node + Express + Prisma**, **PostgreSQL**.
- V1 auth: **Email + Password + JWT** (social auth UI remains non-functional placeholder in v1).
- Deployment target: **Render backend + Neon Postgres**.
- V1 excludes real-time chat, payments, and ad promotion billing logic; those move to Phase 2.
- Frontend repo remains separate from backend repo/folder, but uses shared API contract docs.
