import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SessionModule } from './core/session/session.module';
import { OscModule } from './core/osc/osc.module';
import { SocketModule } from './core/socket/socket.module';
import { MqttModule } from './core/mqtt/mqtt.module';
import { ActivationModule } from './activations/activation.module';

@Module({
  imports: [
    ActivationModule,
    SessionModule,
    OscModule,
    SocketModule,
    MqttModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
