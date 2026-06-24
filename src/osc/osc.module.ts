import { Module, Global } from '@nestjs/common';
import { OscService } from './osc.service';

@Global()
@Module({
  providers: [OscService],
  exports: [OscService],
})
export class OscModule {}
