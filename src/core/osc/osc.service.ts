import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Client } from 'node-osc';
import { IActivationPlugin } from '../../activations/activation.interface';

@Injectable()
export class OscService implements OnModuleInit, OnModuleDestroy {
  private client: Client;

  constructor(
    @Inject('ACTIVE_ACTIVATION')
    private readonly activePlugin: IActivationPlugin,
  ) {}

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

  async sendTelemetryOsc(machineId: string, session: any, previousScore: number) {
    // Delegate the OSC mapping and milestone triggers to the active plugin
    const actions = this.activePlugin.getOscMilestoneActions(
      machineId,
      session.score,
      previousScore,
      session.cadence,
    );

    for (const action of actions) {
      await this.send(action.address, ...action.args);
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.close();
      console.log('OSC Bridge closed.');
    }
  }
}
