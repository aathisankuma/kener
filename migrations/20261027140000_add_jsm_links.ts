import type { Knex } from "knex";

// Jira Service Management tickets linked to Kener incidents. A LINKED ticket keeps its incident
// up to date (replies to customers, status); an IGNORED ticket stays out of the list of new
// tickets. Kener reads the tickets only; nothing is written to Jira.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("jsm_links"))) {
    await knex.schema.createTable("jsm_links", (table) => {
      table.increments("id").primary();
      table.string("issue_key", 100).notNullable();
      table.string("status", 20).notNullable().defaultTo("LINKED");
      table.integer("incident_id").unsigned().nullable();
      table.string("monitor_tag", 255).nullable();
      table.string("monitor_impact", 20).nullable();
      // Ids of the ticket comments already posted to the incident, as a JSON array.
      table.text("synced_comment_ids").nullable();
      table.string("last_status_category", 30).nullable();
      table.integer("done_at").nullable();
      table.integer("last_synced_at").nullable();
      table.text("last_error").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.unique(["issue_key"], { indexName: "jsm_links_issue_key_unique" });
      table.index(["incident_id"], "jsm_links_incident_idx");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("jsm_links");
}
