import type { Knex } from "knex";

// An incident that concerns everyone is shown in a box at the top of every status page.
// top_impact is null for a normal incident, or DOWN / DEGRADED for one shown at the top,
// which also sets the box's colour.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("incidents", "top_impact"))) {
    await knex.schema.alterTable("incidents", (table) => {
      table.string("top_impact", 20).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("incidents", "top_impact")) {
    await knex.schema.alterTable("incidents", (table) => {
      table.dropColumn("top_impact");
    });
  }
}
