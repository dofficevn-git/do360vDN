import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Blueprint V0.5 — DO360 Data Core: Object (dim_object), Relation (object_relation), Document↔Object (document_object_link),
 * Event gắn Object (event_log.object_uid), Nhiệm vụ gắn Object + mục tiêu chỉ tiêu (tasks.object_uid/target_*),
 * kênh tương tác chính danh (interaction_channel).
 */
export class DataCore1791310000000 implements MigrationInterface {
    name = 'DataCore1791310000000'

    public async up(q: QueryRunner): Promise<void> {
        await q.query(`CREATE EXTENSION IF NOT EXISTS unaccent`).catch(() => undefined);
        await q.query(`CREATE TABLE "dim_object" (
            "uid" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" character varying(10) NOT NULL, "object_type" character varying(40) NOT NULL,
            "code" character varying(40) NOT NULL, "name" character varying NOT NULL, "name_norm" character varying(300) NOT NULL,
            "status" character varying(30) NOT NULL DEFAULT 'active', "master_id" character varying(80), "master_source" character varying(120),
            "external_ids" jsonb NOT NULL DEFAULT '{}', "attributes" jsonb NOT NULL DEFAULT '{}', "ownership_type" character varying(20) NOT NULL DEFAULT 'LOCAL_MASTER',
            "data_owner_dept" character varying(50), "data_steward_id" integer, "provenance" jsonb NOT NULL DEFAULT '{}',
            "verification_status" character varying(20) NOT NULL DEFAULT 'pending', "valid_from" date, "valid_to" date,
            "refreshed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" integer,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_dim_object" PRIMARY KEY ("uid"))`);
        await q.query(`CREATE INDEX "IDX_object_tenant_type" ON "dim_object" ("tenant_id", "object_type")`);
        await q.query(`CREATE UNIQUE INDEX "UQ_object_tenant_type_code" ON "dim_object" ("tenant_id", "object_type", "code")`);
        await q.query(`CREATE INDEX "IDX_object_name_norm" ON "dim_object" ("tenant_id", "object_type", "name_norm")`);
        await q.query(`CREATE TABLE "object_relation" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "relation_type" character varying(40) NOT NULL,
            "source_uid" uuid NOT NULL, "target_uid" character varying(80) NOT NULL, "target_name" character varying,
            "valid_from" date, "valid_to" date, "source_ref" jsonb NOT NULL DEFAULT '{}', "status" character varying(20) NOT NULL DEFAULT 'active',
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_object_relation" PRIMARY KEY ("id"))`);
        await q.query(`CREATE INDEX "IDX_relation_source" ON "object_relation" ("source_uid")`);
        await q.query(`CREATE INDEX "IDX_relation_target" ON "object_relation" ("target_uid")`);
        await q.query(`CREATE TABLE "document_object_link" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "document_kind" character varying(20) NOT NULL, "document_id" integer NOT NULL,
            "object_uid" uuid NOT NULL, "link_type" character varying(20) NOT NULL DEFAULT 'evidence', "note" character varying,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_document_object_link" PRIMARY KEY ("id"))`);
        await q.query(`CREATE INDEX "IDX_doclink_object" ON "document_object_link" ("object_uid")`);
        await q.query(`CREATE TABLE "interaction_channel" (
            "id" SERIAL NOT NULL, "tenant_id" character varying(10) NOT NULL, "channel_type" character varying(20) NOT NULL DEFAULT 'ZALO_GMF',
            "key" character varying(40) NOT NULL, "name" character varying NOT NULL, "external_group_id" character varying(80),
            "scope_type" character varying(20) NOT NULL DEFAULT 'TOPIC', "scope_id" character varying(40), "classification_allowed" character varying(20) NOT NULL DEFAULT 'INTERNAL',
            "member_rules" jsonb NOT NULL DEFAULT '[]', "approved_by" integer, "status" character varying(20) NOT NULL DEFAULT 'active',
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_interaction_channel" PRIMARY KEY ("id"))`);
        await q.query(`CREATE UNIQUE INDEX "UQ_channel_tenant_key" ON "interaction_channel" ("tenant_id", "key")`);
        await q.query(`ALTER TABLE "event_log" ADD "object_uid" uuid`);
        await q.query(`ALTER TABLE "event_log" ADD "actor_id" integer`);
        await q.query(`CREATE INDEX "IDX_event_object_uid" ON "event_log" ("object_uid")`);
        await q.query(`ALTER TABLE "tasks" ADD "object_uid" uuid`);
        await q.query(`ALTER TABLE "tasks" ADD "target_indicator_id" character varying(80)`);
        await q.query(`ALTER TABLE "tasks" ADD "target_value" numeric(20,4)`);
        await q.query(`ALTER TABLE "chat_message" ADD "gateway" jsonb`);
    }

    public async down(q: QueryRunner): Promise<void> {
        await q.query(`ALTER TABLE "chat_message" DROP COLUMN "gateway"`);
        await q.query(`ALTER TABLE "tasks" DROP COLUMN "target_value"`);
        await q.query(`ALTER TABLE "tasks" DROP COLUMN "target_indicator_id"`);
        await q.query(`ALTER TABLE "tasks" DROP COLUMN "object_uid"`);
        await q.query(`ALTER TABLE "event_log" DROP COLUMN "actor_id"`);
        await q.query(`ALTER TABLE "event_log" DROP COLUMN "object_uid"`);
        await q.query(`DROP TABLE "interaction_channel"`);
        await q.query(`DROP TABLE "document_object_link"`);
        await q.query(`DROP TABLE "object_relation"`);
        await q.query(`DROP TABLE "dim_object"`);
    }
}
