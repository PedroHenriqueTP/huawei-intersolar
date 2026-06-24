import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for frontend clients
  app.enableCors();

  // Enable validation pipes for DTOs
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const mqttHost = process.env.MQTT_HOST || 'localhost';
  const mqttPort = Number(process.env.MQTT_PORT) || 1883;

  // Connect MQTT Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: `mqtt://${mqttHost}:${mqttPort}`,
    },
  });

  await app.startAllMicroservices();
  console.log('MQTT telemetry microservice started.');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`HTTP Server running on port ${port}`);
}
bootstrap();
