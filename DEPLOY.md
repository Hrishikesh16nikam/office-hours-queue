# Deploying Office Hours Queue

Everything runs on Cloudflare's free plan: Workers for the app, D1 for the database, and a scheduled job every 15 minutes. About 20 minutes, once.

Run every command from inside the project folder.

## 1. Install and check

```
npm install
npm test
npm run typecheck
```

## 2. Sign in to Cloudflare and create the database

```
npx wrangler login
npm run cf:db:create
```

`cf:db:create` prints a `database_id`. Open `wrangler.jsonc` and replace `REPLACE_WITH_YOUR_DATABASE_ID` with it, keeping the quotes. If it says the database already exists, run `npx wrangler d1 list` and copy the `uuid` for `office-hours-queue`.

## 3. Create the tables and deploy

```
npm run cf:db:migrate
npm run deploy
```

The deploy prints your app's address, such as `https://office-hours-queue.<you>.workers.dev`. If Cloudflare asks you to choose a `workers.dev` subdomain, type a short lowercase name.

## 4. Upload the secrets (one command)

```
npm run secrets -- you@example.com
```

This generates fresh secrets, uploads all five to Cloudflare, deletes the temporary file, and prints your **setup code**. Write the setup code down; you need it once. Never paste secrets into chats, documents or commits.

Check they're all there (this shows names only):

```
npx wrangler secret list
```

## 5. Set up your course

1. Open your app's address and enter the setup code.
2. Fill in the course name, your students' email domain (for example `northeastern.edu`), topics, your name, email and a 6-digit PIN.
3. In **Team**, add the other TAs and copy each one's invite link. Links work once and expire after 7 days.

## 6. Run office hours

1. **Start office hours**: choose in person, online or both, the room and the meeting link.
2. Click **Show QR code** and put that tab on the projector, or post the join link for online students.
3. Click **Help next student**, or tick students with the same topic and **Help them together**.
4. **End session** when you're done to see that session's statistics.

## Updating

After changing the code: `npm run deploy`. If a new file appears in `migrations/`, run `npm run cf:db:migrate` first.
