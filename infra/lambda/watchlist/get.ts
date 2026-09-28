import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { checkRateLimit } from '../common/rateLimit';

const s3 = new S3Client({});
const BUCKET = process.env.WATCHLIST_BUCKET!;

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

  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `watchlists/${sub}.json` })
    );
    const body = await obj.Body?.transformToString();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rate.remaining),
      },
      body: body ?? '[]',
    };
  } catch (err: any) {
    if (err.name === 'NoSuchKey') {
      // No watchlist saved yet — that's a normal state, not an error.
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' };
    }
    console.error('Failed to load watchlist', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load watchlist.' }) };
  }
};
