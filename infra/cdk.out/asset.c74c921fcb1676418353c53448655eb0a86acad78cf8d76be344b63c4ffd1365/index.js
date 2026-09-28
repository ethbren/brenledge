"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lambda/watchlist/get.ts
var get_exports = {};
__export(get_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(get_exports);
var import_client_s3 = require("@aws-sdk/client-s3");

// lambda/common/rateLimit.ts
var import_client_dynamodb = require("@aws-sdk/client-dynamodb");
var import_lib_dynamodb = require("@aws-sdk/lib-dynamodb");
var ddb = import_lib_dynamodb.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({}));
var TABLE = process.env.RATE_LIMIT_TABLE;
var MAX = Number(process.env.RATE_LIMIT_MAX ?? "10");
var WINDOW_SECONDS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "300");
async function checkRateLimit(principalId) {
  const now = Math.floor(Date.now() / 1e3);
  const windowStart = now - now % WINDOW_SECONDS;
  const windowResetsAt = windowStart + WINDOW_SECONDS;
  try {
    const result = await ddb.send(
      new import_lib_dynamodb.UpdateCommand({
        TableName: TABLE,
        Key: { principalId: `${principalId}#${windowStart}` },
        UpdateExpression: "SET #c = if_not_exists(#c, :zero) + :incr, #ttl = if_not_exists(#ttl, :ttl)",
        ConditionExpression: "attribute_not_exists(#c) OR #c < :max",
        ExpressionAttributeNames: { "#c": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":incr": 1,
          ":zero": 0,
          ":max": MAX,
          // keep the item around a bit past the window for debugging, then let TTL sweep it
          ":ttl": windowResetsAt + WINDOW_SECONDS
        },
        ReturnValues: "ALL_NEW"
      })
    );
    const count = result.Attributes?.count ?? 1;
    return { allowed: true, remaining: Math.max(0, MAX - count), windowResetsAt };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return { allowed: false, remaining: 0, windowResetsAt };
    }
    throw err;
  }
}

// lambda/watchlist/get.ts
var s3 = new import_client_s3.S3Client({});
var BUCKET = process.env.WATCHLIST_BUCKET;
var handler = async (event) => {
  const sub = event.requestContext.authorizer.jwt.claims.sub;
  const rate = await checkRateLimit(sub);
  if (!rate.allowed) {
    return {
      statusCode: 429,
      headers: { "Retry-After": "300", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Rate limit exceeded \u2014 max 10 requests per 5 minutes." })
    };
  }
  try {
    const obj = await s3.send(
      new import_client_s3.GetObjectCommand({ Bucket: BUCKET, Key: `watchlists/${sub}.json` })
    );
    const body = await obj.Body?.transformToString();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": String(rate.remaining)
      },
      body: body ?? "[]"
    };
  } catch (err) {
    if (err.name === "NoSuchKey") {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: "[]" };
    }
    console.error("Failed to load watchlist", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Could not load watchlist." }) };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
