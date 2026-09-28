import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as path from 'path';

const RATE_LIMIT_MAX = '10';
const RATE_LIMIT_WINDOW_SECONDS = '300'; // 5 minutes

export class BrenledgeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================================
    // 1. Authentication — Cognito User Pool
    //
    // Sign-up requires a verified email (confirmation code sent on
    // registration). MFA is currently OFF — disabled for now while
    // testing the rest of the app. To turn it back on later, this is
    // the only place to change: add back
    //   mfa: cognito.Mfa.REQUIRED,
    //   mfaSecondFactor: { sms: false, otp: true, email: false },
    // (TOTP was the working option — see the comment history in this
    // file's earlier version for why email-MFA needed SES + phone-based
    // recovery and was more friction than it was worth for now). The
    // matching frontend enrollment/verification flow would also need to
    // come back into auth.js/main.js/index.html at the same time.
    // ============================================================

    const userPool = new cognito.UserPool(this, 'BrenledgeUserPool', {
      userPoolName: 'brenledge-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient('BrenledgeWebClient', {
      userPoolClientName: 'brenledge-web',
      generateSecret: false, // this is a browser SPA client — no secret to leak
      authFlows: { userSrp: true },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ============================================================
    // 2. Per-user watchlist storage — private S3 bucket
    //
    // Objects are keyed watchlists/{cognito-sub}.json. Nothing reads or
    // writes this bucket except the two Lambdas below — there's no
    // public access and no direct browser-to-S3 path, so the 20-ticker
    // cap and auth check can't be bypassed by calling S3 directly.
    // ============================================================

    const watchlistBucket = new s3.Bucket(this, 'BrenledgeWatchlistBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ============================================================
    // 3. API rate limiting state — DynamoDB
    // ============================================================

    const rateLimitTable = new dynamodb.Table(this, 'BrenledgeApiRateLimitTable', {
      tableName: 'brenledge-api-rate-limit',
      partitionKey: { name: 'principalId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ============================================================
    // 4. Watchlist API — Lambda + HTTP API, behind Cognito auth
    // ============================================================

    const lambdaEnv = {
      WATCHLIST_BUCKET: watchlistBucket.bucketName,
      RATE_LIMIT_TABLE: rateLimitTable.tableName,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_SECONDS,
    };

    const nodejsFnDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        // These ship in the Node 18+/20 Lambda runtime already — excluding
        // them from the bundle keeps deploys fast and packages small.
        externalModules: ['@aws-sdk/*'],
      },
      environment: lambdaEnv,
      timeout: cdk.Duration.seconds(10),
    };

    const getWatchlistFn = new NodejsFunction(this, 'BrenledgeGetWatchlistFn', {
      ...nodejsFnDefaults,
      entry: path.join(__dirname, '../lambda/watchlist/get.ts'),
    });

    const putWatchlistFn = new NodejsFunction(this, 'BrenledgePutWatchlistFn', {
      ...nodejsFnDefaults,
      entry: path.join(__dirname, '../lambda/watchlist/put.ts'),
    });

    watchlistBucket.grantRead(getWatchlistFn);
    watchlistBucket.grantWrite(putWatchlistFn);
    rateLimitTable.grantReadWriteData(getWatchlistFn);
    rateLimitTable.grantReadWriteData(putWatchlistFn);

    const httpApi = new apigwv2.HttpApi(this, 'BrenledgeHttpApi', {
      apiName: 'brenledge-api',
      corsPreflight: {
        // Tighten allowOrigins to your exact CloudFront/custom domain once
        // you have it, rather than leaving this wide open long-term.
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.PUT],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.minutes(10),
      },
    });

    const authorizer = new HttpUserPoolAuthorizer('BrenledgeAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
    });

    httpApi.addRoutes({
      path: '/watchlist',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetWatchlistIntegration', getWatchlistFn),
      authorizer,
    });

    httpApi.addRoutes({
      path: '/watchlist',
      methods: [apigwv2.HttpMethod.PUT],
      integration: new HttpLambdaIntegration('PutWatchlistIntegration', putWatchlistFn),
      authorizer,
    });

    // ============================================================
    // 5. Static site — S3 (private) + CloudFront (OAC)
    // ============================================================

    const siteBucket = new s3.Bucket(this, 'BrenledgeSiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'BrenledgeSiteDistribution', {
      comment: 'Brenledge stock tracker',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],
    });

    // Deploys the static site files AND a generated config.json containing
    // the Cognito/API IDs the frontend needs — those IDs only exist after
    // CloudFormation creates the real resources, so BucketDeployment
    // resolves them at deploy time rather than at synth time. This means
    // you never have to manually copy IDs into the frontend after a deploy.
    new s3deploy.BucketDeployment(this, 'DeployBrenledgeSite', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../'), {
          exclude: ['infra/**', 'README.md'],
        }),
        s3deploy.Source.jsonData('config.json', {
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
          apiUrl: httpApi.apiEndpoint,
          region: this.region,
        }),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ============================================================
    // Outputs
    // ============================================================

    new cdk.CfnOutput(this, 'SiteURL', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'WatchlistBucketName', { value: watchlistBucket.bucketName });
    new cdk.CfnOutput(this, 'RateLimitTableName', { value: rateLimitTable.tableName });
  }
}
