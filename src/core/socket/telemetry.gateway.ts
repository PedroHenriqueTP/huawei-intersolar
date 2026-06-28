import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class TelemetryGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`WebSocket display client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`WebSocket display client disconnected: ${client.id}`);
  }

  broadcastTelemetry(machineId: string, sessionData: any) {
    // Broadcast specifically to the display of the active machine
    this.server.emit(`telemetry:${machineId}`, sessionData);
    // Broadcast globally to any listening panel
    this.server.emit('telemetry:all', { machineId, ...sessionData });
  }

  broadcastSessionEnd(machineId: string, summary: any) {
    this.server.emit(`session_end:${machineId}`, summary);
  }
}
