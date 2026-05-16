import { Injectable } from '@nestjs/common';
import { Summary, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly hop2 = new Summary({
    name: 'broker_hop2_transit_ms',
    help: 'Broker transit time: Matching Service → Notification Service (ms)',
    labelNames: ['broker'],
    percentiles: [0.5, 0.9, 0.95, 0.99],
    maxAgeSeconds: 60,
    ageBuckets: 5,
    registers: [this.registry],
  });
}
