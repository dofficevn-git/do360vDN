import { MigrationInterface, QueryRunner } from "typeorm";

/** Kế hoạch năm theo chỉ tiêu (chỉ thêm, có version) — nguồn cho "đạt x% kế hoạch". */
export class PlanTargets1791280000000 implements MigrationInterface {
    name = 'PlanTargets1791280000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE "plan_target" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "indicator_id" character varying(80) NOT NULL, "year" integer NOT NULL,
            "value" numeric(24,6) NOT NULL, "source_ref" jsonb NOT NULL DEFAULT '{}', "version" integer NOT NULL DEFAULT 1, "note" text, "created_by" integer,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_plan_target" PRIMARY KEY ("id"))`);
        await q.query(`CREATE UNIQUE INDEX "UQ_plan_target_key" ON "plan_target" ("tenant_id", "indicator_id", "year", "version")`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "plan_target"`);
    }
}
