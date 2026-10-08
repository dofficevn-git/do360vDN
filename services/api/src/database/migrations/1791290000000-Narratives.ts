import { MigrationInterface, QueryRunner } from "typeorm";

/** Lời dẫn báo cáo có phiên bản (bước 1: khuôn câu + Văn phòng biên tập; bước 2: LLM cục bộ, có hậu kiểm). */
export class Narratives1791290000000 implements MigrationInterface {
    name = 'Narratives1791290000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE "report_narrative" (
            "id" SERIAL NOT NULL, "run_id" integer NOT NULL, "slot_code" character varying(120) NOT NULL, "version" integer NOT NULL DEFAULT 1,
            "text" text NOT NULL, "source" character varying(20) NOT NULL DEFAULT 'edited', "status" character varying(12) NOT NULL DEFAULT 'draft',
            "postcheck" jsonb NOT NULL DEFAULT '{}', "author_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_report_narrative" PRIMARY KEY ("id"))`);
        await q.query(`CREATE INDEX "IDX_report_narrative_run_slot" ON "report_narrative" ("run_id", "slot_code", "version")`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "report_narrative"`);
    }
}
