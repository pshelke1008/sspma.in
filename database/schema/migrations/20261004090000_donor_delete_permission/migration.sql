-- New permission: permanently delete a donor. Granted to every organization's
-- Admin role; other roles can be given it from Settings → Roles.
INSERT INTO "Permission" ("id", "key", "label", "group")
VALUES ('perm_donor_delete', 'donor.delete', 'Delete donors permanently', 'Donors')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."key" = 'ADMIN' AND p."key" = 'donor.delete'
ON CONFLICT DO NOTHING;
