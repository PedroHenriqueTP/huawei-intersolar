import { Controller } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { SessionService } from '../session/session.service';
import { TelemetryGateway } from '../socket/telemetry.gateway';
import { OscService } from '../osc/osc.service';

@Controller()
export class MqttController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly telemetryGateway: TelemetryGateway,
    private readonly oscService: OscService,
  ) {}

  @EventPattern('huawei/ativação/+')
  async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    // Example topic: huawei/ativação/bike_01
    const parts = topic.split('/');
    const machineId = parts[parts.length - 1];

    if (!data) return;

    // Normalizing telemetry attributes (supporting Portuguese PDF keys and English fallback)
    const score = Number(data.energia_acumulada ?? data.score ?? 0);
    const cadence = Number(data.cadencia ?? data.rpm_manivela ?? data.velocidade ?? 0);
    const timeRemaining = Number(data.tempo_restante ?? data.timeRemaining ?? 0);

    // Update the session in memory (Redis)
    const updatedSession = await this.sessionService.updateActiveSessionScore(
      machineId,
      score,
      cadence,
      timeRemaining,
    );

    if (updatedSession) {
      // 1. Broadcast telemetry to displays via WebSockets
      this.telemetryGateway.broadcastTelemetry(machineId, updatedSession);

      // 2. Dispatch OSC controls to Resolume
      await this.oscService.sendTelemetryOsc(machineId, updatedSession);

      // 3. Check for game completion
      if (timeRemaining <= 0) {
        const metrics = {
          averageCadence: cadence,
          totalEnergy: score,
          duration: 60, // Assumed 60s session
        };

        // Persist to Postgres and clear active cache
        await this.sessionService.endSession(machineId, score, metrics);

        // Generate Socratic feedback
        let socraticMsg = `Parabéns, ${updatedSession.userName}! Você gerou ${score}W de energia limpa.`;
        if (updatedSession.activationType === 'BIKE_ENERGY') {
          socraticMsg = `Incrível, ${updatedSession.userName}! Você gerou ${score}W pedalando, o suficiente para alimentar uma geladeira inverter Huawei por 4 horas!`;
        } else if (updatedSession.activationType === 'FAST_FEET') {
          socraticMsg = `Parabéns, ${updatedSession.userName}! Seus pulos geraram ${score}W, carregando completamente 15 smartphones na bateria BESS residencial Huawei!`;
        } else if (updatedSession.activationType === 'ENERGY_GENERATOR') {
          socraticMsg = `Grande esforço, ${updatedSession.userName}! Com ${score}W gerados manualmente, você acendeu um painel demonstrativo Huawei em tempo recorde!`;
        }

        // Broadcast completion to displays
        this.telemetryGateway.broadcastSessionEnd(machineId, {
          score,
          userName: updatedSession.userName,
          message: socraticMsg,
        });

        // Trigger end of session visual on Resolume
        await this.oscService.send('/composition/columns/4/connect', 1);
        await this.oscService.send('/huawei/active_trigger', 'GAME_OVER');
      }
    }
  }
}
