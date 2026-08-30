import { Global, Injectable, Module } from '@nestjs/common';

import {
  type EnvironmentConfiguration,
  parseEnvironment,
} from './environment.schema';

@Injectable()
export class EnvironmentConfigurationService {
  public readonly values: EnvironmentConfiguration;

  public constructor() {
    this.values = parseEnvironment();
  }
}

@Global()
@Module({
  providers: [EnvironmentConfigurationService],
  exports: [EnvironmentConfigurationService],
})
export class ConfigurationModule {}
