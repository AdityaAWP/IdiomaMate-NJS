import { Injectable } from '@nestjs/common';
import { Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly hop2 = new Histogram({
    name: 'broker_hop2_transit_ms',
    help: 'Broker transit time: Matching Service → Notification Service (ms)',
    labelNames: ['broker'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [this.registry],
  });
}
