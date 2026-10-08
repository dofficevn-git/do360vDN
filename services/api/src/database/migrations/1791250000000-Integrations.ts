import { MigrationInterface, QueryRunner } from "typeorm";

/** T1/T4 kênh chat (chat_message), D5 QLVB (qlvb_document, report_run.qlvb_doc_id), D6 KPI (kpi_criterion, kpi_score). */
export class Integrations1791250000000 implements MigrationInterface {
    name = 'Integrations1791250000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE TABLE "chat_message" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "direction" character varying(5) NOT NULL, "kind" character varying(10) NOT NULL,
            "channel" character varying(10) NOT NULL, "admin_id" integer, "channel_user_id" character varying(80), "title" character varying,
            "body" jsonb NOT NULL DEFAULT '{}', "status" character varying(10) NOT NULL, "error" text, "reference_type" character varying(20), "reference_id" character varying(40),
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_chat_message" PRIMARY KEY ("id"))`);
        await q.query(`CREATE INDEX "IDX_chat_tenant_created" ON "chat_message" ("tenant_id", "created_at")`);

        await q.query(`CREATE TABLE "qlvb_document" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "direction" character varying(3) NOT NULL, "external_id" character varying(120),
            "so_ky_hieu" character varying(100), "ngay" date, "loai" character varying(100), "trich_yeu" text, "nguoi_ky" character varying(120),
            "nguoi_xu_ly_email" character varying(120), "han_xu_ly" date, "ngay_hoan_thanh" date, "domain" character varying(40),
            "payload" jsonb NOT NULL DEFAULT '{}', "source" character varying(10) NOT NULL DEFAULT 'lgsp', "run_id" integer, "sign_status" character varying(10), "signed_file" character varying,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_qlvb_document" PRIMARY KEY ("id"))`);
        await q.query(`CREATE UNIQUE INDEX "UQ_qlvb_doc_external" ON "qlvb_document" ("tenant_id", "source", "direction", "external_id") WHERE "external_id" IS NOT NULL`);
        await q.query(`CREATE INDEX "IDX_qlvb_doc_tenant_ngay" ON "qlvb_document" ("tenant_id", "ngay")`);
        await q.query(`ALTER TABLE "report_run" ADD "qlvb_doc_id" character varying(120)`);

        await q.query(`CREATE TABLE "kpi_criterion" (
            "criterion_id" character varying(60) NOT NULL, "name" character varying NOT NULL, "formula" text NOT NULL, "weight" numeric(8,3) NOT NULL DEFAULT '1',
            "source" character varying(20) NOT NULL DEFAULT 'task', "unit" character varying(20) NOT NULL DEFAULT '%', "max_score" numeric(8,2) NOT NULL DEFAULT '100',
            "regulation_ref" character varying, "description" text, "is_active" boolean NOT NULL DEFAULT true, "version" integer NOT NULL DEFAULT 1,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_kpi_criterion" PRIMARY KEY ("criterion_id"))`);
        await q.query(`CREATE TABLE "kpi_score" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "employee_id" integer NOT NULL, "period" character varying(12) NOT NULL, "criterion_id" character varying(60) NOT NULL,
            "value" numeric(18,4), "score" numeric(10,3), "evidence_ref" jsonb NOT NULL DEFAULT '{}', "status" character varying(12) NOT NULL DEFAULT 'proposed', "explanation" text,
            "source" character varying(20) NOT NULL DEFAULT 'do360', "approved_by" integer, "approved_at" TIMESTAMP WITH TIME ZONE, "computed_at" TIMESTAMP WITH TIME ZONE,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_kpi_score" PRIMARY KEY ("id"))`);
        await q.query(`CREATE UNIQUE INDEX "UQ_kpi_score_key" ON "kpi_score" ("tenant_id", "employee_id", "period", "criterion_id")`);
        await q.query(`CREATE INDEX "IDX_kpi_score_tenant_period" ON "kpi_score" ("tenant_id", "period")`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`DROP TABLE "kpi_score"`);
        await q.query(`DROP TABLE "kpi_criterion"`);
        await q.query(`ALTER TABLE "report_run" DROP COLUMN "qlvb_doc_id"`);
        await q.query(`DROP TABLE "qlvb_document"`);
        await q.query(`DROP TABLE "chat_message"`);
    }
}
