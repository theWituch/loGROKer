import type { ServerResponse } from 'node:http';
import type { ServerEvent } from '../shared/contracts.js';
import type { ViewerService } from './viewer-service.js';

export class EventStream {
  private readonly clients = new Set<ServerResponse>();
  private readonly heartbeat: NodeJS.Timeout;
  private eventId = 0;

  constructor(private readonly service: ViewerService) {
    service.on('event', (event) => this.broadcast(event));
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        client.write(': keepalive\n\n');
      }
    }, 15_000);
    this.heartbeat.unref();
  }

  add(client: ServerResponse): () => void {
    this.clients.add(client);
    this.write(client, { type: 'snapshot', data: this.service.snapshot() });
    const remove = () => this.clients.delete(client);
    client.once('close', remove);
    client.once('error', remove);
    return remove;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }

  private broadcast(event: ServerEvent): void {
    for (const client of this.clients) {
      this.write(client, event);
    }
  }

  private write(client: ServerResponse, event: ServerEvent): void {
    const id = ++this.eventId;
    client.write(`id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }
}
