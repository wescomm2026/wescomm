type DeploymentEnvironment = {
  NODE_ENV?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
};

type DevelopmentLoginEnvironment = DeploymentEnvironment & {
  AUTH_ENABLE_DEV_LOGIN?: boolean;
  AUTH_DEV_LOGIN_PASSWORD?: string;
};

export function isProductionDeploymentEnvironment(environment: DeploymentEnvironment) {
  const vercelEnvironment = environment.VERCEL_ENV?.trim().toLowerCase();
  const vercelTargetEnvironment = environment.VERCEL_TARGET_ENV?.trim().toLowerCase();
  const hasVercelSystemEnvironment = environment.VERCEL?.trim() === "1";

  if (hasVercelSystemEnvironment) {
    if (vercelEnvironment === "production" || vercelTargetEnvironment === "production") return true;
    if (vercelEnvironment === "preview") return false;
  }

  // Fail closed for non-Vercel production runtimes and for deployments where
  // Vercel system environment variables have not been exposed.
  return environment.NODE_ENV?.trim().toLowerCase() === "production";
}

export function assertSafeDevelopmentLoginEnvironment(environment: DevelopmentLoginEnvironment) {
  if (!environment.AUTH_ENABLE_DEV_LOGIN) return;

  if (isProductionDeploymentEnvironment(environment)) {
    throw new Error("AUTH_ENABLE_DEV_LOGIN must be false in production deployments.");
  }
  if ((environment.AUTH_DEV_LOGIN_PASSWORD?.trim().length ?? 0) < 12) {
    throw new Error("AUTH_DEV_LOGIN_PASSWORD must contain at least 12 characters when development login is enabled.");
  }
}
