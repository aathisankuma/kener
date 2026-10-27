import { BaseRepository } from "./base.js";

export interface JsmLinkRecord {
  id: number;
  issue_key: string;
  /** LINKED: keeps its incident up to date. IGNORED: kept out of the list of new tickets. */
  status: "LINKED" | "IGNORED";
  incident_id: number | null;
  monitor_tag: string | null;
  monitor_impact: string | null;
  synced_comment_ids: string | null;
  last_status_category: string | null;
  /** UTC seconds when the ticket was first seen done; Kener stops reading it 7 days later. */
  done_at: number | null;
  last_synced_at: number | null;
  last_error: string | null;
  created_at: unknown;
  updated_at: unknown;
}

export type JsmLinkInsert = Pick<JsmLinkRecord, "issue_key" | "status"> &
  Partial<Omit<JsmLinkRecord, "id" | "issue_key" | "status" | "created_at" | "updated_at">>;

export type JsmLinkUpdate = Partial<Omit<JsmLinkRecord, "id" | "issue_key" | "created_at" | "updated_at">>;

/** How long a done ticket is still read, so that reopening it reopens the incident. */
export const JSM_DONE_GRACE_S = 7 * 24 * 60 * 60;

export class JsmLinksRepository extends BaseRepository {
  async getJsmLinks(): Promise<JsmLinkRecord[]> {
    return await this.knex("jsm_links").orderBy("id", "desc");
  }

  async getJsmLinkByKey(issueKey: string): Promise<JsmLinkRecord | undefined> {
    return await this.knex("jsm_links").where("issue_key", issueKey).first();
  }

  async insertJsmLink(data: JsmLinkInsert): Promise<JsmLinkRecord> {
    await this.knex("jsm_links").insert({ ...data, created_at: this.knex.fn.now(), updated_at: this.knex.fn.now() });
    return (await this.getJsmLinkByKey(data.issue_key))!;
  }

  async updateJsmLink(issueKey: string, data: JsmLinkUpdate): Promise<number> {
    return await this.knex("jsm_links")
      .where("issue_key", issueKey)
      .update({ ...data, updated_at: this.knex.fn.now() });
  }

  async deleteJsmLink(issueKey: string): Promise<number> {
    return await this.knex("jsm_links").where("issue_key", issueKey).del();
  }

  /** Forgets the links of a deleted incident. */
  async deleteJsmLinksByIncidentId(incidentId: number): Promise<number> {
    return await this.knex("jsm_links").where("incident_id", incidentId).del();
  }

  /** Linked tickets still worth reading: open ones, and done ones for 7 days. */
  async getJsmLinksToSync(now: number): Promise<JsmLinkRecord[]> {
    return await this.knex("jsm_links")
      .where("status", "LINKED")
      .whereNotNull("incident_id")
      .andWhere((q) => q.whereNull("done_at").orWhere("done_at", ">", now - JSM_DONE_GRACE_S))
      .orderBy("id", "asc");
  }
}
