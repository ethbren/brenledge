import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Fixed-window rate limiter backed by DynamoDB.
 *
 * Each caller (identified by Cognito `sub`) gets a counter item keyed to a
 * WINDOW_SECONDS-wide time bucket: `${principalId}#${windowStart}`. The
 * first request in a window creates the item; every request atomically
 * increments it with a condition that rejects once MAX is reached. Items
 * expire automatically via DynamoDB TTL, so the table self-cleans and never
 * grows unbounded.
 *
 * Trade-off: a fixed window (vs. a sliding one) can in theory allow close
 * to 2x MAX requests across a window boundary (e.g. 10 right before the
 * boundary, 10 right after). For a personal-use rate limit protecting
 * backend resources, that's an acceptable simplification — a sliding-window
 * or token-bucket implementation would need more state per item.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = process.env.RATE_LIMIT_TABLE!;
const MAX = Number(process.env.RATE_LIMIT_MAX ?? '10');
const WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? '300');

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  windowResetsAt: number; // epoch seconds
}

export async function checkRateLimit(principalId: string): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % WINDOW_SECONDS);
  const windowResetsAt = windowStart + WINDOW_SECONDS;

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { principalId: `${principalId}#${windowStart}` },
        UpdateExpression:
          'SET #c = if_not_exists(#c, :zero) + :incr, #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':incr': 1,
          ':zero': 0,
          ':max': MAX,
          // keep the item around a bit past the window for debugging, then let TTL sweep it
          ':ttl': windowResetsAt + WINDOW_SECONDS,
        },
        ReturnValues: 'ALL_NEW',
      })
    );
    const count = (result.Attributes?.count as number) ?? 1;
    return { allowed: true, remaining: Math.max(0, MAX - count), windowResetsAt };
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return { allowed: false, remaining: 0, windowResetsAt };
    }
    throw err;
  }
}
