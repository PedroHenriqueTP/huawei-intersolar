import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';
import { SessionService } from '../session/session.service';
import { TelemetryGateway } from '../socket/telemetry.gateway';
import { OscService } from '../osc/osc.service';
import { IActivationPlugin } from '../../activations/activation.interface';

@Controller()
export class MqttController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly telemetryGateway: TelemetryGateway,
    private readonly oscService: OscService,
    @Inject('ACTIVE_ACTIVATION')
    private readonly activePlugin: IActivationPlugin,
  ) {}

  @EventPattern('huawei/ativação/+')
  async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    // Example topic: huawei/ativação/bike_01
    const parts = topic.split('/');
    const machineId = parts[parts.length - 1];

    if (!data) return;

    // Use active plugin to normalize incoming telemetry
    const { score, cadence, timeRemaining } = this.activePlugin.normalizeTelemetry(data);

    // Fetch previous score to detect milestones correctly
    const activeSession = await this.sessionService.getActiveSession(machineId);
    const previousScore = activeSession ? activeSession.score : 0;

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
      await this.oscService.sendTelemetryOsc(machineId, updatedSession, previousScore);

      // 3. Check for game completion
      if (timeRemaining <= 0) {
        const metrics = {
          averageCadence: cadence,
          totalEnergy: score,
          duration: this.activePlugin.duration,
        };

        // Persist to Postgres and clear active cache
        await this.sessionService.endSession(machineId, score, metrics);

        // Generate Socratic feedback using plugin
        const socraticMsg = this.activePlugin.getSocraticFeedback(
          updatedSession.userName,
          score,
        );

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
