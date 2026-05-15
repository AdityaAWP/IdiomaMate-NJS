import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly hop1 = new Histogram({
    name: 'broker_hop1_transit_ms',
    help: 'Broker transit time: API Service → Matching Service (ms)',
    labelNames: ['broker'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
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
