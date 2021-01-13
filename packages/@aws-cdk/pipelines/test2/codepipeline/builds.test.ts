/* eslint-disable import/no-extraneous-dependencies */
import { arrayWith, deepObjectLike, encodedJson, objectLike, Capture } from '@aws-cdk/assert';
import '@aws-cdk/assert/jest';
import * as cbuild from '@aws-cdk/aws-codebuild';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as s3 from '@aws-cdk/aws-s3';
import { Stack } from '@aws-cdk/core';
import * as cdkp from '../../lib2';
import { PIPELINE_ENV, TestApp, TestGitHubNpmPipeline } from '../testutil';

let app: TestApp;
let pipelineStack: Stack;

beforeEach(() => {
  app = new TestApp({ outdir: 'testcdk.out' });
  pipelineStack = new Stack(app, 'PipelineStack', { env: PIPELINE_ENV });
});

afterEach(() => {
  app.cleanup();
});

test('SimpleSynthAction takes arrays of commands', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.generic({
      installCommands: ['install1', 'install2'],
      buildCommands: ['build1', 'build2'],
      testCommands: ['test1', 'test2'],
      synthCommands: ['cdk synth'],
    }),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: {
      Image: 'aws/codebuild/standard:4.0',
    },
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        phases: {
          install: {
            commands: [
              'install1',
              'install2',
            ],
          },
          build: {
            commands: [
              'build1',
              'build2',
              'test1',
              'test2',
              'cdk synth',
            ],
          },
        },
      })),
    },
  });
});

test('synth automatically determines artifact base-directory', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm(),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: {
      Image: 'aws/codebuild/standard:4.0',
    },
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        artifacts: {
          'base-directory': 'testcdk.out',
        },
      })),
    },
  });
});

test('synth build respects subdirectory', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm({
      subdirectory: 'subdir',
    }),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: {
      Image: 'aws/codebuild/standard:4.0',
    },
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        phases: {
          install: {
            commands: arrayWith('cd subdir'),
          },
        },
        artifacts: {
          'base-directory': 'subdir/testcdk.out',
        },
      })),
    },
  });
});

test('synth assumes no build step by default', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm(),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: {
      Image: 'aws/codebuild/standard:4.0',
    },
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        phases: {
          build: {
            commands: ['npx cdk synth'],
          },
        },
      })),
    },
  });
});

test('complex setup with environemnt variables still renders correct project', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm({
      environmentVariables: {
        SOME_ENV_VAR: 'SomeValue',
        INNER_VAR: 'InnerValue',
      },
      synthUsesDocker: true,
      installCommands: [
        'install1',
        'install2',
      ],
      synthCommands: ['synth'],
    }),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: objectLike({
      PrivilegedMode: true,
      EnvironmentVariables: [
        {
          Name: 'SOME_ENV_VAR',
          Type: 'PLAINTEXT',
          Value: 'SomeValue',
        },
        {
          Name: 'INNER_VAR',
          Type: 'PLAINTEXT',
          Value: 'InnerValue',
        },
      ],
    }),
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        phases: {
          install: {
            commands: ['install1', 'install2'],
          },
          build: {
            commands: ['synth'],
          },
        },
      })),
    },
  });
});

test('npm can have its install command overridden', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm({
      installCommands: ['/bin/true'],
    }),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: {
      Image: 'aws/codebuild/standard:4.0',
    },
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        phases: {
          install: {
            commands: ['/bin/true'],
          },
        },
      })),
    },
  });
});

test.skip('Standard (NPM) synth can output additional artifacts', () => {
  // WHEN
  // const addlArtifact = new codepipeline.Artifact('IntegTest');
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm({
      /*
      additionalArtifacts: [
        {
          artifact: addlArtifact,
          directory: 'test',
        },
      ],
      */
    }),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    Environment: {
      Image: 'aws/codebuild/standard:4.0',
    },
    Source: {
      BuildSpec: encodedJson(deepObjectLike({
        artifacts: {
          'secondary-artifacts': {
            CloudAsm: {
              'base-directory': 'testcdk.out',
              'files': '**/*',
            },
            IntegTest: {
              'base-directory': 'test',
              'files': '**/*',
            },
          },
        },
      })),
    },
  });
});

test('Standard (NPM) synth can run in a VPC', () => {
  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm(),
    backend: cdkp.Backend.codePipeline({
      vpc: new ec2.Vpc(pipelineStack, 'NpmSynthTestVpc'),
    }),
  });

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::CodeBuild::Project', {
    VpcConfig: {
      SecurityGroupIds: [
        {
          'Fn::GetAtt': [
            'CdkSynthCdkBuildProjectSecurityGroup7BE1BC3E',
            'GroupId',
          ],
        },
      ],
      Subnets: [
        {
          Ref: 'NpmSynthTestVpcPrivateSubnet1Subnet81E3AA56',
        },
        {
          Ref: 'NpmSynthTestVpcPrivateSubnet2SubnetC1CA3EF0',
        },
        {
          Ref: 'NpmSynthTestVpcPrivateSubnet3SubnetA04163EE',
        },
      ],
      VpcId: {
        Ref: 'NpmSynthTestVpc5E703F25',
      },
    },
  });
});

test('Pipeline action contains a hash that changes as the buildspec changes', () => {
  const hash1 = synthWithAction(() => cdkp.Synth.standardNpm());

  // To make sure the hash is not just random :)
  const hash1prime = synthWithAction(() => cdkp.Synth.standardNpm());

  const hash2 = synthWithAction(() => cdkp.Synth.standardNpm({
    installCommands: ['do install'],
  }));
  const hash3 = synthWithAction(() => cdkp.Synth.standardNpm({
    computeType: cdkp.ComputeType.LARGE,
  }));
  const hash4 = synthWithAction(() => cdkp.Synth.standardNpm({
    environmentVariables: {
      xyz: 'SOME-VALUE',
    },
  }));

  expect(hash1).toEqual(hash1prime);

  expect(hash1).not.toEqual(hash2);
  expect(hash1).not.toEqual(hash3);
  expect(hash1).not.toEqual(hash4);
  expect(hash2).not.toEqual(hash3);
  expect(hash2).not.toEqual(hash4);
  expect(hash3).not.toEqual(hash4);

  function synthWithAction(cb: () => cdkp.Synth) {
    const _app = new TestApp({ outdir: 'testcdk.out' });
    const _pipelineStack = new Stack(_app, 'PipelineStack', { env: PIPELINE_ENV });

    new TestGitHubNpmPipeline(_pipelineStack, 'Cdk', {
      synth: cb(),
    });

    const theHash = Capture.aString();
    expect(_pipelineStack).toHaveResourceLike('AWS::CodePipeline::Pipeline', {
      Stages: arrayWith({
        Name: 'Synth',
        Actions: [
          objectLike({
            Name: 'Synth',
            Configuration: objectLike({
              EnvironmentVariables: encodedJson([
                {
                  name: '_PROJECT_CONFIG_HASH',
                  type: 'PLAINTEXT',
                  value: theHash.capture(),
                },
              ]),
            }),
          }),
        ],
      }),
    });

    return theHash.capturedValue;
  }
});

test.skip('SimpleSynthAction is IGrantable', () => {
  // GIVEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm(),
  });
  const bucket = new s3.Bucket(pipelineStack, 'Bucket');

  // WHEN
  // bucket.grantRead(synthAction);
  Array.isArray(bucket);

  // THEN
  expect(pipelineStack).toHaveResourceLike('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: arrayWith(deepObjectLike({
        Action: ['s3:GetObject*', 's3:GetBucket*', 's3:List*'],
      })),
    },
  });
});

test.skip('SimpleSynthAction can reference an imported ECR repo', () => {
  // Repro from https://github.com/aws/aws-cdk/issues/10535

  // WHEN
  new TestGitHubNpmPipeline(pipelineStack, 'Cdk', {
    synth: cdkp.Synth.standardNpm({
      // FIXME: This is not great
      image: cdkp.CodePipelineImage.fromCodeBuildImage(cbuild.LinuxBuildImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(pipelineStack, 'ECRImage', 'my-repo-name'),
      )),
    }),
  });

  // THEN
  // FIXME: Assert on properties here
});