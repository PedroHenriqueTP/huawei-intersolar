import { ActivationType } from '@prisma/client';

export interface NormalizedTelemetry {
  score: number;
  cadence: number;
  timeRemaining: number;
}

export abstract class IActivationPlugin {
  abstract readonly type: ActivationType;
  abstract readonly name: string;
  abstract readonly targetScore: number;
  abstract readonly duration: number;

  /**
   * Normalizes raw hardware sensor telemetry (e.g. MQTT payload) to standardized attributes.
   */
  abstract normalizeTelemetry(rawData: any): NormalizedTelemetry;

  /**
   * Generates localized, brand-aligned Socratic energy-saving feedback.
   */
  abstract getSocraticFeedback(userName: string, score: number): string;

  /**
   * Maps current game progression to OSC triggers sent to media server (Resolume).
   */
  abstract getOscMilestoneActions(
    machineId: string,
    score: number,
    previousScore: number,
    cadence: number,
  ): Array<{ address: string; args: any[] }>;
}
