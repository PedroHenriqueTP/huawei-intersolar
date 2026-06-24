import { Module, Global } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

@Global()
@Module({
  imports: [],
  controllers: [SessionController],
  providers: [SessionService, PrismaService, RedisService],
  exports: [SessionService],
})
export class SessionModule {}
