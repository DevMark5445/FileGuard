# FileGuard authentication API

The API stores users in MongoDB, hashes passwords with bcrypt, and uses one-day
JWT bearer tokens. Public registration always creates a `user`; only a signed-in
`superadmin` can create an `admin`.

## Setup

1. Install Node.js and start a MongoDB instance.
2. From this directory, copy `.env.example` to `.env` and set a unique
   `JWT_SECRET` (at least 32 characters) and strong super-admin credentials.
3. Run `npm install`, then `npm run dev` for development or `npm start`.
4. Configure the frontend `VITE_API_URL` if the API is not available through
   the Vite `/api` proxy. The development proxy targets `http://localhost:5000`.

The super-admin is created on first startup when its configured email is not
already present. The configured credentials do not overwrite an existing
super-admin account. The same email cannot be used to silently elevate an
ordinary account.

## Authentication routes

All routes are prefixed with `/api/auth`.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/register` | Public | Create a user account and sign in |
| `POST` | `/login` | Public | Sign in and receive a bearer token |
| `GET` | `/me` | Authenticated | Validate the token and return the current user |
| `POST` | `/logout` | Authenticated | Invalidate all tokens for the current account |
| `POST` | `/admins` | Super admin | Create an administrator account |

Registration and login return `{ "user": { "id", "name", "email", "role", "created" }, "token": "..." }`.
Send the token as `Authorization: Bearer <token>` to protected routes. The
password is never returned by the API.
