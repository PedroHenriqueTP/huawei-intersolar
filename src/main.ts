import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  // Use NestExpressApplication to support static assets
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve static files from the 'public' directory
  app.useStaticAssets(join(process.cwd(), 'public'));

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const mqttHost = process.env.MQTT_HOST || 'localhost';
  const mqttPort = Number(process.env.MQTT_PORT) || 1883;

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
  console.log(`HTTP Server and static frontend running on port ${port}`);
}
bootstrap().catch((err) => {
  console.error('Error during bootstrap:', err);
  process.exit(1);
});
