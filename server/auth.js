import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  InitiateAuthCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'ap-south-1_fVvcfYmZq';
export const CLIENT_ID = process.env.COGNITO_CLIENT_ID || 'u4svfjkcl6vmq7glgtp8vhcel';
export const REGION = process.env.AWS_REGION || 'ap-south-1';

// Setup Cognito JWT verifier for ID tokens
let idVerifier = null;
try {
  idVerifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    tokenUse: 'id',
    clientId: CLIENT_ID,
  });
} catch (err) {
  console.warn('[Cognito] Verifier initialization warning:', err.message);
}

// Setup Cognito IDP client
export const cognitoClient = new CognitoIdentityProviderClient({ region: REGION });

/**
 * Middleware: Verify Cognito JWT token from Authorization header if present.
 * Attaches req.user = { id, email, name, role, groups } or null.
 */
export async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    if (!idVerifier) {
      req.user = null;
      return next();
    }
    const payload = await idVerifier.verify(token);
    const groups = payload['cognito:groups'] || [];
    let role = 'Customer';
    if (groups.includes('Admin')) role = 'Admin';
    else if (groups.includes('Owner')) role = 'Owner';

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      role,
      groups,
    };
    next();
  } catch (err) {
    // If token is invalid or expired, return 401
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

/**
 * Middleware: Require one of the specified roles (e.g. requireRole('Owner', 'Admin'))
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }
    if (!allowedRoles.includes(req.user.role) && !req.user.groups.includes('Admin')) {
      return res.status(403).json({
        error: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Register a new user in Cognito, confirm email, set password, and assign group
 */
export async function registerUser({ email, password, name, role = 'Customer' }) {
  const validRole = ['Admin', 'Owner', 'Customer'].includes(role) ? role : 'Customer';

  // 1. Create user
  await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: name || email.split('@')[0] },
      ],
      MessageAction: 'SUPPRESS',
    })
  );

  // 2. Set password permanently
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true,
    })
  );

  // 3. Add to Group
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      GroupName: validRole,
    })
  );

  // 4. Authenticate to return tokens
  return loginUser({ email, password });
}

/**
 * Authenticate user with Cognito using USER_PASSWORD_AUTH
 */
export async function loginUser({ email, password }) {
  const res = await cognitoClient.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    })
  );

  const authResult = res.AuthenticationResult;
  if (!authResult) throw new Error('Authentication failed');

  // Verify and decode ID token to get user info
  const payload = await idVerifier.verify(authResult.IdToken);
  const groups = payload['cognito:groups'] || [];
  let role = 'Customer';
  if (groups.includes('Admin')) role = 'Admin';
  else if (groups.includes('Owner')) role = 'Owner';

  return {
    idToken: authResult.IdToken,
    accessToken: authResult.AccessToken,
    refreshToken: authResult.RefreshToken,
    expiresIn: authResult.ExpiresIn,
    user: {
      id: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      role,
      groups,
    },
  };
}
