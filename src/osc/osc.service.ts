import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Client } from 'node-osc';

@Injectable()
export class OscService implements OnModuleInit, OnModuleDestroy {
  private client: Client;

  onModuleInit() {
    const host = process.env.RESOLUME_HOST || 'localhost';
    const port = Number(process.env.RESOLUME_PORT) || 7000;
    this.client = new Client(host, port);
    console.log(
      `OSC Bridge initialized. Sending UDP packets to ${host}:${port}`,
    );
  }

  async send(address: string, ...args: any[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client.send(address, ...args, (err) => {
        if (err) {
          console.error(`OSC Send failed for address ${address}:`, err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async sendTelemetryOsc(machineId: string, session: any) {
    // Map score / energy_acumulada to a 0.0 - 1.0 range
    // Assuming target completion threshold is 1000 Watts/Joules
    const targetEnergy = 1000;
    const progress = Math.min(1.0, session.score / targetEnergy);

    // Send active energy progress (0.0 to 1.0)
    await this.send(`/huawei/${machineId}/energy`, progress);

    // Send speed/cadence telemetry
    await this.send(`/huawei/${machineId}/cadence`, session.cadence);

    // Check for milestones
    // Meta milestone triggers on Resolume Column selectors
    if (
      session.score >= targetEnergy * 0.8 &&
      session.score - session.cadence < targetEnergy * 0.8
    ) {
      // 80% milestone -> Column 2 trigger
      await this.send('/composition/columns/2/connect', 1);
    }

    if (
      session.score >= targetEnergy &&
      session.score - session.cadence < targetEnergy
    ) {
      // 100% milestone -> Column 3 trigger (Win Celebration)
      await this.send('/composition/columns/3/connect', 1);
      await this.send('/huawei/active_trigger', 'WINNER');
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.close();
      console.log('OSC Bridge closed.');
    }
  }
}
