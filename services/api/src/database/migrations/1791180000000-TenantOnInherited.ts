import { MigrationInterface, QueryRunner } from "typeorm";

/** tenant_id cho bảng kế thừa từ khung ZSC. Bản ghi cũ gán theo đơn vị của người tạo; còn lại để bootstrap gán đơn vị mặc định. */
export class TenantOnInherited1791180000000 implements MigrationInterface {
    name = 'TenantOnInherited1791180000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" ADD "tenant_id" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD "tenant_id" character varying(10)`);
        await queryRunner.query(`UPDATE tasks t SET tenant_id = a.tenant_id FROM admin_users a WHERE t.assigner_id = a.id AND t.tenant_id IS NULL`);
        await queryRunner.query(`UPDATE audit_logs l SET tenant_id = a.tenant_id FROM admin_users a WHERE l.admin_user_id = a.id AND l.tenant_id IS NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_tasks_tenant" ON "tasks" ("tenant_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_audit_logs_tenant" ON "audit_logs" ("tenant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_audit_logs_tenant"`);
        await queryRunner.query(`DROP INDEX "IDX_tasks_tenant"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "tenant_id"`);
    }
}
