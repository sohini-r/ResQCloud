import jwt from 'jsonwebtoken'

const tokenIssuer = 'resqcloud-server'
const tokenAudience = 'resqcloud-api'

export const roleLabels = {
  CITIZEN: 'Citizen',
  AUTHORITY_ADMINISTRATOR: 'Authority Administrator',
  VOLUNTEER: 'Volunteer',
  SHELTER_MANAGER: 'Shelter Manager',
}

export const accountStatusLabels = {
  ACTIVE: 'Active',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
}

export function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: roleLabels[user.role],
    accountStatus: accountStatusLabels[user.accountStatus] || 'Active',
    phone: user.phone,
    address: user.address,
  }
}

export function validateJwtSecret(secret) {
  if (typeof secret !== 'string' || secret.startsWith('REPLACE_') || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes.')
  }
}

export function createAuthMiddleware(prisma, secret) {
  return async (request, response, next) => {
    const authorization = request.get('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/)
    if (!match) {
      response.status(401).json({ error: 'Authentication required' })
      return
    }

    try {
      const claims = jwt.verify(match[1], secret, {
        issuer: tokenIssuer,
        audience: tokenAudience,
        algorithms: ['HS256'],
      })
      if (!claims || typeof claims !== 'object' || typeof claims.sub !== 'string') {
        response.status(401).json({ error: 'Invalid or expired authentication token' })
        return
      }

      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, name: true, email: true, role: true, accountStatus: true },
      })
      if (!user) {
        response.status(401).json({ error: 'Invalid or expired authentication token' })
        return
      }
      if (!['ACTIVE', 'APPROVED'].includes(user.accountStatus)) {
        const pending = user.accountStatus === 'PENDING'
        response.status(403).json({
          error: pending
            ? 'Your application is pending administrator review'
            : user.accountStatus === 'REJECTED'
              ? 'Your application was rejected'
              : 'This account is not active',
          code: `ACCOUNT_${user.accountStatus}`,
          ...(user.accountStatus === 'REJECTED' ? { applicationStatus: 'REJECTED' } : {}),
        })
        return
      }

      request.authUser = user
      next()
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        response.status(401).json({ error: 'Invalid or expired authentication token' })
        return
      }
      next(error)
    }
  }
}

export function allowRoles(...roles) {
  return (request, response, next) => {
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      response.status(403).json({ error: 'Your role is not permitted to perform this action' })
      return
    }
    next()
  }
}

export function signAccessToken(userId, secret) {
  return jwt.sign({}, secret, {
    algorithm: 'HS256',
    subject: userId,
    issuer: tokenIssuer,
    audience: tokenAudience,
    expiresIn: '1h',
  })
}
