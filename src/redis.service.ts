import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private redisClient: Redis;

  onModuleInit() {
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    });
    
    this.redisClient.on('connect', () => {
      console.log('Redis client connected.');
    });

    this.redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
    });
  }

  getClient(): Redis {
    return this.redisClient;
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
    console.log('Redis client disconnected.');
  }
}
