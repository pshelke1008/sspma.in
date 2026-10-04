import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PERMISSIONS } from '@ashram/types';
import { prisma } from '../../db';
import { asyncHandler, paginated } from '../../lib/http';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { AUDIT_ACTIONS, recordAudit } from '../../lib/audit';
import { validate, validated } from '../../middleware/validate';
import { getCurrentOrganization, getCurrentUser, requirePermission, type AuthContext } from '../../middleware/auth';

/**
 * Nobody can hand out, or take over, more access than they hold themselves.
 * Without this, anyone with `user.edit` could promote themselves to Admin, or
 * reset an Admin's password and sign in as them.
 */
async function assertWithinOwnAccess(auth: AuthContext, roleId: string, action: 'assign' | 'manage') {
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: auth.organizationId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw badRequest('Selected role is not available in this organization');
  const exceeds = role.permissions.some((rp) => !auth.permissions.has(rp.permission.key));
  if (exceeds) {
    throw forbidden(
      action === 'assign'
        ? 'You cannot assign a role with permissions you do not have yourself'
        : 'You cannot change a user whose role has permissions you do not have yourself',
    );
  }
  return role;
}

export const usersRouter = Router();
export const rolesRouter = Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  roleId: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  mobile: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,15}$/, 'Enter a valid mobile number')
    .optional()
    .nullable()
    .or(z.literal('')),
  designation: z.string().trim().max(120).optional().nullable(),
  roleId: z.string().min(1, 'Select a role'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number'),
  isActive: z.boolean().default(true),
});

const updateUserSchema = createUserSchema.partial({ password: true }).extend({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain a letter')
    .regex(/[0-9]/, 'Password must contain a number')
    .optional()
    .or(z.literal('')),
});

usersRouter.get(
  '/',
  requirePermission('user.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const query = validated<z.infer<typeof listQuery>>(req);

    const where = {
      organizationId,
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          mobile: true,
          designation: true,
          avatarUrl: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          role: { select: { id: true, key: true, name: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json(paginated(rows, total, query.page, query.pageSize));
  }),
);

/**
 * Minimal active-user list for the "raise on behalf of" picker. Deliberately
 * narrower than GET /users so it can be granted without user administration.
 */
usersRouter.get(
  '/options',
  requirePermission('expense.create_on_behalf', 'user.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const users = await prisma.user.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, designation: true, role: { select: { key: true, name: true } } },
    });
    res.json({ data: users });
  }),
);

usersRouter.post(
  '/',
  requirePermission('user.create'),
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof createUserSchema>;

    const role = await assertWithinOwnAccess(auth, body.roleId, 'assign');

    const existing = await prisma.user.findFirst({
      where: { organizationId: auth.organizationId, email: body.email },
    });
    if (existing) throw conflict('A user with this email already exists in your organization');

    const user = await prisma.user.create({
      data: {
        organizationId: auth.organizationId,
        name: body.name,
        email: body.email,
        mobile: body.mobile || null,
        designation: body.designation || null,
        roleId: body.roleId,
        isActive: body.isActive,
        passwordHash: await bcrypt.hash(body.password, 10),
      },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        designation: true,
        isActive: true,
        role: { select: { id: true, key: true, name: true } },
      },
    });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.name,
      newValue: { email: user.email, role: role.name },
      req,
    });

    res.status(201).json({ data: user });
  }),
);

usersRouter.put(
  '/:id',
  requirePermission('user.edit'),
  validate(updateUserSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const body = req.body as z.infer<typeof updateUserSchema>;

    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
      include: { role: true },
    });
    if (!existing) throw notFound('User not found');

    await assertWithinOwnAccess(auth, existing.roleId, 'manage');
    if (body.roleId) await assertWithinOwnAccess(auth, body.roleId, 'assign');

    // Guard against locking the organization out of its own admin role.
    if (existing.id === auth.userId && body.isActive === false) {
      throw conflict('You cannot deactivate your own account');
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(body.mobile !== undefined ? { mobile: body.mobile || null } : {}),
        ...(body.designation !== undefined ? { designation: body.designation || null } : {}),
        ...(body.roleId ? { roleId: body.roleId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 10) } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        designation: true,
        isActive: true,
        role: { select: { id: true, key: true, name: true } },
      },
    });

    // A password reset, role change or deactivation must take effect now, not
    // when the user's existing sessions happen to expire. The caller's own
    // current session survives so editing yourself doesn't sign you out.
    if (body.password || body.roleId || body.isActive === false) {
      await prisma.session.updateMany({
        where: { userId: existing.id, revokedAt: null, id: { not: auth.sessionId } },
        data: { revokedAt: new Date() },
      });
    }

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.name,
      oldValue: { email: existing.email, role: existing.role.name, isActive: existing.isActive },
      newValue: { email: user.email, role: user.role.name, isActive: user.isActive },
      req,
    });

    res.json({ data: user });
  }),
);

usersRouter.delete(
  '/:id',
  requirePermission('user.delete'),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    if (req.params.id === auth.userId) throw conflict('You cannot deactivate your own account');

    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
    });
    if (!existing) throw notFound('User not found');
    await assertWithinOwnAccess(auth, existing.roleId, 'manage');

    // Users are deactivated rather than deleted so history stays attributable.
    await prisma.user.update({ where: { id: existing.id }, data: { isActive: false } });
    await prisma.session.updateMany({ where: { userId: existing.id }, data: { revokedAt: new Date() } });

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.USER_DEACTIVATED,
      entityType: 'User',
      entityId: existing.id,
      entityLabel: existing.name,
      req,
    });

    res.json({ success: true });
  }),
);

// ----------------------------- Roles ---------------------------------------

rolesRouter.get(
  '/',
  requirePermission('user.view', 'settings.view'),
  asyncHandler(async (req, res) => {
    const organizationId = getCurrentOrganization(req);
    const roles = await prisma.role.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });

    res.json({
      data: roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.users,
        permissions: role.permissions.map((rp) => rp.permission.key),
      })),
      catalog: await prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] }),
    });
  }),
);

const permissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).min(1, 'A role needs at least one permission'),
});

rolesRouter.put(
  '/:id/permissions',
  requirePermission('settings.manage'),
  validate(permissionsSchema),
  asyncHandler(async (req, res) => {
    const auth = getCurrentUser(req);
    const role = await prisma.role.findFirst({
      where: { id: req.params.id, organizationId: auth.organizationId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw notFound('Role not found');

    const requested = req.body.permissions as string[];

    // The admin role must keep the ability to manage settings, otherwise the
    // organization can permanently lock itself out of permission management.
    if (role.key === 'ADMIN' && !requested.includes('settings.manage')) {
      throw conflict('The Admin role must retain the "settings.manage" permission');
    }

    const permissionRows = await prisma.permission.findMany({ where: { key: { in: requested } } });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({
        data: permissionRows.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      }),
    ]);

    await recordAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: AUDIT_ACTIONS.PERMISSION_CHANGED,
      entityType: 'Role',
      entityId: role.id,
      entityLabel: role.name,
      oldValue: { permissions: role.permissions.map((rp) => rp.permission.key) },
      newValue: { permissions: requested },
      req,
    });

    res.json({ success: true, permissions: requested });
  }),
);
