import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { checkRateLimit } from '../common/rateLimit';

const s3 = new S3Client({});
const BUCKET = process.env.WATCHLIST_BUCKET!;
const MAX_TICKERS = 20;
// Plain tickers (AAPL), share classes (BRK.B), and a few exchange-suffix
// styles (RY.TO) — adjust if you need something more permissive.
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const sub = event.requestContext.authorizer.jwt.claims.sub as string;

  const rate = await checkRateLimit(sub);
  if (!rate.allowed) {
    return {
      statusCode: 429,
      headers: { 'Retry-After': '300', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Rate limit exceeded — max 10 requests per 5 minutes.' }),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body ?? '[]');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Body must be a JSON array of ticker strings.' }),
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Body must be a JSON array of ticker strings.' }),
    };
  }

  const cleaned = [...new Set(parsed.map((t) => String(t).trim().toUpperCase()))];

  // Enforced here, server-side — the frontend also caps at 20, but that's a
  // UX nicety, not the actual guarantee.
  if (cleaned.length > MAX_TICKERS) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Watchlist is capped at ${MAX_TICKERS} tickers (received ${cleaned.length}).`,
      }),
    };
  }

  const invalid = cleaned.filter((t) => !TICKER_RE.test(t));
  if (invalid.length > 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Invalid ticker symbol(s): ${invalid.join(', ')}` }),
    };
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `watchlists/${sub}.json`,
      Body: JSON.stringify(cleaned),
      ContentType: 'application/json',
    })
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-RateLimit-Remaining': String(rate.remaining),
    },
    body: JSON.stringify(cleaned),
  };
};
