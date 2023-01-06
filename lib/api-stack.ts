import * as cdk from "aws-cdk-lib";
import * as rds from "aws-cdk-lib/aws-rds";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecr from "aws-cdk-lib/aws-ecr";

import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

import { Construct } from "constructs";

export const DB_NAME = "training";
export const VPC_NAME = {
  PUBLIC: "Public",
  DATA: "Data",
  PRIVATE: "Private",
};
export const ECR_REPO_NAME = "trainingrepo";

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // Create a VPC with 2 public subnets
    const vpc = new ec2.Vpc(this, "MyVpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: VPC_NAME.PUBLIC,
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: VPC_NAME.PRIVATE,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          name: VPC_NAME.DATA,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
      
    });
    const engine = rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_14_3,
    });

    // const vpcSubnets = vpc.selectSubnets({
    //   subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
    //   availabilityZones: [vpc.availabilityZones[0], vpc.availabilityZones[1]],
    // });

    const db = new rds.DatabaseInstance(this, "MyDatabase", {
      engine,
      allocatedStorage: 20,
      vpc,
      databaseName: DB_NAME,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO
      ),
      credentials: rds.Credentials.fromGeneratedSecret("postgres"),
      // vpcSubnets,
      maxAllocatedStorage: 30,

      instanceIdentifier: `Training-PG-Database`,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a security group for the Fargate tasks
    const fargateSecurityGroup = new ec2.SecurityGroup(
      this,
      "FargateSecurityGroup",
      {
        vpc,
        allowAllOutbound: true,
      }
    );
    // allow an http request from anywhere in port 80
    fargateSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow incoming HTTP traffic"
    );

    // Create an Amazon ECS cluster
    const cluster = new ecs.Cluster(this, "TrainingCluster", {
      vpc,
      clusterName: "aws-training-cluster",
    });

    const ecrRepo = new ecr.Repository(this, "TrainingEcrRepo", {
      repositoryName: ECR_REPO_NAME,
    });

    

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, "training-td", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    const container = taskDefinition.addContainer("training-container", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo),
      memoryLimitMiB: 512,

      portMappings:[{
        containerPort: 80,
        hostPort: 80,
        protocol: ecs.Protocol.TCP,
      }],
      environment: {
        VAR_PORT: "80",
        TYPEORM_TYPE: "postgres",
        TYPEORM_HOST: db.dbInstanceEndpointAddress,
        TYPEORM_PORT: db.dbInstanceEndpointPort,
        TYPEORM_USERNAME: "postgres",
        TYPEORM_PASSWORD: db
          .secret!.secretValueFromJson("password")
          .unsafeUnwrap()
          .toString(),
        TYPEORM_DB_NAME: DB_NAME,
        JWT_SECRET: "B4b&l4vid43sunCikl0",
        AWS_ACCESS_KEY_ID: "AKIA33HQJP5BUZZN4ILL",
        AWS_SECRET_ACCESS_KEY: "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",
        AWS_REGION: "us-east-1",
        AWS_PUBLIC_BUCKET_NAME: "training-nestjs-aws-public",
      },
    });


    // Service
    new ecs.FargateService(this, "training-service", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [fargateSecurityGroup],
      serviceName: "training-svc",
    });

   
  }
}
