import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SessionModule } from './session/session.module';
import { OscModule } from './osc/osc.module';
import { SocketModule } from './socket/socket.module';
import { MqttModule } from './mqtt/mqtt.module';

@Module({
  imports: [SessionModule, OscModule, SocketModule, MqttModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
