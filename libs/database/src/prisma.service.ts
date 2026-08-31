import { PrismaPg } from '@prisma/adapter-pg';
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type TransactionCallback<T> = (
  transaction: Prisma.TransactionClient,
) => Promise<T>;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  public constructor(
    databaseUrl: string,
    private readonly connectOnInit = true,
  ) {
    super({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }

  public async onModuleInit(): Promise<void> {
    if (this.connectOnInit) await this.$connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  public withTransaction<T>(callback: TransactionCallback<T>): Promise<T> {
    return this.$transaction(callback);
  }
}
