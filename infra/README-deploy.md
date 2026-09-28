# Deploying Ledger to AWS

This deploys the site as a static S3 bucket served through CloudFront
(HTTPS, CDN caching, no server to manage). Estimated cost for personal use
is typically under $1/month (S3 storage + a handful of CloudFront requests);
AWS bills usage, not a flat hosting fee.

## Folder layout expected

```
stock_website/
├── index.html
├── style.css
├── app.js
└── infra/              <- this CDK app
    ├── bin/deploy.ts
    ├── lib/stock-website-stack.ts
    ├── package.json
    ├── tsconfig.json
    └── cdk.json
```

The stack uploads everything in `stock_website/` (excluding `infra/` and
`README.md`) to S3, so keep this folder structure as-is.

## One-time setup

1. **AWS account + credentials.** Install the AWS CLI and configure it:
   ```bash
   aws configure
   ```
   (needs an AWS access key with permissions to create S3/CloudFront/IAM
   resources — an admin or power-user IAM user is simplest while testing).

2. **Install dependencies**, from inside `infra/`:
   ```bash
   cd infra
   npm install
   ```

3. **Bootstrap CDK** (one-time per AWS account/region — sets up the small
   support stack CDK needs to deploy assets):
   ```bash
   npx cdk bootstrap
   ```

## Deploy

```bash
npx cdk deploy
```

CDK will show you the resources it's about to create/change and ask for
confirmation. On success it prints outputs including:

- `SiteURL` — the public `https://xxxxx.cloudfront.net` URL for your site
- `BucketName` — the S3 bucket holding the files
- `DistributionId` — useful if you ever need to manually invalidate the CDN cache

CloudFront distributions typically take a few minutes to finish deploying
globally the first time, even after `cdk deploy` completes.

## Re-deploying after you edit the site

Just run `npx cdk deploy` again — it re-uploads changed files to S3 and
automatically invalidates the CloudFront cache for you (configured via
`distributionPaths: ['/*']` in the stack).

## Using your own domain (optional)

By default you get a `*.cloudfront.net` URL. To use e.g. `stocks.yourdomain.com`:

1. Request a certificate in **us-east-1** (required for CloudFront) via
   AWS Certificate Manager, and validate it (DNS validation is easiest).
2. In `lib/stock-website-stack.ts`, uncomment the `domainNames` and
   `certificate` lines in the `Distribution` and fill them in.
3. Add a DNS record (Route 53 alias, or a CNAME elsewhere) pointing your
   domain at the CloudFront distribution's domain name.
4. `npx cdk deploy` again.

## Tearing it down

```bash
npx cdk destroy
```

This removes the S3 bucket, its contents, and the CloudFront distribution
(the stack is configured with `RemovalPolicy.DESTROY` and
`autoDeleteObjects: true` for exactly this kind of easy cleanup). For a
production site you'd normally flip those to `RETAIN`.

## Note on the Alpha Vantage API key

Nothing about hosting changes how the app handles your API key — it's still
entered in the browser and stored in that browser's `localStorage`, not
baked into the deployed files or sent to AWS.
