import { LoopGaugeApp } from "../app.js";
import type { OptimizationJobRecord, OptimizationReport } from "../core/types.js";

interface ActiveJob {
  app: LoopGaugeApp;
  controller: AbortController;
  promise: Promise<OptimizationReport>;
}

export class OptimizationJobManager {
  private readonly active = new Map<string, ActiveJob>();

  async start(configPath: string, resumeJobId?: string): Promise<string> {
    const app = await LoopGaugeApp.create(configPath);
    const id = resumeJobId ?? crypto.randomUUID();
    if (this.active.has(id)) {
      app.close();
      throw new Error(`Optimization job is already active: ${id}`);
    }
    const controller = new AbortController();
    const promise = app.engine
      .optimize({ jobId: id, configPath, signal: controller.signal })
      .finally(() => {
        this.active.delete(id);
        app.close();
      });
    this.active.set(id, { app, controller, promise });
    return id;
  }

  async wait(jobId: string): Promise<OptimizationReport> {
    const active = this.active.get(jobId);
    if (!active) throw new Error(`Optimization job is not active: ${jobId}`);
    return active.promise;
  }

  cancel(jobId: string): boolean {
    const active = this.active.get(jobId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  async status(configPath: string, jobId: string): Promise<OptimizationJobRecord | undefined> {
    const active = this.active.get(jobId);
    if (active) return active.app.store.getJob(jobId);
    const app = await LoopGaugeApp.create(configPath);
    try {
      return app.store.getJob(jobId);
    } finally {
      app.close();
    }
  }
}
