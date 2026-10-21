import type { Knex } from "knex";

// A subscriber can limit their updates to chosen monitors. A subscriber method with no
// rows here hears of every incident and maintenance, as before this table existed.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("subscriber_method_monitors"))) {
    await knex.schema.createTable("subscriber_method_monitors", (table) => {
      table.increments("id").primary();
      table.integer("subscriber_method_id").unsigned().notNullable();
      table.string("monitor_tag", 255).notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.unique(["subscriber_method_id", "monitor_tag"], { indexName: "sub_method_monitors_unique" });
      table.index(["monitor_tag"], "sub_method_monitors_tag_idx");
    });
  }

  try {
    await knex.schema.alterTable("subscriber_method_monitors", (table) => {
      table
        .foreign("subscriber_method_id", "sub_method_monitors_method_fk")
        .references("id")
        .inTable("subscriber_methods")
        .onDelete("CASCADE");
    });
  } catch (_e) {
    /* foreign key already exists */
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("subscriber_method_monitors");
}
