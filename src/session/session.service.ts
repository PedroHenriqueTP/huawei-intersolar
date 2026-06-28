import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';
import { ActivationType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

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
export class SessionService implements OnModuleInit {
  private readonly offlineUsersDir = path.join(
    process.cwd(),
    'offline_queue',
    'users',
  );
  private readonly offlineSessionsDir = path.join(
    process.cwd(),
    'offline_queue',
    'sessions',
  );
  private readonly inMemorySessions = new Map<string, ActiveSession>();
  private isSyncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    // Ensure offline fallback folders exist
    fs.mkdirSync(this.offlineUsersDir, { recursive: true });
    fs.mkdirSync(this.offlineSessionsDir, { recursive: true });

    // Auto-sync daemon: check database connection and synchronize offline queues every 10s
    setInterval(() => this.syncOfflineData(), 10000);
    console.log('Offline-first Sync Daemon initialized.');
  }

  private getActiveKey(machineId: string): string {
    return `session:active:${machineId}`;
  }

  async registerUser(data: {
    name: string;
    email: string;
    company?: string;
    phone?: string;
    keyPassToken: string;
  }) {
    try {
      // 1. Try primary PostgreSQL write
      const existing = await this.prisma.user.findFirst({
        where: {
          OR: [{ email: data.email }, { keyPassToken: data.keyPassToken }],
        },
      });

      if (existing) {
        if (existing.keyPassToken === data.keyPassToken) {
          return existing; // Already registered with this NFC token
        }
        throw new BadRequestException('Email already registered');
      }

      return await this.prisma.user.create({
        data,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      console.warn(
        'PostgreSQL offline. Storing visitor registration locally...',
      );

      // 2. Fallback: Write JSON buffering payload locally
      const filePath = path.join(
        this.offlineUsersDir,
        `${data.keyPassToken}.json`,
      );
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

      // Return offline simulated user structure to unblock physical interaction
      return {
        id: `offline-${data.keyPassToken}`,
        name: data.name,
        email: data.email,
        company: data.company || null,
        phone: data.phone || null,
        keyPassToken: data.keyPassToken,
        createdAt: new Date(),
      };
    }
  }

  async bindSession(data: {
    keyPassToken: string;
    machineId: string;
    activationType: ActivationType;
  }) {
    let user: any = null;

    try {
      // 1. Try PostgreSQL lookup
      user = await this.prisma.user.findUnique({
        where: { keyPassToken: data.keyPassToken },
      });
    } catch (error) {
      console.warn(
        'PostgreSQL connection offline. Searching in offline registrations...',
      );
    }

    // 2. Fallback: If DB down or not found, check offline files
    if (!user) {
      const offlinePath = path.join(
        this.offlineUsersDir,
        `${data.keyPassToken}.json`,
      );
      if (fs.existsSync(offlinePath)) {
        const raw = fs.readFileSync(offlinePath, 'utf-8');
        const offlineUser = JSON.parse(raw);
        user = {
          id: `offline-${offlineUser.keyPassToken}`,
          name: offlineUser.name,
          email: offlineUser.email,
        };
      }
    }

    if (!user) {
      throw new NotFoundException(
        `Visitor with Key Pass '${data.keyPassToken}' not found.`,
      );
    }

    const activeSession: ActiveSession = {
      userId: user.id,
      userName: user.name,
      activationType: data.activationType,
      machineId: data.machineId,
      score: 0,
      cadence: 0,
      timeRemaining: 60, // Default 60s
      startedAt: Date.now(),
    };

    // 3. Save to active cache (Redis with in-memory map fallback)
    try {
      const redis = this.redis.getClient();
      const key = this.getActiveKey(data.machineId);
      await redis.set(key, JSON.stringify(activeSession), 'EX', 300);
      console.log(`Bound active session for ${user.name} via Redis`);
    } catch (redisError) {
      console.warn('Redis offline. Buffering active session in RAM...');
      this.inMemorySessions.set(data.machineId, activeSession);
    }

    return activeSession;
  }

  async getActiveSession(machineId: string): Promise<ActiveSession | null> {
    try {
      const redis = this.redis.getClient();
      const key = this.getActiveKey(machineId);
      const data = await redis.get(key);
      if (data) {
        return JSON.parse(data) as ActiveSession;
      }
    } catch (redisError) {
      return this.inMemorySessions.get(machineId) || null;
    }
    return this.inMemorySessions.get(machineId) || null;
  }

  async updateActiveSessionScore(
    machineId: string,
    score: number,
    cadence: number,
    timeRemaining: number,
  ) {
    const session = await this.getActiveSession(machineId);
    if (!session) return null;

    session.score = score;
    session.cadence = cadence;
    session.timeRemaining = timeRemaining;

    try {
      const redis = this.redis.getClient();
      const key = this.getActiveKey(machineId);
      await redis.set(key, JSON.stringify(session), 'KEEPTTL');
    } catch (redisError) {
      // In-Memory cache updates
      this.inMemorySessions.set(machineId, session);
    }
    return session;
  }

  async endSession(machineId: string, finalScore: number, metricsSummary: any) {
    const session = await this.getActiveSession(machineId);
    if (!session) {
      throw new NotFoundException(
        `No active session found on machine '${machineId}'`,
      );
    }

    let dbSession: any = null;
    let savedToDb = false;

    // Only try database save if user is not temporary offline (offline users must be synced first)
    if (!session.userId.startsWith('offline-')) {
      try {
        dbSession = await this.prisma.session.create({
          data: {
            userId: session.userId,
            activationType: session.activationType,
            machineId: session.machineId,
            score: finalScore,
            metricsSummary: metricsSummary || {},
            completed: true,
          },
        });
        savedToDb = true;
      } catch (dbError) {
        console.warn(
          'PostgreSQL write failed. Queueing session result locally...',
        );
      }
    }

    if (!savedToDb) {
      // Fallback: Buffer session result on Disk
      const sessionId = `offline-session-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const filePath = path.join(this.offlineSessionsDir, `${sessionId}.json`);
      const offlinePayload = {
        id: sessionId,
        userId: session.userId,
        activationType: session.activationType,
        machineId: session.machineId,
        score: finalScore,
        metricsSummary: metricsSummary || {},
        completed: true,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        filePath,
        JSON.stringify(offlinePayload, null, 2),
        'utf-8',
      );
      dbSession = offlinePayload;
    }

    // Update Redis Sorted Sets Leaderboard
    try {
      const redis = this.redis.getClient();
      const leaderboardKey = `leaderboard:${session.activationType}`;
      await redis.zadd(
        leaderboardKey,
        finalScore,
        JSON.stringify({ userId: session.userId, userName: session.userName }),
      );
    } catch (redisError) {
      console.warn(
        'Failed to update Redis leaderboard. Result queued in local DB/files.',
      );
    }

    // Clear active session
    try {
      const redis = this.redis.getClient();
      const key = this.getActiveKey(machineId);
      await redis.del(key);
    } catch (redisError) {
      this.inMemorySessions.delete(machineId);
    }
    this.inMemorySessions.delete(machineId);

    console.log(`Session ended successfully. Resilience layer processed.`);
    return dbSession;
  }

  async getLeaderboard(activationType: ActivationType, limit = 10) {
    try {
      const redis = this.redis.getClient();
      const leaderboardKey = `leaderboard:${activationType}`;
      const members = await redis.zrevrange(
        leaderboardKey,
        0,
        limit - 1,
        'WITHSCORES',
      );

      const leaderboard: any[] = [];
      for (let i = 0; i < members.length; i += 2) {
        const userInfo = JSON.parse(members[i]);
        const score = Number(members[i + 1]);
        leaderboard.push({
          position: i / 2 + 1,
          userId: userInfo.userId,
          userName: userInfo.userName,
          score,
        });
      }
      return leaderboard;
    } catch (redisError) {
      console.warn('Redis offline. Cannot fetch real-time leaderboard.');
      return [];
    }
  }

  // Background Daemon to sync local buffers to PostgreSQL and Redis
  async syncOfflineData() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      // Probe PostgreSQL connection
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      // Database still offline, abort sync
      this.isSyncing = false;
      return;
    }

    console.log(
      'Database connection detected online. Synchronizing local buffers...',
    );

    try {
      // 1. Synchronize Offline Users
      if (fs.existsSync(this.offlineUsersDir)) {
        const files = fs.readdirSync(this.offlineUsersDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = path.join(this.offlineUsersDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const userData = JSON.parse(raw);

          try {
            let user = await this.prisma.user.findFirst({
              where: {
                OR: [
                  { email: userData.email },
                  { keyPassToken: userData.keyPassToken },
                ],
              },
            });

            if (!user) {
              user = await this.prisma.user.create({ data: userData });
            }

            console.log(`Synced offline user: ${user.name}`);

            // Replace any offline sessions mapped to the temporary ID with the actual DB UUID
            if (fs.existsSync(this.offlineSessionsDir)) {
              const sessionFiles = fs.readdirSync(this.offlineSessionsDir);
              for (const sFile of sessionFiles) {
                if (!sFile.endsWith('.json')) continue;
                const sFilePath = path.join(this.offlineSessionsDir, sFile);
                const sRaw = fs.readFileSync(sFilePath, 'utf-8');
                const sData = JSON.parse(sRaw);
                if (sData.userId === `offline-${userData.keyPassToken}`) {
                  sData.userId = user.id;
                  fs.writeFileSync(
                    sFilePath,
                    JSON.stringify(sData, null, 2),
                    'utf-8',
                  );
                }
              }
            }

            // Remove file
            fs.unlinkSync(filePath);
          } catch (dbErr) {
            console.error(
              `Failed syncing offline user ${userData.name}:`,
              dbErr,
            );
          }
        }
      }

      // 2. Synchronize Offline Sessions
      if (fs.existsSync(this.offlineSessionsDir)) {
        const files = fs.readdirSync(this.offlineSessionsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = path.join(this.offlineSessionsDir, file);
          const raw = fs.readFileSync(filePath, 'utf-8');
          const sessionData = JSON.parse(raw);

          // Skip if user sync has not updated the temporary ID to DB ID yet
          if (sessionData.userId.startsWith('offline-')) {
            continue;
          }

          try {
            await this.prisma.session.create({
              data: {
                userId: sessionData.userId,
                activationType: sessionData.activationType,
                machineId: sessionData.machineId,
                score: sessionData.score,
                metricsSummary: sessionData.metricsSummary,
                completed: true,
                createdAt: new Date(sessionData.createdAt),
              },
            });

            // Update Redis Leaderboard
            try {
              const redis = this.redis.getClient();
              const leaderboardKey = `leaderboard:${sessionData.activationType}`;
              const user = await this.prisma.user.findUnique({
                where: { id: sessionData.userId },
              });
              const userName = user ? user.name : 'Unknown';
              await redis.zadd(
                leaderboardKey,
                sessionData.score,
                JSON.stringify({ userId: sessionData.userId, userName }),
              );
            } catch (redisErr) {
              console.warn('Leaderboard sync failed:', redisErr);
            }

            console.log(
              `Synced offline session for userId ${sessionData.userId}`,
            );
            fs.unlinkSync(filePath);
          } catch (dbErr) {
            console.error(
              `Failed syncing offline session ${sessionData.id}:`,
              dbErr,
            );
          }
        }
      }
    } catch (syncErr) {
      console.error('Offline synchronization daemon failure:', syncErr);
    } finally {
      this.isSyncing = false;
    }
  }
}
