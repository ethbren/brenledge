#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BrenledgeStack } from '../lib/brenledge-stack';

const app = new cdk.App();

new BrenledgeStack(app, 'BrenledgeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'Brenledge: static site (S3+CloudFront), Cognito auth, per-user S3 watchlist API, DynamoDB rate limiting',
});
