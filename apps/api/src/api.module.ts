import { Module } from '@nestjs/common';
import { ConfigurationModule } from '@posts-media/configuration';

@Module({
  imports: [ConfigurationModule],
})
export class ApiModule {}
