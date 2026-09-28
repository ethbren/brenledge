import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';

/**
 * Hosts the Ledger static site on S3, served through CloudFront over HTTPS.
 *
 * Architecture:
 *   viewer --> CloudFront (HTTPS, OAC-signed requests) --> private S3 bucket
 *
 * The S3 bucket has no public access at all — CloudFront reaches it via
 * Origin Access Control (OAC), which is the current AWS-recommended
 * replacement for the older Origin Access Identity (OAI) approach.
 */
export class StockWebsiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Private bucket that holds the built site files ---
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,

      // Dev-friendly defaults so `cdk destroy` cleans everything up.
      // For a bucket you want to survive stack deletion, switch these to
      // RemovalPolicy.RETAIN and autoDeleteObjects: false.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // --- CloudFront distribution in front of the bucket ---
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'Ledger stock tracker',
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // cheapest: NA + EU edges
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,

      // This app is a client-side single page (index.html only) — send any
      // "not found" straight back to index.html rather than showing a raw
      // S3/CloudFront error page.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],

      // To use your own domain instead of the *.cloudfront.net URL:
      // 1. Request/validate an ACM certificate in us-east-1 for your domain.
      // 2. Uncomment and fill in:
      // domainNames: ['stocks.yourdomain.com'],
      // certificate: acmCertificate,
      // 3. Point a Route 53 (or other DNS) A/ALIAS record at the distribution.
    });

    // --- Upload the site's static files and invalidate the CDN cache ---
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      // Points at the stock_website folder one level up from infra/
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../'), {
        exclude: ['infra/**', 'README.md'],
      })],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'SiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Public URL for the deployed site',
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
      description: 'S3 bucket holding the site files',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID (useful for manual cache invalidation)',
    });
  }
}
