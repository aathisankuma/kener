import { BaseRepository } from "./base.js";

export interface ProblemReportRecord {
  id: number;
  monitor_tag: string;
  /** Hash of the reporting browser's anonymous id. */
  reporter: string;
  created_at: number;
  alerted_at: number | null;
}

export interface ProblemReportSummary {
  monitor_tag: string;
  /** Different browsers that reported the service. */
  reporters: number;
  last_at: number;
  alerts: number;
}

export class ProblemReportsRepository extends BaseRepository {
  async insertProblemReport(data: { monitor_tag: string; reporter: string; created_at: number }): Promise<number> {
    const result = await this.knex("problem_reports").insert(data, ["id"]);
    const first = result[0] as number | { id: number };
    return typeof first === "object" ? first.id : first;
  }

  /** Whether this browser already reported the service since the given time. */
  async hasProblemReport(monitorTag: string, reporter: string, since: number): Promise<boolean> {
    const row = await this.knex("problem_reports")
      .where({ monitor_tag: monitorTag, reporter })
      .andWhere("created_at", ">=", since)
      .first("id");
    return !!row;
  }

  /** Different browsers that reported each service since the given time. */
  async countProblemReporters(monitorTags: string[], since: number): Promise<Record<string, number>> {
    if (monitorTags.length === 0) return {};
    const rows: Array<{ monitor_tag: string; n: number | string }> = await this.knex("problem_reports")
      .select("monitor_tag")
      .countDistinct({ n: "reporter" })
      .whereIn("monitor_tag", monitorTags)
      .andWhere("created_at", ">=", since)
      .groupBy("monitor_tag");
    return Object.fromEntries(rows.map((r) => [r.monitor_tag, Number(r.n)]));
  }

  async wasProblemAlertSent(monitorTag: string, since: number): Promise<boolean> {
    const row = await this.knex("problem_reports")
      .where("monitor_tag", monitorTag)
      .andWhere("alerted_at", ">=", since)
      .first("id");
    return !!row;
  }

  async markProblemReportAlerted(id: number, at: number): Promise<void> {
    await this.knex("problem_reports").where({ id }).update({ alerted_at: at });
  }

  /** Per service since the given time, most recently reported first. */
  async getProblemReportSummary(since: number): Promise<ProblemReportSummary[]> {
    const rows = (await this.knex("problem_reports")
      .select("monitor_tag")
      .countDistinct({ reporters: "reporter" })
      .max({ last_at: "created_at" })
      .count({ alerts: "alerted_at" })
      .where("created_at", ">=", since)
      .groupBy("monitor_tag")
      .orderBy("last_at", "desc")) as unknown as Array<{
      monitor_tag: string;
      reporters: number | string;
      last_at: number | string;
      alerts: number | string;
    }>;
    return rows.map((r) => ({
      monitor_tag: r.monitor_tag,
      reporters: Number(r.reporters),
      last_at: Number(r.last_at),
      alerts: Number(r.alerts),
    }));
  }

  async deleteProblemReportsBefore(timestamp: number): Promise<number> {
    return await this.knex("problem_reports").where("created_at", "<", timestamp).delete();
  }

  async deleteProblemReportsByTag(monitorTag: string): Promise<number> {
    return await this.knex("problem_reports").where("monitor_tag", monitorTag).delete();
  }
}
