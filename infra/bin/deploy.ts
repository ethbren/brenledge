#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { StockWebsiteStack } from '../lib/stock-website-stack';

const app = new cdk.App();

new StockWebsiteStack(app, 'LedgerStockWebsiteStack', {
  env: {
    // Uses whatever AWS CLI profile/credentials are active when you deploy.
    // Pin these explicitly if you want the stack tied to one account/region:
    // account: '123456789012',
    // region: 'us-east-1',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'S3 + CloudFront hosting for the Ledger stock tracker site',
});
