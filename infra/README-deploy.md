# Deploying Brenledge to AWS

This now deploys considerably more than the static site: Cognito
authentication, a per-user watchlist API (S3 + Lambda + API Gateway), and a
DynamoDB-backed rate limiter in front of that API.

## ⚠️ First: tear down the old stack

If you previously deployed the earlier `LedgerStockWebsiteStack`, destroy it
**before** switching to these files — the stack name and most construct IDs
changed, so CDK will otherwise create a second, parallel set of resources
rather than replacing the old ones (leaving the old CloudFront distribution
running and billing you).

```bash
cd infra
git stash            # or otherwise set aside these new files temporarily
npx cdk destroy       # tears down the old LedgerStockWebsiteStack
git stash pop         # bring the new files back
```

If you never deployed the old version, skip this.

## Folder layout expected

```
stock_website/
├── index.html
├── style.css
├── app.js            <- existing local ledger (unchanged, still localStorage)
├── auth.js            <- new: Cognito sign-up/in, email MFA
├── watchlist.js        <- new: calls the watchlist API
├── main.js              <- new: wires auth + watchlist into the page
└── infra/
    ├── bin/deploy.ts
    ├── lib/brenledge-stack.ts
    ├── lambda/
    │   ├── common/rateLimit.ts
    │   └── watchlist/
    │       ├── get.ts
    │       └── put.ts
    ├── package.json
    ├── tsconfig.json
    └── cdk.json
```

## Setup

```bash
cd infra
npm install          # now also pulls in @aws-sdk/*, esbuild (for bundling the Lambdas), @types/aws-lambda
npx cdk bootstrap     # skip if you already bootstrapped this account/region
npx cdk deploy
```

The frontend never needs manual configuration — `BucketDeployment` writes a
`config.json` (Cognito pool ID, app client ID, API URL) into the deployed
site automatically on every `cdk deploy`, resolved from the real
CloudFormation values at deploy time.

## What gets created

- **Cognito User Pool** (`brenledge-users`) + app client — self-service
  sign-up, required verified email. MFA is currently **off** (disabled for
  now to simplify testing) — see the comment at the top of the User Pool
  block in `brenledge-stack.ts` for how to turn TOTP MFA back on later.
- **S3 bucket** for per-user watchlists — private, no public/direct-browser
  access; only the two Lambdas below can read/write it.
- **DynamoDB table** (`brenledge-api-rate-limit`) — tracks request counts
  per user per 5-minute window; the watchlist Lambdas check and increment
  it on every call.
- **Two Lambda functions + an HTTP API** — `GET /watchlist` and
  `PUT /watchlist`, both behind a Cognito JWT authorizer, both capped at 10
  calls per 5 minutes per signed-in user, returning HTTP 429 past that.
- **S3 + CloudFront** for the static site itself, same as before, just
  renamed.

## Testing after deploy

1. Open the new `SiteURL` from the outputs — you'll land on a sign-in
   screen now instead of the app directly.
2. Sign up with a real email you can check. You'll get a confirmation code
   immediately — enter it.
3. Sign in with your password — that's the whole sign-in flow while MFA
   is off.
4. Once in, try the new Watchlist panel at the top: add a few tickers,
   remove one, refresh the page and confirm it reloads from S3 (not just
   memory).
5. Try adding an 21st ticker — should be rejected both in the UI and (if
   you bypass the UI) by the Lambda itself.
6. Hammer `PUT /watchlist` more than 10 times inside 5 minutes (e.g. by
   rapidly adding/removing) and confirm you get a "rate limited" message.

## Tearing down

```bash
npx cdk destroy
```

Removes everything above, including both S3 buckets' contents (thanks to
`autoDeleteObjects: true`).
