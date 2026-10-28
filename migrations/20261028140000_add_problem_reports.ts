import type { Knex } from "knex";

// Reports from the "not working" button on a service. reporter is a hash of an anonymous
// browser id, so one browser counts once; alerted_at is set on the report that sent the alert.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("problem_reports"))) {
    await knex.schema.createTable("problem_reports", (table) => {
      table.increments("id").primary();
      table.string("monitor_tag", 255).notNullable();
      table.string("reporter", 64).notNullable();
      table.integer("created_at").notNullable();
      table.integer("alerted_at").nullable();
      table.index(["monitor_tag", "created_at"], "problem_reports_tag_time_idx");
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("problem_reports");
}
