import { Injectable } from '@nestjs/common';
import { Counter, Summary, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly hop1 = new Summary({
    name: 'broker_hop1_transit_ms',
    help: 'Broker transit time: API Service → Matching Service (ms)',
    labelNames: ['broker'],
    percentiles: [0.5, 0.95, 0.99],
    maxAgeSeconds: 60,
    ageBuckets: 5,
    registers: [this.registry],
  });

  readonly matchRequestsTotal = new Counter({
    name: 'match_requests_total',
    help: 'Total match requests received',
    labelNames: ['broker'],
    registers: [this.registry],
  });

  readonly matchesTotal = new Counter({
    name: 'matches_total',
    help: 'Total successful matches made',
    labelNames: ['broker'],
    registers: [this.registry],
  });
}
