import { Injectable } from '@nestjs/common';
import { ActivationType } from '@prisma/client';
import {
  IActivationPlugin,
  NormalizedTelemetry,
} from '../activation.interface';

@Injectable()
export class FastFeetPlugin extends IActivationPlugin {
  readonly type = ActivationType.FAST_FEET;
  readonly name = 'Fast Feet';
  readonly targetScore = 1000;
  readonly duration = 60;

  normalizeTelemetry(rawData: any): NormalizedTelemetry {
    const data = rawData as {
      energia_acumulada?: unknown;
      score?: unknown;
      cadencia?: unknown;
      rpm_manivela?: unknown;
      velocidade?: unknown;
      tempo_restante?: unknown;
      timeRemaining?: unknown;
    };

    return {
      score: Number(data.energia_acumulada ?? data.score ?? 0),
      cadence: Number(
        data.cadencia ?? data.rpm_manivela ?? data.velocidade ?? 0,
      ),
      timeRemaining: Number(data.tempo_restante ?? data.timeRemaining ?? 0),
    };
  }

  getSocraticFeedback(userName: string, score: number): string {
    return `Parabéns, ${userName}! Seus pulos geraram ${score}W, carregando completamente 15 smartphones na bateria BESS residencial Huawei!`;
  }

  getOscMilestoneActions(
    machineId: string,
    score: number,
    previousScore: number,
    cadence: number,
  ): Array<{ address: string; args: any[] }> {
    const actions: Array<{ address: string; args: any[] }> = [];
    const progress = Math.min(1.0, score / this.targetScore);

    // Continuous progress updates
    actions.push({ address: `/huawei/${machineId}/energy`, args: [progress] });
    actions.push({ address: `/huawei/${machineId}/cadence`, args: [cadence] });

    // 80% milestone
    const threshold80 = this.targetScore * 0.8;
    if (score >= threshold80 && previousScore < threshold80) {
      actions.push({ address: '/composition/columns/2/connect', args: [1] });
    }

    // 100% milestone
    if (score >= this.targetScore && previousScore < this.targetScore) {
      actions.push({ address: '/composition/columns/3/connect', args: [1] });
      actions.push({ address: '/huawei/active_trigger', args: ['WINNER'] });
    }

    return actions;
  }
}
