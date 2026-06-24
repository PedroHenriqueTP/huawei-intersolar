import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { ActivationType } from '@prisma/client';

export interface ActiveSession {
  userId: string;
  userName: string;
  activationType: ActivationType;
  machineId: string;
  score: number;
  cadence: number;
  timeRemaining: number;
  startedAt: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private getActiveKey(machineId: string): string {
    return `session:active:${machineId}`;
  }

  async registerUser(data: { name: string; email: string; company?: string; phone?: string; keyPassToken: string }) {
    // Check if keyPassToken or email already exists
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          { keyPassToken: data.keyPassToken }
        ]
      }
    });

    if (existing) {
      if (existing.keyPassToken === data.keyPassToken) {
        return existing; // Already registered with this NFC token
      }
      throw new BadRequestException('Email already registered');
    }

    return this.prisma.user.create({
      data,
    });
  }

  async bindSession(data: { keyPassToken: string; machineId: string; activationType: ActivationType }) {
    const user = await this.prisma.user.findUnique({
      where: { keyPassToken: data.keyPassToken },
    });

    if (!user) {
      throw new NotFoundException(`Visitor with Key Pass '${data.keyPassToken}' not found.`);
    }

    const activeSession: ActiveSession = {
      userId: user.id,
      userName: user.name,
      activationType: data.activationType,
      machineId: data.machineId,
      score: 0,
      cadence: 0,
      timeRemaining: 60, // Default 60 seconds game
      startedAt: Date.now(),
    };

    const redis = this.redis.getClient();
    const key = this.getActiveKey(data.machineId);
    
    // Save to Redis with 5 minute TTL (300 seconds)
    await redis.set(key, JSON.stringify(activeSession), 'EX', 300);
    console.log(`Bound session for user ${user.name} on ${data.machineId}`);

    return activeSession;
  }

  async getActiveSession(machineId: string): Promise<ActiveSession | null> {
    const redis = this.redis.getClient();
    const key = this.getActiveKey(machineId);
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as ActiveSession;
  }

  async updateActiveSessionScore(machineId: string, score: number, cadence: number, timeRemaining: number) {
    const session = await this.getActiveSession(machineId);
    if (!session) return null;

    session.score = score;
    session.cadence = cadence;
    session.timeRemaining = timeRemaining;

    const redis = this.redis.getClient();
    const key = this.getActiveKey(machineId);
    await redis.set(key, JSON.stringify(session), 'KEEPTTL');
    return session;
  }

  async endSession(machineId: string, finalScore: number, metricsSummary: any) {
    const session = await this.getActiveSession(machineId);
    if (!session) {
      throw new NotFoundException(`No active session found on machine '${machineId}'`);
    }

    // Save to Postgres Database
    const dbSession = await this.prisma.session.create({
      data: {
        userId: session.userId,
        activationType: session.activationType,
        machineId: session.machineId,
        score: finalScore,
        metricsSummary: metricsSummary || {},
        completed: true,
      },
    });

    // Update Redis Leaderboards (Sorted Sets)
    const redis = this.redis.getClient();
    const leaderboardKey = `leaderboard:${session.activationType}`;
    // ZADD stores score and member. Member is dynamic user info
    await redis.zadd(leaderboardKey, finalScore, JSON.stringify({ userId: session.userId, userName: session.userName }));

    // Delete active session from Redis
    const key = this.getActiveKey(machineId);
    await redis.del(key);

    console.log(`Session ended and persisted for user ${session.userName}. Final Score: ${finalScore}`);
    return dbSession;
  }

  async getLeaderboard(activationType: ActivationType, limit = 10) {
    const redis = this.redis.getClient();
    const leaderboardKey = `leaderboard:${activationType}`;
    // ZREVRANGEBYSCORE gets high score to low score
    const members = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');
    
    const leaderboard: any[] = [];
    for (let i = 0; i < members.length; i += 2) {
      const userInfo = JSON.parse(members[i]);
      const score = Number(members[i + 1]);
      leaderboard.push({
        position: (i / 2) + 1,
        userId: userInfo.userId,
        userName: userInfo.userName,
        score,
      });
    }
    return leaderboard;
  }
}
