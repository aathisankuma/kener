import type { Knex } from "knex";

// The services (monitors) a user manages. A user with the "service_manager" role may set the
// status, post incidents and plan maintenance only for the monitors listed here for them.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable("users_monitors"))) {
    await knex.schema.createTable("users_monitors", (table) => {
      table.increments("id").primary();
      table.integer("users_id").unsigned().notNullable();
      table.string("monitor_tag", 255).notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
      table.unique(["users_id", "monitor_tag"], { indexName: "users_monitors_unique" });
      table.index(["monitor_tag"], "users_monitors_tag_idx");
    });
  }

  try {
    await knex.schema.alterTable("users_monitors", (table) => {
      table.foreign("users_id", "users_monitors_user_fk").references("id").inTable("users").onDelete("CASCADE");
    });
  } catch (_e) {
    /* foreign key already exists */
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("users_monitors");
}
