# WESCOMM

WESCOMM is the Wesleyan Integrated Commissary Management System. It provides
student stock browsing and reservations, staff inventory operations, and admin
monitoring through one responsive web platform.

## Repository structure

- `frontend/` - Next.js 14 App Router web application
- `backend/` - Express, Prisma, and Supabase API
- `txt_files/` - database SQL, setup notes, security guides, and QA runbooks

Design-source mockups, local archives, dependencies, build output, and secret
environment files are intentionally excluded from Git.

## Local development

Create local environment files from the safe examples:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item backend/.env.example backend/.env
```

Fill in the local values without committing either file. Then use two terminals:

```powershell
cd backend
npm install
npm run dev
```

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The API readiness endpoint is
`http://localhost:4000/api/health/ready`.

## Verification

Run these checks before opening a pull request or deploying:

```powershell
cd backend
npm run typecheck
npm test
npm run build
```

```powershell
cd frontend
npm run typecheck
npm run build
```

## Deployment and QA

Use two Vercel projects connected to this repository: one with `backend` as its
Root Directory and one with `frontend` as its Root Directory.

- [GitHub and Vercel deployment guide](txt_files/WESCOMM_GITHUB_VERCEL_DEPLOYMENT.txt)
- [QA staging runbook](txt_files/WESCOMM_QA_STAGING_RUNBOOK.txt)
- [Security setup](txt_files/WESCOMM_FREE_SECURITY_SETUP.txt)

Never commit `.env`, `.env.local`, database passwords, Supabase service-role
keys, SMTP credentials, field-encryption keys, or VAPID private keys.
